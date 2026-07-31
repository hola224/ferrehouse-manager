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
 * 3. **Desde el Sprint 4 la venta valida saldo antes de descontar** (tarea
 *    4.5). Se bloquea con el detalle de lo que falta, y un administrador puede
 *    autorizar igual: la ferretería no deja de vender porque el sistema esté
 *    atrasado, pero la autorización queda en la bitácora como `STOCK_OVERRIDE`.
 *    El interruptor general es `stock.allowNegative`, que sirve mientras se
 *    carga el inventario inicial.
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
  formatQty,
  etiquetaDeVenta,
  resumirLineas,
  SALE_STATUS_TEXT,
  SALE_STATUS_TONE,
} from "@ferrehouse/shared";
import { registrarMovimiento } from "../stock-ledger.js";
import { capturarCliente } from "../customers.js";
import { encolarMensajeDeVenta } from "../whatsapp/cola.js";

function malaPeticion(mensaje: string): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = 400;
  return e;
}

const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Valida un PIN contra CADA administrador activo, no contra uno fijo: el PIN
 * lo digita quien esté en el mesón. Devuelve el id del que autorizó, que es lo
 * que después va a la bitácora — la razón de existir del override.
 */
async function validarPinAdmin(pin: string, stationId: number): Promise<number | null> {
  const admins = await db.user.findMany({ where: { role: "ADMIN", active: true }, select: { id: true } });
  for (const a of admins) {
    const r = await verificarLogin({ userId: a.id, pin, stationId });
    if (r.ok) return a.id;
  }
  return null;
}

