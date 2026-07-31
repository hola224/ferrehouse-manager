/**
 * Alertas (tareas 5.5 y 5.6).
 *
 * HAY DOS CLASES DE ALERTA Y NO SE ESCRIBEN IGUAL, porque no son la misma
 * cosa:
 *
 * - **Estado**: `LOW_STOCK` y `OUT_OF_STOCK` describen cómo está la repisa
 *   AHORA. Se evalúan dentro del movimiento que cambia el saldo —el único
 *   instante en que el estado puede cambiar— y ahí mismo se resuelven solas
 *   cuando dejan de ser ciertas. Una alerta que dice "quedan 3 m" cuando hay
 *   200 no es una alerta vieja: es una mentira en pantalla, y el panel
 *   completo pierde credibilidad por ella.
 *
 * - **Hecho**: `CASH_DIFFERENCE` (al cerrar caja) y `STOCK_RECONCILE_DIFF`
 *   (al reconciliar) describen algo que PASÓ. No se deduplican ni se
 *   resuelven solas: la diferencia de caja del martes no es la del lunes, y
 *   esconderla porque quedó una sin resolver tapa justo lo que hay que mirar.
 *
 * `SUSPENDED_SALE_STALE` no es ninguna de las dos, y por eso NO SE GUARDA: se
 * deriva al leer. No existe ningún evento que dispararla —que pase el tiempo
 * no es un evento— así que persistirla obligaría a un barrido periódico, y un
 * barrido cada N minutos sobre una condición que dura días escribe la misma
 * alerta veinte veces. Derivarla es la misma doctrina de `deriveSaleStatus`:
 * lo que se puede calcular de lo que ya está guardado no se guarda de nuevo.
 *
 * Escribir una alerta NUNCA hace fallar la operación que la origina, igual
 * que la bitácora de auditoría. Una venta no se cae porque el aviso de stock
 * bajo no se pudo escribir.
 */
import type { Prisma } from "@prisma/client";
import { formatQty } from "@ferrehouse/shared";
import { db } from "./db.js";
import { getSetting } from "./settings.js";

/** Las dos que describen un estado. Las demás son hechos. */
const TIPOS_DE_ESTADO = ["LOW_STOCK", "OUT_OF_STOCK"] as const;

function enUnidadDeVenta(baseMilli: number, factorMilli: number): number {
  return Math.round((baseMilli * 1000) / factorMilli);
}

/**
 * Mira cómo quedó un producto después de un movimiento y deja el panel de
 * alertas diciendo la verdad sobre él: abre la que corresponda, cierra la que
 * dejó de corresponder, y no duplica la que ya estaba abierta.
 *
 * Se llama desde `registrarMovimiento`, dentro de su transacción: si la venta
 * se echa atrás, la alerta se va con ella.
 */
