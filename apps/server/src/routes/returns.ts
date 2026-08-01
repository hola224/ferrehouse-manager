/**
 * Anulación y devolución (tarea 4.6, decisión sellada 5 y 7, ADR-002).
 *
 * UNA VENTA NUNCA SE EDITA NI SE BORRA. Devolver es escribir una venta
 * CONTRARIA que apunta a la original: montos negativos, cantidades negativas,
 * y el par suma exactamente cero. Por eso los reportes de plata pueden sumar
 * todas las filas sin filtrar por estado y ningún período cerrado se mueve.
 *
 * DOS CAMINOS, UN SOLO CÁLCULO. Anular es devolver todo lo que quede vivo;
 * devolver es lo mismo con las líneas que diga el usuario. La aritmética está
 * en `@ferrehouse/shared/returns` y se ejecuta DENTRO de la transacción,
 * porque el invariante que impide devolver más de lo vendido se evalúa contra
 * las reversas que existan en ese instante.
 *
 * EL EFECTIVO SALE DE LA CAJA ABIERTA AHORA, no de la del día de la venta,
 * que puede llevar semanas cerrada. Cerrar un turno pasado para meterle un
 * movimiento nuevo reescribiría un arqueo ya firmado.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { audit } from "../audit.js";
import { requireRole } from "../roles.js";
import { verificarLogin } from "../auth.js";
import { getSetting } from "../settings.js";
import { registrarMovimiento } from "../stock-ledger.js";
import { ticketEscPos } from "../ticket.js";
import {
  calcularDevolucion,
  resumirLineas,
  ErrorDeDevolucion,
  toBaseMilli,
  formatCLP,
  formatQty,
} from "@ferrehouse/shared";

function malaPeticion(mensaje: string): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = 400;
  return e;
}

const idParam = z.object({ id: z.coerce.number().int().positive() });

const baseSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(4, "Escribe el motivo: una devolución sin motivo no se puede explicar después")
    .max(200),
  /** Folio de la nota de crédito emitida en el POS tributario. */
  fiscalFolio: z.string().trim().max(30).nullable().optional(),
  refundMethod: z.enum(["CASH", "DEBIT", "CREDIT", "TRANSFER"]).default("CASH"),
  adminPin: z.string().optional(),
});

const returnSchema = baseSchema.extend({
  items: z
    .array(
      z.object({
        itemId: z.number().int().positive(),
        qtyMilli: z.number().int().positive("La cantidad a devolver tiene que ser mayor que cero"),
      }),
    )
    .min(1, "Elige al menos una línea para devolver"),
});

const ventaCompleta = {
  user: { select: { name: true } },
  location: { select: { name: true } },
  items: {
    include: {
      unit: { include: { group: true } },
      product: { select: { id: true, name: true, saleUnitId: true } },
      reversedByItems: { select: { qtyMilli: true } },
    },
  },
  payments: true,
} as const;

