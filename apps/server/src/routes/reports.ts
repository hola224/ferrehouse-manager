/**
 * Reportes (tareas 5.1 a 5.4). **Todos son solo de administrador**: llevan
 * costo y margen en cada fila, y la decisión sellada 17 dice que lo que el
 * vendedor no puede ver no sale del servidor. `stripForRole` filtra por
 * NOMBRE de campo, y acá los nombres son nuevos (`margen`, `costo`,
 * `valorNeto`), así que no lo cubre: la única defensa real es que la ruta
 * entera exija ADMIN.
 *
 * El cálculo de la plata no vive acá sino en `../reports.js` y en
 * `desglosarVenta`: esto es solo el HTTP.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { requireRole } from "../roles.js";
import { diaLocal, hoyTexto, resumenDeVentas, ventaParaReporte } from "../reports.js";
import {
  desglosarVenta,
  margenRealizadoPct,
  formatCLP,
  formatQty,
  roundSym,
  toBaseMilli,
  type LineaDesglosada,
} from "@ferrehouse/shared";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha va como 2026-07-30");
const rangoSchema = z.object({ desde: fecha.optional(), hasta: fecha.optional() });

function rango(query: unknown): { desde: Date; hasta: Date; desdeTexto: string; hastaTexto: string } {
  const q = rangoSchema.parse(query);
  const desdeTexto = q.desde ?? hoyTexto();
  const hastaTexto = q.hasta ?? desdeTexto;
  return { desde: diaLocal(desdeTexto), hasta: diaLocal(hastaTexto, true), desdeTexto, hastaTexto };
}

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  const soloAdmin = { preHandler: requireRole("ADMIN") };

  // ============================================================
  // 5.1 — Ventas del día o del rango, con la cuadratura de folios adentro
  // ============================================================

  app.get("/api/reports/sales", soloAdmin, async (req) => {
    const r = rango(req.query);
    const resumen = await resumenDeVentas(req.user.locationId, r.desde, r.hasta);
    return { desde: r.desdeTexto, hasta: r.hastaTexto, ...resumen };
  });

  // ============================================================
  // 5.2 — Margen por producto y por categoría
  // ============================================================

  app.get("/api/reports/margins", soloAdmin, async (req) => {
    const r = rango(req.query);
    const por = z.enum(["producto", "categoria"]).catch("producto").parse((req.query as { por?: string })?.por);

    const ventas = await db.sale.findMany({
      where: { locationId: req.user.locationId, createdAt: { gte: r.desde, lte: r.hasta } },
      include: ventaParaReporte,
      orderBy: { id: "asc" },
    });

    const lineas: LineaDesglosada[] = ventas.flatMap((v) => desglosarVenta({ ...v, items: v.items }).lineas);
    const vacio = { desde: r.desdeTexto, hasta: r.hastaTexto, por, filas: [], neto: 0, costo: 0, margen: 0, margenPct: null };
    if (lineas.length === 0) return vacio;

    /**
     * La cantidad se acumula en UNIDAD BASE, no en la unidad de la línea. El
     * mismo cable se vende por rollo y por metro en el mismo día; sumar
     * `qtyMilli` de las dos líneas da un número que no significa nada.
     */
    const baseDeItem = new Map<number, number>();
    for (const v of ventas) {
      for (const it of v.items) baseDeItem.set(it.id, toBaseMilli(it.qtyMilli, it.unit.factorMilli));
    }

    /**
     * SIN filtrar por `deletedAt`: el schema promete que un producto
     * descontinuado sobrevive en los reportes históricos. Excluirlo haría que
     * el margen del mes pasado cambie solo cuando alguien limpia el catálogo.
     */
    const productos = await db.product.findMany({
      where: { id: { in: [...new Set(lineas.map((l) => l.productId))] } },
      include: { category: { select: { id: true, name: true } }, saleUnit: { include: { group: true } } },
    });
    const porId = new Map(productos.map((p) => [p.id, p]));

    type Fila = {
      id: number | null;
      etiqueta: string;
      detalle: string;
      qtyBaseMilli: number;
      neto: number;
      costo: number;
      margen: number;
    };
    const acumulado = new Map<string, Fila>();

    for (const l of lineas) {
      const p = porId.get(l.productId);
      const clave = por === "producto" ? `p${l.productId}` : `c${p?.category?.id ?? 0}`;
      const fila =
        acumulado.get(clave) ??
        (por === "producto"
          ? {
              id: l.productId,
              etiqueta: p?.name ?? `Producto ${l.productId}`,
              detalle: p ? `${p.sku}${p.deletedAt ? " · descontinuado" : ""}` : "",
              qtyBaseMilli: 0,
              neto: 0,
              costo: 0,
              margen: 0,
            }
          : {
              id: p?.category?.id ?? null,
              etiqueta: p?.category?.name ?? "Sin categoría",
              detalle: "",
              qtyBaseMilli: 0,
              neto: 0,
              costo: 0,
              margen: 0,
            });
      // La cantidad solo tiene sentido dentro de un producto: metros más
      // unidades no es nada. Por categoría queda en cero a propósito.
      if (por === "producto") fila.qtyBaseMilli += baseDeItem.get(l.itemId) ?? 0;
      fila.neto += l.neto;
      fila.costo += l.costo;
      fila.margen += l.margen;
      acumulado.set(clave, fila);
    }

    const filas = [...acumulado.values()]
      .map((f) => {
        const p = por === "producto" && f.id !== null ? porId.get(f.id) : undefined;
        return {
          ...f,
          cantidad: p
            ? `${formatQty(roundSym((f.qtyBaseMilli * 1000) / p.saleUnit.factorMilli), p.saleUnit.group.allowsFraction)} ${p.saleUnit.symbol}`
            : null,
          netoTexto: formatCLP(f.neto),
          margenTexto: formatCLP(f.margen),
          margenPct: margenRealizadoPct(f.neto, f.margen),
        };
      })
      .sort((a, b) => b.margen - a.margen);

    const neto = filas.reduce((n, f) => n + f.neto, 0);
    const costo = filas.reduce((n, f) => n + f.costo, 0);
    return {
      desde: r.desdeTexto,
      hasta: r.hastaTexto,
      por,
      filas,
      neto,
      costo,
      margen: neto - costo,
      margenPct: margenRealizadoPct(neto, neto - costo),
    };
  });

  // ============================================================
  // 5.3 — Inventario valorizado a una fecha
  // ============================================================

  /**
   * SE RECONSTRUYE SUMANDO EL LIBRO, no leyendo la última foto de saldo.
   *
   * El plan decía "reconstruido desde `balanceBaseMilli` +
   * `balanceCostNetMilliPeso`", y eso no funciona: esas dos columnas son
   * fotos tomadas en ORDEN DE ESCRITURA, mientras que `createdAt` es la fecha
   * del HECHO. Una factura digitada hoy con fecha de la semana pasada lleva
   * `createdAt` de la semana pasada y un `balanceBaseMilli` calculado sobre
   * el saldo de hoy, ventas de esta semana incluidas: buscar "la última fila
   * con fecha ≤ X" y creerle su foto devuelve un número que nunca fue cierto.
   *
   * Sumar `qtyBaseMilli` y `totalCostNet` sí funciona, y es exactamente lo
   * que la decisión sellada 4 previó al guardar el MONTO exacto de cada
   * movimiento en vez de una razón: los montos se suman sin acumular error.
   */
  app.get("/api/reports/inventory", soloAdmin, async (req) => {
    const q = z.object({ fecha: fecha.optional() }).parse(req.query);
    const hastaTexto = q.fecha ?? hoyTexto();
    const hasta = diaLocal(hastaTexto, true);

    const sumas = await db.stockMovement.groupBy({
      by: ["productId"],
      where: { locationId: req.user.locationId, createdAt: { lte: hasta } },
      _sum: { qtyBaseMilli: true, totalCostNet: true },
    });

    const productos = await db.product.findMany({
      where: { id: { in: sumas.map((s) => s.productId) } },
      include: { saleUnit: { include: { group: true } }, category: { select: { name: true } } },
    });
    const porId = new Map(productos.map((p) => [p.id, p]));

    const filas = sumas
      .map((s) => {
        const p = porId.get(s.productId);
        const qtyBaseMilli = s._sum.qtyBaseMilli ?? 0;
        const valorNeto = s._sum.totalCostNet ?? 0;
        return {
          productId: s.productId,
          sku: p?.sku ?? "?",
          name: p?.name ?? `Producto ${s.productId}`,
          categoria: p?.category?.name ?? "Sin categoría",
          qtyBaseMilli,
          cantidad: p
            ? `${formatQty(roundSym((qtyBaseMilli * 1000) / p.saleUnit.factorMilli), p.saleUnit.group.allowsFraction)} ${p.saleUnit.symbol}`
            : String(qtyBaseMilli),
          valorNeto,
          valorNetoTexto: formatCLP(valorNeto),
          // Costo medio implícito de lo que queda, en milésimas de peso por
          // unidad base. Es una razón, no un monto: lleva decimales.
          costoMilli: qtyBaseMilli === 0 ? null : roundSym((valorNeto * 1_000_000) / qtyBaseMilli),
        };
      })
      /*
       * Un producto que entró y salió entero no es inventario. Uno con saldo
       * BAJO CERO sí se muestra: es una deuda de stock —se vendió más de lo
       * que se había cargado— y esconderla haría que el valorizado no cuadre
       * contra el libro, que es lo único que este reporte promete.
       */
      .filter((f) => f.qtyBaseMilli !== 0 || f.valorNeto !== 0)
      .sort((a, b) => b.valorNeto - a.valorNeto);

    const total = filas.reduce((n, f) => n + f.valorNeto, 0);
    return {
      fecha: hastaTexto,
      filas,
      total,
      totalTexto: formatCLP(total),
      bajoCero: filas.filter((f) => f.qtyBaseMilli < 0).length,
      productos: filas.length,
    };
  });
}