export async function evaluarStockDeProducto(
  tx: Prisma.TransactionClient,
  pedido: { productId: number; locationId: number; saldoDespues: number },
): Promise<void> {
  try {
    const p = await tx.product.findUnique({
      where: { id: pedido.productId },
      include: { saleUnit: { include: { group: true } } },
    });
    // Un producto descontinuado no se repone: alertar de su quiebre es ruido.
    if (!p || p.deletedAt !== null) return;

    const quiebre = pedido.saldoDespues <= 0;
    const bajo = !quiebre && p.reorderLevelBaseMilli > 0 && pedido.saldoDespues <= p.reorderLevelBaseMilli;
    const tipo = quiebre ? "OUT_OF_STOCK" : bajo ? "LOW_STOCK" : null;

    /**
     * Primero se cierra lo que ya no es cierto. Va antes de abrir la nueva
     * para que el paso de "bajo" a "quiebre" no deje las dos abiertas a la
     * vez diciendo cosas distintas del mismo producto.
     */
    await tx.alert.updateMany({
      where: {
        productId: pedido.productId,
        locationId: pedido.locationId,
        resolvedAt: null,
        type: { in: TIPOS_DE_ESTADO.filter((t) => t !== tipo) },
      },
      data: { resolvedAt: new Date() },
    });

    if (!tipo) return;

    /**
     * Deduplicación: solo si no hay ya una activa del mismo tipo y producto
     * (invariante del Sprint 5). Nunca se reemplaza la fila existente — eso
     * borraría cuándo se levantó, que es lo que dice hace cuánto que falta.
     *
     * Si el administrador la resolvió a mano teniendo el stock todavía bajo,
     * vuelve a aparecer en el próximo movimiento de ese producto. Es lo
     * correcto: resolverla a mano es "ya lo pedí", y si el producto siguió
     * moviéndose y sigue bajo, eso es información nueva.
     */
    const yaHay = await tx.alert.findFirst({
      where: { productId: pedido.productId, locationId: pedido.locationId, type: tipo, resolvedAt: null },
      select: { id: true },
    });
    if (yaHay) return;

    const cantidad = `${formatQty(
      enUnidadDeVenta(pedido.saldoDespues, p.saleUnit.factorMilli),
      p.saleUnit.group.allowsFraction,
    )} ${p.saleUnit.symbol}`;
    const minimo = `${formatQty(
      enUnidadDeVenta(p.reorderLevelBaseMilli, p.saleUnit.factorMilli),
      p.saleUnit.group.allowsFraction,
    )} ${p.saleUnit.symbol}`;

    const message =
      pedido.saldoDespues < 0
        ? `«${p.name}» quedó bajo cero: ${cantidad}. Se vendió más de lo que había cargado.`
        : pedido.saldoDespues === 0
          ? `«${p.name}» se agotó.`
          : `«${p.name}» quedó en ${cantidad}, bajo el mínimo de ${minimo}.`;

    await tx.alert.create({
      data: {
        type: tipo,
        severity: quiebre ? "CRITICAL" : "WARNING",
        productId: pedido.productId,
        locationId: pedido.locationId,
        message,
      },
    });
  } catch (e) {
    console.error("[alertas] no se pudo evaluar el stock del producto", pedido.productId, e);
  }
}

export type AlertaVista = {
  /** `null` en las derivadas: no existen como fila y no se pueden resolver. */
  id: number | null;
  type: string;
  severity: string;
  message: string;
  createdAt: Date;
  /** A dónde lleva el clic. */
  ref: { tipo: "PRODUCTO" | "ESPERA"; id: number; texto: string } | null;
};

const ORDEN_SEVERIDAD: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };

/** "3 días", "50 horas": cuánto lleva algo sin que nadie lo toque. */
export function haceCuanto(desde: Date, ahora: Date): string {
  const horas = Math.floor((ahora.getTime() - desde.getTime()) / 3_600_000);
  if (horas < 48) return `${horas} horas`;
  return `${Math.floor(horas / 24)} días`;
}

/**
 * Todo lo que hay que mirar hoy: lo guardado y lo derivado, en un solo orden.
 *
 * Las de caja no llevan ubicación (la caja no está en una bodega), así que
 * entran siempre; las de stock, solo las de la ubicación del que pregunta.
 */
export async function alertasVigentes(locationId: number, ahora = new Date()): Promise<AlertaVista[]> {
  const guardadas = await db.alert.findMany({
    where: { resolvedAt: null, OR: [{ locationId }, { locationId: null }] },
    orderBy: { id: "desc" },
    take: 200,
    include: { product: { select: { id: true, sku: true, name: true } } },
  });

  const vistas: AlertaVista[] = guardadas.map((a) => ({
    id: a.id,
    type: a.type,
    severity: a.severity,
    message: a.message,
    createdAt: a.createdAt,
    ref: a.product ? { tipo: "PRODUCTO", id: a.product.id, texto: a.product.sku } : null,
  }));

  const horas = await getSetting("pos.suspendedStaleHours");
  const limite = new Date(ahora.getTime() - horas * 3_600_000);
  const anejas = await db.suspendedSale.findMany({
    where: { locationId, touchedAt: { lt: limite } },
    orderBy: { touchedAt: "asc" },
    include: { user: { select: { name: true } } },
  });

  for (const e of anejas) {
    vistas.push({
      id: null,
      type: "SUSPENDED_SALE_STALE",
      severity: "WARNING",
      message: `«${e.label}» lleva ${haceCuanto(e.touchedAt, ahora)} en espera, de ${e.user.name}. El stock sigue disponible: nadie lo reservó.`,
      createdAt: e.touchedAt,
      ref: { tipo: "ESPERA", id: e.id, texto: e.label },
    });
  }

  return vistas.sort(
    (a, b) =>
      (ORDEN_SEVERIDAD[a.severity] ?? 9) - (ORDEN_SEVERIDAD[b.severity] ?? 9) ||
      b.createdAt.getTime() - a.createdAt.getTime(),
  );
}