export async function registerSaleRoutes(app: FastifyInstance): Promise<void> {
  const cualquiera = { preHandler: requireRole("ADMIN", "SELLER") };

  /**
   * Los parámetros que la pantalla de venta necesita para calcular el total
   * ANTES de cobrar.
   *
   * Los entrega el servidor en vez de que la pantalla los tenga escritos: así
   * la vista previa usa `calcularVenta` de `shared` —la MISMA función que
   * después escribe la venta— con los mismos parámetros. Dos implementaciones
   * del redondeo terminan separándose, y la que se ve en pantalla no es la que
   * cobra.
   */
  app.get("/api/pos/config", cualquiera, async (req) => ({
    taxRatePercent: await getSetting("tax.rate"),
    multiploRedondeo: await getSetting("cash.roundTo"),
    topeDescuento: req.user.role === "ADMIN" ? 100 : await getSetting("discount.maxSeller"),
  }));

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
      autorizadoPor = await validarPinAdmin(datos.adminPin, req.user.stationId);
      if (!autorizadoPor) throw malaPeticion("Ese PIN de administrador no es correcto.");
    }

    /**
     * 4.5: saldo antes de descontar.
     *
     * Se juntan TODAS las líneas que no alcanzan antes de reclamar. Fallar en
     * la primera obliga a corregir, reintentar y descubrir la segunda: en el
     * mesón, con el cliente al frente, eso son tres viajes a la bodega en vez
     * de uno.
     */
    let autorizadoStockPor: number | null = null;
    const permitirNegativo = await getSetting("stock.allowNegative");
    if (!permitirNegativo) {
      const niveles = await db.stockLevel.findMany({
        where: { productId: { in: ids }, locationId: req.user.locationId },
      });
      const saldoPorProducto = new Map(niveles.map((n) => [n.productId, n.qtyBaseMilli]));

      // Un producto puede venir en varias líneas: lo que se compara contra el
      // saldo es el TOTAL de la venta, no cada línea por separado.
      const pedidoPorProducto = new Map<number, number>();
      for (const it of datos.items) {
        const p = porId.get(it.productId)!;
        const base = toBaseMilli(it.qtyMilli, p.saleUnit.factorMilli);
        pedidoPorProducto.set(it.productId, (pedidoPorProducto.get(it.productId) ?? 0) + base);
      }

      const faltantes = [...pedidoPorProducto.entries()]
        .map(([productId, pedido]) => {
          const p = porId.get(productId)!;
          const saldo = saldoPorProducto.get(productId) ?? 0;
          return { p, pedido, saldo, falta: pedido - saldo };
        })
        .filter((f) => f.falta > 0);

      if (faltantes.length > 0) {
        const fraccion = (f: (typeof faltantes)[number]) => f.p.saleUnit.group.allowsFraction;
        const detalle = faltantes
          .map((f) => {
            // Se informa en la unidad de VENTA, que es en la que el vendedor
            // está pensando. El libro lleva unidad base y decirle "quedan
            // 92.500" cuando son 92,5 m no ayuda a nadie.
            const enVenta = (base: number) => formatQty(roundSym((base * 1000) / f.p.saleUnit.factorMilli), fraccion(f));
            return `${f.p.name}: quedan ${enVenta(f.saldo)} ${f.p.saleUnit.symbol} y se piden ${enVenta(f.pedido)}`;
          })
          .join("; ");

        const puedeAutorizar = await getSetting("stock.adminOverride");
        if (req.user.role === "ADMIN") {
          // Queda registrado igual: la autorización no es el PIN, es el hecho.
          autorizadoStockPor = req.user.sub;
        } else if (!puedeAutorizar) {
          throw malaPeticion(`No hay stock suficiente. ${detalle}.`);
        } else {
          if (!datos.adminPin) {
            throw malaPeticion(
              `No hay stock suficiente. ${detalle}. Un administrador puede autorizar la venta con su PIN.`,
            );
          }
          autorizadoStockPor = autorizadoPor ?? (await validarPinAdmin(datos.adminPin, req.user.stationId));
          if (!autorizadoStockPor) throw malaPeticion("Ese PIN de administrador no es correcto.");
        }

        await audit({
          userId: autorizadoStockPor,
          action: "STOCK_OVERRIDE",
          entity: "Sale",
          payload: {
            vendedor: req.user.sub,
            faltantes: faltantes.map((f) => ({ productId: f.p.id, sku: f.p.sku, falta: f.falta })),
          },
        });
      }
    }

    const tienda = (await db.setting.findUnique({ where: { key: "store.name" } }))?.value ?? "Ferrehouse";
    const estacion = await db.station.findUniqueOrThrow({ where: { id: req.user.stationId } });

    /**
     * 6.1 — El cliente, ANTES de la transacción y sin poder tumbarla.
     *
     * Un teléfono mal digitado **no bloquea la venta** (invariante del Sprint
     * 6): se registra sin cliente y se avisa. Con el cliente al frente y la
     * plata en la mano, rebotar la venta entera por un dígito de más sería el
     * peor intercambio posible.
     */
    let customerId: number | null = datos.customerId ?? null;
    let avisoCliente: string | null = null;
    if (datos.cliente) {
      const r = await capturarCliente(datos.cliente);
      if (r.ok) {
        customerId = r.customerId;
        avisoCliente = r.aviso;
      } else {
        avisoCliente = `${r.error} La venta se registró sin cliente, así que no le va a llegar el WhatsApp.`;
      }
    }

    // --- Escritura: TODO junto o nada ---
    const creada = await db.$transaction(async (tx) => {
      const sale = await tx.sale.create({
        data: {
          cashSessionId: sesion.id,
          locationId: req.user.locationId,
          userId: req.user.sub,
          customerId,
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

        /**
         * El signo, el saldo, la foto del costo y el caché los pone el libro
         * (`stock-ledger.ts`). Vender NO cambia el costo promedio: sacar
         * mercadería no altera lo que costó la que queda.
         */
        await registrarMovimiento(tx, {
          productId: p.id,
          locationId: req.user.locationId,
          type: "SALE",
          qtyBaseMilli,
          totalCostNet: lineCostNet,
          userId: req.user.sub,
          refType: "SALE",
          refId: sale.id,
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

    /**
     * Si la caja no tiene impresora, la venta NO se bloquea: la plata ya cambió
     * de manos y una venta cobrada que se cae porque falló la impresión es peor
     * que un ticket que falta (decisión sellada 15). Pero **se dice**. Callarlo
     * significa que en la tienda se venda toda una mañana sin comprobante y
     * nadie se entere hasta que un cliente lo pida.
     */
    let impresion: { id: string } | null = null;
    let avisoImpresion: string | null = null;
    if (!estacion.printerTarget) {
      avisoImpresion = `${estacion.name} no tiene impresora configurada: la venta quedó registrada, pero no salió ticket ni se abrió el cajón.`;
    }
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

    /**
     * 6.3 — el WhatsApp se AGENDA. No se manda acá.
     *
     * Fuera de la transacción y detrás de un `catch` que se traga todo. Son dos
     * redes distintas para el mismo riesgo, y las dos hacen falta:
     * `WhatsAppJob.saleId` es único, así que un insert dentro de la transacción
     * haría rollback de una venta ya cobrada; y una excepción acá arriba
     * devolvería 500 sobre una venta que SÍ quedó escrita — el vendedor leería
     * "error", volvería a cobrar, y la tienda cobraría dos veces.
     */
    let whatsapp: { encolado: boolean; motivo?: string } = { encolado: false, motivo: "SIN_CLIENTE" };
    try {
      const r = await encolarMensajeDeVenta(creada.id);
      whatsapp = r.encolado ? { encolado: true } : { encolado: false, motivo: r.motivo };
    } catch (e) {
      console.error(`[whatsapp] falló al agendar el mensaje de la venta ${creada.id}:`, e);
      whatsapp = { encolado: false, motivo: "ERROR" };
    }

    return reply.code(201).send({
      venta: completa,
      cambio: venta.changeAmount,
      impresion,
      avisoImpresion,
      avisoCliente,
      whatsapp,
      mensaje:
        venta.changeAmount > 0
          ? `Cobrado ${formatCLP(venta.totalGross)}. Vuelto: ${formatCLP(venta.changeAmount)}.`
          : `Cobrado ${formatCLP(venta.totalGross)}.`,
    });
  });

  // ============================================================
  // Consultar y reimprimir (3.9)
  // ============================================================

  /**
   * 4.9 — El listado del día, con la etiqueta de estado ya derivada.
   *
   * Las cinco etiquetas (STATE.md) se calculan ACÁ y no en cada pantalla. Si
   * cada una las derivara por su cuenta, el listado, el kardex y el detalle
   * terminarían discrepando sobre la misma venta, y la regla —que una venta
   * con devoluciones parciales sigue siendo una venta por su monto original—
   * se perdería en la tercera copia.
   */
  /**
   * El listado del día es **solo del administrador**, y no por los datos de
   * cada venta sino por la suma.
   *
   * La precisión de la decisión 17 en el Sprint 5 dice que al vendedor no le
   * viaja la venta del día: el arqueo es a ciegas y casi todo es efectivo, así
   * que decirle cuánto se vendió es decirle cuánto debería tener el cajón.
   * Veinte ventas con su `totalGross` son la venta del día, sumadas a mano.
   *
   * Una venta SUELTA sí puede verla —`/api/sales/:id` sigue abierto a los dos
   * roles—, y es lo que necesita para devolver: el cliente llega con el ticket,
   * que trae impreso «Venta #123». Ese número es la llave. Un listado
   * navegable, en cambio, no hace falta para atender a nadie: si el cliente
   * perdió el ticket, la devolución igual la tiene que autorizar un
   * administrador con su PIN, y él sí tiene el listado.
   */
  app.get("/api/sales", { preHandler: requireRole("ADMIN") }, async (req) => {
    const q = z
      .object({
        desde: z.coerce.date().optional(),
        hasta: z.coerce.date().optional(),
        take: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query ?? {});

    // Sin rango, el día de hoy: es lo que se mira en el mesón.
    const hoy = new Date();
    const desde = q.desde ?? new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate());
    const hasta = q.hasta ?? new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + 1);

    const ventas = await db.sale.findMany({
      where: { locationId: req.user.locationId, createdAt: { gte: desde, lt: hasta } },
      orderBy: { id: "desc" },
      take: q.take,
      include: {
        user: { select: { name: true } },
        items: { select: { id: true, qtyMilli: true, reversedByItems: { select: { qtyMilli: true } } } },
        payments: { select: { method: true, amount: true } },
      },
    });

    return {
      ventas: ventas.map((v) => {
        const etiqueta = etiquetaDeVenta(v);
        return {
          id: v.id,
          createdAt: v.createdAt,
          totalGross: v.totalGross,
          fiscalDocType: v.fiscalDocType,
          fiscalFolio: v.fiscalFolio,
          user: v.user,
          reversesId: v.reversesId,
          etiqueta,
          etiquetaTexto: SALE_STATUS_TEXT[etiqueta],
          etiquetaTono: SALE_STATUS_TONE[etiqueta],
          medios: [...new Set(v.payments.map((p) => p.method))],
        };
      }),
    };
  });

  app.get("/api/sales/:id", cualquiera, async (req) => {
    const { id } = idParam.parse(req.params);
    const venta = await db.sale.findUnique({
      where: { id },
      include: {
        user: { select: { name: true } },
        items: {
          include: {
            unit: true,
            product: { select: { sku: true } },
            reversedByItems: { select: { qtyMilli: true } },
          },
        },
        payments: true,
        reversedBy: { select: { id: true, reversalKind: true, totalGross: true, createdAt: true } },
      },
    });
    if (!venta) throw malaPeticion("Esa venta no existe");

    const etiqueta = etiquetaDeVenta(venta);
    const resumen = resumirLineas(venta.items);
    return {
      venta,
      etiqueta,
      etiquetaTexto: SALE_STATUS_TEXT[etiqueta],
      etiquetaTono: SALE_STATUS_TONE[etiqueta],
      // Cuánto queda vivo por línea: lo mismo que necesita la devolución, y
      // sale de la misma función.
      lineas: resumen,
    };
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
