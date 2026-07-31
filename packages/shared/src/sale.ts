/**
 * La aritmética de una venta (Sprint 3).
 *
 * Vive acá, separada de las rutas y sin tocar la base, porque es lo único del
 * sistema donde un error de un peso se multiplica por todas las ventas del día
 * y aparece recién en el arqueo. Se puede probar con tablas de casos, y eso es
 * exactamente lo que hace `sale.test.ts`.
 *
 * Las tres reglas que la gobiernan, todas selladas en STATE.md:
 *
 * 1. **El IVA se calcula por residuo** (decisión 1): `neto = round(bruto/1,19)`
 *    y `iva = bruto − neto`. Nunca `neto × 0,19`, porque redondear cada línea
 *    por separado descuadra el total contra el desglose.
 * 2. **El redondeo a $10 se aplica a la PATA DE EFECTIVO**, no al total
 *    (decisión 9 / ADR-003). La tarjeta se cobra al peso exacto: el banco no
 *    redondea. Sin pata en efectivo no hay redondeo.
 * 3. **La suma de los pagos es exactamente `totalGross`.** De eso viven los
 *    reportes por medio de pago, y el arqueo de caja depende de que la pata de
 *    efectivo sea la plata que de verdad entró al cajón.
 */
import { z } from "zod";
import { roundCash, roundSym, netFromGross, taxFromGross } from "./money.js";

// ============================================================
// Entradas
// ============================================================

export const PAYMENT_METHODS = ["CASH", "DEBIT", "CREDIT", "TRANSFER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_TEXT: Record<PaymentMethod, string> = {
  CASH: "Efectivo",
  DEBIT: "Débito",
  CREDIT: "Crédito",
  TRANSFER: "Transferencia",
};

export const FISCAL_DOC_TYPES = ["BOLETA", "FACTURA", "NOTA_CREDITO", "NONE"] as const;

export const saleItemInputSchema = z.object({
  productId: z.number().int().positive(),
  /** Milésimas de la unidad de venta de esa línea. */
  qtyMilli: z.number().int().positive("La cantidad tiene que ser mayor que cero"),
  discountAmount: z.number().int().min(0, "El descuento no puede ser negativo").default(0),
});

/**
 * Los pagos que NO son efectivo traen su monto; el de efectivo trae lo que el
 * cliente PUSO SOBRE EL MESÓN, no lo que se le imputa.
 *
 * Es la distinción de ADR-003 y es la que hace cuadrar el arqueo: el billete de
 * $20.000 por una compra de $17.500 mueve $20.000 hacia el cajón y $2.500 de
 * vuelta. Pedirle al cliente que mande "amount" obligaría a la pantalla a
 * calcular el redondeo, y entonces el redondeo tendría dos implementaciones.
 */
export const paymentInputSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("CASH"),
    receivedAmount: z.number().int().min(0, "El efectivo recibido no puede ser negativo"),
  }),
  z.object({
    method: z.enum(["DEBIT", "CREDIT", "TRANSFER"]),
    amount: z.number().int().positive("El monto tiene que ser mayor que cero"),
    reference: z.string().trim().max(60).nullable().optional(),
  }),
]);

export const saleInputSchema = z.object({
  items: z.array(saleItemInputSchema).min(1, "Una venta necesita al menos una línea"),
  /** Descuento sobre el total de la venta, en pesos. */
  discountAmount: z.number().int().min(0).default(0),
  payments: z.array(paymentInputSchema).min(1, "Falta indicar cómo se paga"),
  customerId: z.number().int().positive().nullable().optional(),
  /**
   * El cliente capturado en el mesón (6.1 / WA-01). El teléfono viaja **como
   * lo escribieron**: normalizarlo es del servidor, porque es lo que decide si
   * dos ventas son del mismo cliente y eso no puede depender de la pantalla.
   *
   * `consentimiento` no tiene default: un checkbox que se omite tiene que
   * llegar como `false` explícito, no faltar. Si faltara y el servidor
   * asumiera algo, el consentimiento sería una suposición.
   */
  cliente: z
    .object({
      nombre: z.string().trim().max(80).nullable().optional(),
      telefono: z.string().trim().min(1, "Falta el teléfono del cliente"),
      consentimiento: z.boolean(),
    })
    .nullable()
    .optional(),
  /** La doble digitación con el POS tributario (POS-07). */
  fiscalDocType: z.enum(FISCAL_DOC_TYPES).nullable().optional(),
  fiscalFolio: z.string().trim().max(30).nullable().optional(),
  /** PIN de administrador, solo si el descuento pasa el tope del vendedor. */
  adminPin: z.string().regex(/^\d{4,6}$/).nullable().optional(),
});

