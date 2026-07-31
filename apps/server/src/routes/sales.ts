/**
 * La venta (tareas 3.1 a 3.6, 3.8 y 3.9).
 *
 * LO QUE HAY QUE ENTENDER ANTES DE TOCAR ESTO:
 *
 * 1. **La aritmética no está acá.** Vive en `@ferrehouse/shared/sale`, sin
 *    tocar la base, para poder probarla con tablas de casos. Acá se resuelven
 *    precios y costos contra la base, se llama a `calcularVenta` y se escribe.
 *
 * 2. **Todo se escribe en UNA transacción**: venta, líneas, pagos, movimientos
 *    de stock, movimiento de caja y trabajo de impresión. Una venta a medias
 *    —cobrada y sin descontar stock, o al revés— no es representable.
 *
 * 3. **En este sprint la venta descuenta stock SIN validar saldo.** Es
 *    deliberado y está en el plan: el kardex llega en el Sprint 4 y con él la
 *    validación (tarea 4.5). Vender contra saldo negativo hoy es correcto
 *    porque el inventario inicial todavía no se cargó.
 *
 * 4. **El costo se congela en la línea** (decisión sellada 6). Si no, el margen
 *    histórico cambia solo cuando sube un precio de proveedor.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { audit } from "../audit.js";
import { requireRole } from "../roles.js";
import { getSetting } from "../settings.js";
import { ticketEscPos } from "../ticket.js";
import { verificarLogin } from "../auth.js";
import {
  saleInputSchema,
  calcularVenta,
  efectivoAlCajon,
  requiereAutorizacion,
  ErrorDeVenta,
  toBaseMilli,
  roundSym,
  formatCLP,
} from "@ferrehouse/shared";

function malaPeticion(mensaje: string): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = 400;
  return e;
}

const idParam = z.object({ id: z.coerce.number().int().positive() });

export async function registerSaleRoutes(app: FastifyInstance): Promise<void> {
  const cualquiera = { preHandler: requireRole("ADMIN", "SELLER") };

  // ============================================================
  // Cobrar (3.1 a 3.6)
  // ============================================================

  app.post("/api/sales", cualquiera, async (req, reply) => {
    /**
     * La caja se comprueba antes de validar el cuerpo: gana el error de fondo.
     * Sin sesión de caja abierta no hay dónde registrar el efectivo, y una
     * venta sin su movimiento de caja descuadra el arqueo del turno.
     */
    const sesion = await db.cashSession.findUnique({ where: { openStationId: req.user.stationId } });
    if (!sesion) throw malaPeticion("La caja está cerrada. Ábrela antes de vender.");

    const datos = saleInputSchema.parse(req.body);

    // --- Resolver productos: precios y costos salen de la BASE, no del cliente ---
    const ids = [...new Set(datos.items.map((i) => i.productId))];
    const productos = await db.product.findMany({
      where: { id: { in: ids }, deletedAt: null, active: true },
      include: { saleUnit: { include: { group: true } } },
    });
    const porId = new Map(productos.map((p) => [p.id, p]));
    const faltante = ids.find((i) => !porId.has(i));
    if (faltante) throw malaPeticion(`Un producto de la venta ya no está disponible (id ${faltante}).`);

    // Los grupos sin fracción no admiten media unidad: medio tornillo no existe.
    for (const it of datos.items) {
      const p = porId.get(it.productId)!;
      if (!p.saleUnit.group.allowsFraction && it.qtyMilli % 1000 !== 0) {
        throw malaPeticion(`${p.name} no se vende fraccionado: la cantidad tiene que ser un número entero.`);
      }
    }

    const taxRatePercent = await getSetting("tax.rate");
    const multiploRedondeo = await getSetting("cash.roundTo");

    let venta;
    try {
      venta = calcularVenta({
        lineas: datos.items.map((i) => ({
          productId: i.productId,
          qtyMilli: i.qtyMilli,
          unitPriceGross: porId.get(i.productId)!.priceGross,
          discountAmount: i.discountAmount,
        })),
        descuentoVenta: datos.discountAmount,
        pagos: datos.payments,
        taxRatePercent,
        multiploRedondeo,
      });
    } catch (e) {
      if (e instanceof ErrorDeVenta) throw malaPeticion(e.message);
      throw e;
    }

    // --- 3.6: el tope de descuento del vendedor, con override por PIN ---
    const descuentoTotal = datos.discountAmount + datos.items.reduce((t, i) => t + i.discountAmount, 0);
    const tope = await getSetting("discount.maxSeller");
    let autorizadoPor: number | null = null;

    if (req.user.role !== "ADMIN" && requiereAutorizacion({ subtotalGross: venta.subtotalGross, descuentoTotal, topeVendedorPorciento: tope })) {
      if (!datos.adminPin) {
        throw malaPeticion(
          `Ese descuento pasa del ${tope}% que puedes autorizar. Pide el PIN de un administrador para aplicarlo.`,
        );
      }
      /**
       * Se valida contra CADA administrador activo, no contra uno fijo: el PIN
       * lo digita quien esté en el mesón. Y queda en la bitácora quién
       * autorizó, que es la razón de existir del override.
       */
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

    const tienda = (await db.setting.findUnique({ where: { key: "store.name" } }))?.value ?? "Ferrehouse";
    const estacion = await db.station.findUniqueOrThrow({ where: { id: req.user.stationId } });

    // --- Escritura: TODO junto o nada ---
    const creada = await db.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          cashSessionId: sesion.id,
          locationId: req.user.locationId,
          userId: req.user.sub,
          customerId: datos.customerId ?? null,
          fiscalDocType: datos.fiscalDocType ?? null,
          fiscalFolio: datos.fiscalFolio ?? null,
          taxRatePercent,
          subtotalGross: venta.subtotalGross,
          discountAmount: venta.discountAmount,
          roundingAmount: venta.roundingAmount,
          totalGross: venta.totalGross,
        },
      });

      for (const l of venta.lineas) {
        const p = porId.get(l.productId)!;
        const qtyBaseMilli = toBaseMilli(l.qtyMilli, p.saleUnit.factorMilli);

        /**
         * Costo NETO exacto de la línea completa, congelado (decisión 6). Se
         * guarda el total y no un costo unitario: dividir por la cantidad y
         * volver a multiplicar mete un error que después no cuadra contra el
         * libro de stock.
         */
        const lineCostNet = roundSym((qtyBaseMilli * p.costNetMilliPeso) / 1_000_000);

        await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: p.id,
            unitId: p.saleUnitId,
            descriptionSnapshot: p.name,
            unitPriceGross: l.unitPriceGross,
            lineCostNet,
            qtyMilli: l.qtyMilli,
            discountAmount: l.discountAmount,
            lineTotalGross: l.lineTotalGross,
          },
        });

        // --- Stock: sale mercadería, así que el movimiento es negativo ---
        const nivel = await tx.stockLevel.findUnique({
          where: { productId_locationId: { productId: p.id, locationId: req.user.locationId } },
        });
        const saldoAntes = nivel?.qtyBaseMilli ?? 0;
        const saldoDespues = saldoAntes - qtyBaseMilli;

        await tx.stockMovement.create({
          data: {
            productId: p.id,
            locationId: req.user.locationId,
            type: "SALE",
            qtyBaseMilli: -qtyBaseMilli,
            totalCostNet: -lineCostNet,
            balanceBaseMilli: saldoDespues,
            // Vender NO cambia el costo promedio: sacar mercadería no altera
            // lo que costó la que queda. Se copia el vigente.
            balanceCostNetMilliPeso: p.costNetMilliPeso,
            userId: req.user.sub,
            refType: "SALE",
            refId: sale.id,
          },
        });

        await tx.stockLevel.upsert({
          where: { productId_locationId: { productId: p.id, locationId: req.user.locationId } },
          create: { productId: p.id, locationId: req.user.locationId, qtyBaseMilli: saldoDespues },
          update: { qtyBaseMilli: saldoDespues },
        });
      }

      for (const p of venta.pagos) {
        await tx.salePayment.create({
          data: {
            saleId: sale.id,
            method: p.method,
            amount: p.amount,
            receivedAmount: p.receivedAmount,
            changeAmount: p.changeAmount,
            reference: p.reference,
          },
        });
      }

      // --- Caja: solo el efectivo FÍSICO que entró al cajón ---
      const efectivo = efectivoAlCajon(venta.pagos);
      if (efectivo > 0) {
        const ultimo = await tx.cashMovement.findFirst({
          where: { sessionId: sesion.id },
          orderBy: { id: "desc" },
          select: { balanceAfter: true },
        });
        const antes = ultimo?.balanceAfter ?? 0;
        await tx.cashMovement.create({
          data: {
            sessionId: sesion.id,
            type: "SALE",
            amount: efectivo,
            balanceBefore: antes,
            balanceAfter: antes + efectivo,
            userId: req.user.sub,
            saleId: sale.id,
            description: `Venta #${sale.id}`,
          },
        });
      }

      return sale;
    });

    // --- 3.8: ticket y pulso del cajón, en el MISMO trabajo ---
    const completa = await db.sale.findUniqueOrThrow({
      where: { id: creada.id },
      include: {
        user: { select: { name: true } },
        location: { select: { name: true } },
        items: { include: { unit: { include: { group: true } } } },
        payments: true,
      },
    });

    let impresion: { id: string } | null = null;
    if (estacion.printerTarget) {
      impresion = await db.printJob.create({
        data: {
          stationId: estacion.id,
          type: "RECEIPT",
          saleId: creada.id,
          payload: ticketEscPos(completa, {
            tienda,
            // El cajón se abre solo si entró efectivo: no hay nada que guardar
            // ni vuelto que dar en una venta pagada entera con tarjeta.
            abrirCajon: efectivoAlCajon(venta.pagos) > 0,
          }).toString("base64"),
        },
        select: { id: true },
      });
    }

    if (autorizadoPor) {
      await audit({
        userId: autorizadoPor,
        action: "DISCOUNT_OVERRIDE",
        entity: "Sale",
        entityId: creada.id,
        payload: { descuentoTotal, subtotalGross: venta.subtotalGross, aplicadoPor: req.user.sub },
      });
    }

    return reply.code(201).send({
      venta: completa,
      cambio: venta.changeAmount,
      impresion,
      mensaje:
        venta.changeAmount > 0
          ? `Cobrado ${formatCLP(venta.totalGross)}. Vuelto: ${formatCLP(venta.changeAmount)}.`
          : `Cobrado ${formatCLP(venta.totalGross)}.`,
    });
  });

  // ============================================================
  // Consultar y reimprimir (3.9)
  // ============================================================

  app.get("/api/sales/:id", cualquiera, async (req) => {
    const { id } = idParam.parse(req.params);
    const venta = await db.sale.findUnique({
      where: { id },
      include: {
        user: { select: { name: true } },
        items: { include: { unit: true, product: { select: { sku: true } } } },
        payments: true,
      },
    });
    if (!venta) throw malaPeticion("Esa venta no existe");
    return { venta };
  });

  app.post("/api/sales/:id/reprint", cualquiera, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const venta = await db.sale.findUnique({
      where: { id },
      include: {
        user: { select: { name: true } },
        location: { select: { name: true } },
        items: { include: { unit: { include: { group: true } } } },
        payments: true,
      },
    });
    if (!venta) throw malaPeticion("Esa venta no existe");

    const estacion = await db.station.findUniqueOrThrow({ where: { id: req.user.stationId } });
    if (!estacion.printerTarget) throw malaPeticion(`${estacion.name} no tiene impresora configurada`);

    const tienda = (await db.setting.findUnique({ where: { key: "store.name" } }))?.value ?? "Ferrehouse";
    const trabajo = await db.printJob.create({
      data: {
        stationId: estacion.id,
        type: "RECEIPT",
        saleId: venta.id,
        isReprint: true,
        payload: ticketEscPos(venta, {
          tienda,
          esReimpresion: true,
          // La copia NO abre el cajón: abrirlo sin una venta detrás es
          // exactamente lo que un arqueo no puede explicar.
          abrirCajon: false,
        }).toString("base64"),
      },
      select: { id: true, isReprint: true },
    });

    return reply.code(201).send({ trabajo, mensaje: `Copia del ticket de la venta #${venta.id} en la cola.` });
  });
}