export async function registerReturnRoutes(app: FastifyInstance): Promise<void> {
  const cualquiera = { preHandler: requireRole("ADMIN", "SELLER") };

  /**
   * Lo que la pantalla necesita para armar la devolución: cada línea con lo
   * que ya volvió y lo que queda vivo. Sin esto, la pantalla tendría que
   * restar por su cuenta y sería la cuarta implementación de la misma resta.
   */
  app.get("/api/sales/:id/returnable", cualquiera, async (req) => {
    const { id } = idParam.parse(req.params);
    const venta = await db.sale.findUnique({ where: { id }, include: ventaCompleta });
    if (!venta) throw malaPeticion("Esa venta no existe.");

    const resumen = new Map(resumirLineas(venta.items).map((r) => [r.itemId, r]));
    return {
      venta: { id: venta.id, createdAt: venta.createdAt, totalGross: venta.totalGross, status: venta.status },
      esReversa: venta.reversalKind !== null,
      anulada: venta.status === "REVERSED",
      lineas: venta.items.map((it) => {
        const r = resumen.get(it.id)!;
        const fraccion = it.unit.group.allowsFraction;
        return {
          itemId: it.id,
          productId: it.productId,
          nombre: it.descriptionSnapshot,
          unidad: it.unit.symbol,
          allowsFraction: fraccion,
          qtyMilli: it.qtyMilli,
          returnedQtyMilli: r.returnedQtyMilli,
          vivoQtyMilli: r.vivoQtyMilli,
          /*
            El precio unitario cobrado, para que la pantalla pueda decir CUÁNTO
            se está devolviendo antes de apretar. Es el del momento de la venta
            —`unitPriceGross` está congelado en la línea—, no el de la lista de
            hoy: devolver algo que subió de precio la semana pasada tiene que
            devolver lo que el cliente pagó.

            Es una estimación para la pantalla, no la cifra que se registra: el
            monto exacto lo calcula el servidor al reversar, con el descuento
            prorrateado y el redondeo de la venta original.
          */
          unitPriceGross: it.unitPriceGross,
          texto:
            r.vivoQtyMilli === 0
              ? "Ya se devolvió completa"
              : `Quedan ${formatQty(r.vivoQtyMilli, fraccion)} ${it.unit.symbol} sin devolver`,
        };
      }),
    };
  });

  app.post("/api/sales/:id/return", cualquiera, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const datos = returnSchema.parse(req.body);
    return reversar(req, reply, id, "RETURN", datos, datos.items);
  });

  app.post("/api/sales/:id/void", cualquiera, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const datos = baseSchema.parse(req.body);
    return reversar(req, reply, id, "VOID", datos, null);
  });

  /**
   * `pedido` en null significa anular: se devuelve todo lo que quede vivo. Se
   * resuelve adentro de la transacción, con las reversas que existan en ese
   * instante — resolverlo afuera dejaría una ventana donde dos anulaciones
   * simultáneas devuelven cada una "todo lo vivo" y el stock entra dos veces.
   */
  async function reversar(
    req: FastifyRequest,
    reply: FastifyReply,
    id: number,
    kind: "RETURN" | "VOID",
    datos: z.infer<typeof baseSchema>,
    pedido: { itemId: number; qtyMilli: number }[] | null,
  ) {
    const sesion = await db.cashSession.findUnique({ where: { openStationId: req.user.stationId } });
    if (!sesion) throw malaPeticion("La caja está cerrada. Ábrela antes de devolver.");

    /**
     * Una devolución mueve plata hacia afuera, y el vendedor que la digita es
     * el mismo que la entrega. Por eso necesita el PIN de un administrador,
     * igual que un descuento fuera de tope: no es desconfianza, es que la
     * autorización quede registrada y sea de alguien.
     */
    let autorizadoPor = req.user.role === "ADMIN" ? req.user.sub : null;
    if (!autorizadoPor) {
      if (!datos.adminPin) {
        throw malaPeticion("Una devolución la autoriza un administrador: pide su PIN.");
      }
      const admins = await db.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
      for (const a of admins) {
        const r = await verificarLogin({ userId: a.id, pin: datos.adminPin, stationId: req.user.stationId });
        if (r.ok) {
          autorizadoPor = a.id;
          break;
        }
      }
      if (!autorizadoPor) throw malaPeticion("Ese PIN de administrador no es correcto.");
    }

    const [tienda, encabezado, pie] = await Promise.all([
      getSetting("store.name"),
      getSetting("ticket.header"),
      getSetting("ticket.footer"),
    ]);
    const estacion = await db.station.findUniqueOrThrow({ where: { id: req.user.stationId } });

    const creada = await db.$transaction(async (tx) => {
      const original = await tx.sale.findUnique({ where: { id }, include: ventaCompleta });
      if (!original) throw malaPeticion("Esa venta no existe.");
      if (original.reversalKind !== null) {
        throw malaPeticion("Esa fila ya es una devolución: no se devuelve una devolución.");
      }
      if (original.status === "REVERSED") {
        throw malaPeticion("Esa venta ya está anulada por completo.");
      }

      const resumen = resumirLineas(original.items);
      const lineasPedidas =
        pedido ??
        resumen.filter((r) => r.vivoQtyMilli > 0).map((r) => ({ itemId: r.itemId, qtyMilli: r.vivoQtyMilli }));

      if (lineasPedidas.length === 0) {
        throw malaPeticion("Esa venta ya se devolvió completa: no queda nada que anular.");
      }

      let calculada;
      try {
        calculada = calcularDevolucion(
          {
            subtotalGross: original.subtotalGross,
            discountAmount: original.discountAmount,
            roundingAmount: original.roundingAmount,
            items: original.items.map((it) => ({
              id: it.id,
              productId: it.productId,
              qtyMilli: it.qtyMilli,
              unitId: it.unitId,
              lineTotalGross: it.lineTotalGross,
              lineCostNet: it.lineCostNet,
              descriptionSnapshot: it.descriptionSnapshot,
              unitPriceGross: it.unitPriceGross,
              discountAmount: it.discountAmount,
              reversedByItems: it.reversedByItems,
            })),
          },
          lineasPedidas,
        );
      } catch (e) {
        if (e instanceof ErrorDeDevolucion) throw malaPeticion(e.message);
        throw e;
      }

      const aDevolver = Math.abs(calculada.totalGross);

      // El efectivo sale del cajón: si no hay, no se puede entregar. Decirlo
      // con el saldo a la vista evita el "no funciona" y deja claro que la
      // salida es registrar un ingreso de efectivo, no insistir.
      const ultimo = await tx.cashMovement.findFirst({
        where: { sessionId: sesion.id },
        orderBy: { id: "desc" },
        select: { balanceAfter: true },
      });
      const enCaja = ultimo?.balanceAfter ?? 0;
      if (datos.refundMethod === "CASH" && aDevolver > enCaja) {
        throw malaPeticion(
          `Hay ${formatCLP(enCaja)} en caja y esta devolución son ${formatCLP(aDevolver)}. ` +
            `Registra un ingreso de efectivo antes, o devuélvela por otro medio.`,
        );
      }

      const reversa = await tx.sale.create({
        data: {
          cashSessionId: sesion.id,
          locationId: original.locationId,
          userId: req.user.sub,
          customerId: original.customerId,
          // Toda anulación o devolución obliga a emitir nota de crédito en el
          // POS tributario; acá solo se digita su folio.
          fiscalDocType: "NOTA_CREDITO",
          fiscalFolio: datos.fiscalFolio ?? null,
          // La tasa se COPIA de la original: si el IVA cambió entre la venta y
          // la devolución, usar la nueva dejaría el par sin sumar cero.
          taxRatePercent: original.taxRatePercent,
          subtotalGross: calculada.subtotalGross,
          discountAmount: calculada.discountAmount,
          roundingAmount: calculada.roundingAmount,
          totalGross: calculada.totalGross,
          reversesId: original.id,
          reversalKind: kind,
          reversalReason: datos.reason,
        },
      });

      for (const l of calculada.lineas) {
        const it = original.items.find((o) => o.id === l.itemId)!;

        await tx.saleItem.create({
          data: {
            saleId: reversa.id,
            productId: l.productId,
            // MISMA unidad que la línea original: comparar milésimas de
            // unidades distintas sería comparar un rollo con un metro, y el
            // invariante de "no devolver más de lo vendido" quedaría sin poder
            // aplicarse.
            unitId: l.unitId,
            descriptionSnapshot: l.descriptionSnapshot,
            unitPriceGross: l.unitPriceGross,
            lineCostNet: l.lineCostNet,
            qtyMilli: l.qtyMilli,
            discountAmount: 0,
            lineTotalGross: l.lineTotalGross,
            reversesSaleItemId: l.itemId,
          },
        });

        // La mercadería vuelve a la repisa al costo con que salió, prorrateado.
        await registrarMovimiento(tx, {
          productId: l.productId,
          locationId: original.locationId,
          type: "RETURN_IN",
          qtyBaseMilli: toBaseMilli(Math.abs(l.qtyMilli), it.unit.factorMilli),
          totalCostNet: Math.abs(l.lineCostNet),
          userId: req.user.sub,
          refType: "SALE",
          refId: reversa.id,
        });
      }

      /**
       * El pago negativo. En una pata de efectivo `receivedAmount` y
       * `changeAmount` NUNCA son NULL —el arqueo los suma y SQL descarta las
       * filas nulas—, así que la devolución los escribe al revés que una
       * venta: no entró nada (0) y salió todo (el monto). La resta
       * `recibido − vuelto` sigue dando exactamente `amount`, que es la
       * identidad de la que vive el cierre de caja.
       */
      await tx.salePayment.create({
        data: {
          saleId: reversa.id,
          method: datos.refundMethod,
          amount: calculada.totalGross,
          receivedAmount: datos.refundMethod === "CASH" ? 0 : null,
          changeAmount: datos.refundMethod === "CASH" ? aDevolver : null,
        },
      });

      if (datos.refundMethod === "CASH") {
        await tx.cashMovement.create({
          data: {
            sessionId: sesion.id,
            type: "REFUND",
            amount: -aDevolver,
            balanceBefore: enCaja,
            balanceAfter: enCaja - aDevolver,
            userId: req.user.sub,
            saleId: reversa.id,
            description: `${kind === "VOID" ? "Anulación" : "Devolución"} de la venta #${original.id}`,
          },
        });
      }

      if (kind === "VOID") {
        // Único campo mutable de `Sale`, y cambia una sola vez.
        await tx.sale.update({ where: { id: original.id }, data: { status: "REVERSED" } });
      }

      return { reversa, original, calculada, aDevolver };
    });

    await audit({
      userId: autorizadoPor,
      action: kind === "VOID" ? "SALE_REVERSED" : "SALE_RETURNED",
      entity: "Sale",
      entityId: creada.reversa.id,
      payload: {
        original: creada.original.id,
        total: creada.calculada.totalGross,
        motivo: datos.reason,
        digitadaPor: req.user.sub,
      },
    });

    const completa = await db.sale.findUniqueOrThrow({
      where: { id: creada.reversa.id },
      include: {
        user: { select: { name: true } },
        location: { select: { name: true } },
        items: { include: { unit: { include: { group: true } } } },
        payments: true,
      },
    });

    let impresion: { id: string } | null = null;
    let avisoImpresion: string | null = null;
    if (estacion.printerTarget) {
      impresion = await db.printJob.create({
        data: {
          stationId: estacion.id,
          type: "RECEIPT",
          saleId: completa.id,
          payload: ticketEscPos(completa, {
            tienda,
            encabezado,
            pie,
            ancho: estacion.printerWidth,
            // El cajón se abre porque hay que SACAR plata, igual que se abre
            // para guardarla. Con tarjeta no: la plata vuelve por el POS.
            abrirCajon: datos.refundMethod === "CASH",
          }).toString("base64"),
        },
        select: { id: true },
      });
    } else {
      avisoImpresion = `${estacion.name} no tiene impresora configurada: la devolución quedó registrada, pero no salió comprobante.`;
    }

    return reply.code(201).send({
      venta: completa,
      original: { id: creada.original.id },
      impresion,
      avisoImpresion,
      mensaje:
        kind === "VOID"
          ? `Venta #${creada.original.id} anulada. Se devuelven ${formatCLP(creada.aDevolver)}.`
          : `Devolución registrada contra la venta #${creada.original.id}. Se devuelven ${formatCLP(creada.aDevolver)}.`,
    });
  }
}