export type SaleInput = z.infer<typeof saleInputSchema>;

// ============================================================
// El cálculo
// ============================================================

export type LineaCalculada = {
  productId: number;
  qtyMilli: number;
  unitPriceGross: number;
  discountAmount: number;
  lineTotalGross: number;
};

export type PagoCalculado = {
  method: PaymentMethod;
  /** Lo imputado a la venta. La suma de todos es exactamente `totalGross`. */
  amount: number;
  /** Solo en efectivo, y NUNCA nulo ahí: el arqueo los suma. */
  receivedAmount: number | null;
  changeAmount: number | null;
  reference: string | null;
};

export type VentaCalculada = {
  lineas: LineaCalculada[];
  subtotalGross: number;
  discountAmount: number;
  roundingAmount: number;
  totalGross: number;
  netAmount: number;
  taxAmount: number;
  pagos: PagoCalculado[];
  /** Lo que hay que devolverle al cliente. Cero si pagó justo. */
  changeAmount: number;
};

export class ErrorDeVenta extends Error {}

/**
 * Total de una línea: precio por cantidad, menos su descuento.
 *
 * `qtyMilli` está en milésimas, así que el producto se divide por 1.000 y se
 * redondea **una sola vez**. Redondear el precio unitario primero y multiplicar
 * después mete hasta medio peso de error por línea, y con 30 líneas eso ya se
 * ve en el ticket.
 */
export function totalDeLinea(unitPriceGross: number, qtyMilli: number, discountAmount = 0): number {
  const bruto = roundSym((unitPriceGross * qtyMilli) / 1000);
  return bruto - discountAmount;
}

/**
 * Arma la venta completa: totales, redondeo, desglose de IVA y pagos.
 *
 * No toca la base de datos ni valida existencia: recibe los precios ya
 * resueltos. Así se puede probar con una tabla de casos, que es la única forma
 * de tener confianza en esto.
 */
export function calcularVenta(params: {
  lineas: { productId: number; qtyMilli: number; unitPriceGross: number; discountAmount?: number }[];
  descuentoVenta?: number;
  pagos: z.infer<typeof paymentInputSchema>[];
  taxRatePercent: number;
  /** Múltiplo del redondeo de efectivo (`cash.roundTo`). */
  multiploRedondeo: number;
}): VentaCalculada {
  const { taxRatePercent, multiploRedondeo } = params;

  const lineas: LineaCalculada[] = params.lineas.map((l) => ({
    productId: l.productId,
    qtyMilli: l.qtyMilli,
    unitPriceGross: l.unitPriceGross,
    discountAmount: l.discountAmount ?? 0,
    lineTotalGross: totalDeLinea(l.unitPriceGross, l.qtyMilli, l.discountAmount ?? 0),
  }));

  for (const l of lineas) {
    if (l.lineTotalGross < 0) {
      throw new ErrorDeVenta("El descuento de una línea no puede superar su precio.");
    }
  }

  const subtotalGross = lineas.reduce((t, l) => t + l.lineTotalGross, 0);
  const descuentoVenta = params.descuentoVenta ?? 0;
  if (descuentoVenta > subtotalGross) {
    throw new ErrorDeVenta("El descuento no puede superar el total de la venta.");
  }

  const base = subtotalGross - descuentoVenta;

  // --- Los pagos que no son efectivo van al peso exacto ---
  const otros = params.pagos.filter((p) => p.method !== "CASH") as Extract<
    z.infer<typeof paymentInputSchema>,
    { method: "DEBIT" | "CREDIT" | "TRANSFER" }
  >[];
  const enEfectivo = params.pagos.filter((p) => p.method === "CASH") as Extract<
    z.infer<typeof paymentInputSchema>,
    { method: "CASH" }
  >[];

  if (enEfectivo.length > 1) {
    throw new ErrorDeVenta("Una venta lleva una sola pata en efectivo: suma los billetes y cóbralos juntos.");
  }

  const totalOtros = otros.reduce((t, p) => t + p.amount, 0);
  if (totalOtros > base) {
    throw new ErrorDeVenta("Los pagos con tarjeta o transferencia superan el total de la venta.");
  }

  const efectivoCrudo = base - totalOtros;

  /**
   * El redondeo SOLO existe si hay pata en efectivo. Si todo se paga con
   * tarjeta, el total va al peso: el banco cobra el monto exacto y un ajuste
   * de $5 quedaría sin contraparte.
   */
  const hayEfectivo = enEfectivo.length === 1;
  const efectivoRedondeado = hayEfectivo ? roundCash(efectivoCrudo, multiploRedondeo) : 0;
  const roundingAmount = hayEfectivo ? efectivoRedondeado - efectivoCrudo : 0;

  if (!hayEfectivo && efectivoCrudo !== 0) {
    throw new ErrorDeVenta(
      `Faltan ${efectivoCrudo} pesos por cubrir. Agrega el pago en efectivo o ajusta los montos.`,
    );
  }

  const totalGross = base + roundingAmount;

  const pagos: PagoCalculado[] = otros.map((p) => ({
    method: p.method,
    amount: p.amount,
    receivedAmount: null,
    changeAmount: null,
    reference: p.reference ?? null,
  }));

  let changeAmount = 0;
  if (hayEfectivo) {
    const recibido = enEfectivo[0]!.receivedAmount;
    if (recibido < efectivoRedondeado) {
      throw new ErrorDeVenta(
        `El efectivo recibido no alcanza: faltan ${efectivoRedondeado - recibido} pesos.`,
      );
    }
    changeAmount = recibido - efectivoRedondeado;
    /**
     * `receivedAmount` y `changeAmount` van SIEMPRE, incluso pagando justo
     * (cero de vuelto). El arqueo los suma, y SQL descarta las filas nulas:
     * veinte pagos exactos desaparecerían del cierre y el turno acusaría un
     * faltante igual a casi todo el efectivo del día.
     */
    pagos.push({
      method: "CASH",
      amount: efectivoRedondeado,
      receivedAmount: recibido,
      changeAmount,
      reference: null,
    });
  }

  const sumaPagos = pagos.reduce((t, p) => t + p.amount, 0);
  if (sumaPagos !== totalGross) {
    // Red de seguridad: si esto salta, hay un error de programación acá arriba,
    // no un dato malo. Mejor reventar que grabar una venta descuadrada.
    throw new ErrorDeVenta(`Los pagos suman ${sumaPagos} y el total es ${totalGross}.`);
  }

  return {
    lineas,
    subtotalGross,
    discountAmount: descuentoVenta,
    roundingAmount,
    totalGross,
    netAmount: netFromGross(totalGross, taxRatePercent),
    taxAmount: taxFromGross(totalGross, taxRatePercent),
    pagos,
    changeAmount,
  };
}

/**
 * Efectivo que de verdad entra al cajón por esta venta.
 *
 * NO es lo imputado: es el billete menos el vuelto. Coincide con `amount` de la
 * pata en efectivo por construcción, y se calcula aparte porque el arqueo
 * necesita el movimiento físico y conviene que quede escrito por qué.
 */
export function efectivoAlCajon(pagos: readonly PagoCalculado[]): number {
  return pagos
    .filter((p) => p.method === "CASH")
    .reduce((t, p) => t + (p.receivedAmount ?? 0) - (p.changeAmount ?? 0), 0);
}

/**
 * ¿Este descuento necesita PIN de administrador?
 *
 * El tope del vendedor se evalúa sobre el total de la venta, no línea por
 * línea: si no, tres descuentos del 5% en tres líneas pasarían sin autorización
 * y sumarían 15% de la boleta.
 */
export function requiereAutorizacion(params: {
  subtotalGross: number;
  descuentoTotal: number;
  topeVendedorPorciento: number;
}): boolean {
  if (params.descuentoTotal <= 0) return false;
  if (params.subtotalGross <= 0) return true;
  const porciento = (params.descuentoTotal / params.subtotalGross) * 100;
  return porciento > params.topeVendedorPorciento;
}
