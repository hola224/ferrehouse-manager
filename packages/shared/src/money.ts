/**
 * Dinero y cantidades. Las convenciones están en schema.prisma (cabecera)
 * y en STATE.md (decisiones selladas 1, 2, 3 y 9).
 *
 * Regla de oro de este archivo: TODO redondeo es simétrico respecto del signo.
 * `Math.round` no lo es (`Math.round(2.5) === 3` pero `Math.round(-2.5) === -2`),
 * y por eso no se usa directamente en ninguna parte. Con el redondeo de JS, una
 * venta y su anulación no suman cero y el descuadre queda para siempre en los
 * reportes, que suman todas las filas sin filtrar por estado.
 */

/** Redondeo al entero más cercano, con el 0,5 siempre alejándose del cero. */
export function roundSym(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/**
 * Redondeo de efectivo al múltiplo (decisión sellada 9).
 * Simétrico: round10(17495) === 17500 y round10(-17495) === -17500,
 * de modo que la venta y su contraria se cancelan exacto.
 */
export function roundCash(x: number, multiplo = 10): number {
  if (multiplo <= 1) return Math.trunc(x);
  return Math.sign(x) * Math.round(Math.abs(x) / multiplo) * multiplo;
}

/**
 * IVA por residuo (decisión sellada 1). NUNCA `neto * tasa`: el redondeo por
 * línea descuadra el total contra el desglose.
 */
export function netFromGross(gross: number, taxRatePercent: number): number {
  return roundSym(gross / (1 + taxRatePercent / 100));
}

export function taxFromGross(gross: number, taxRatePercent: number): number {
  return gross - netFromGross(gross, taxRatePercent);
}

/** Convierte la cantidad de una línea a milésimas de la unidad base. */
export function toBaseMilli(qtyMilli: number, factorMilli: number): number {
  return roundSym((qtyMilli * factorMilli) / 1000);
}

/**
 * Costo promedio ponderado (ADR-005). Solo lo llaman los movimientos que
 * INGRESAN mercadería: sacar no cambia lo que costó lo que queda.
 *
 * Devuelve el nuevo costo unitario en milésimas de peso. Si el saldo resultante
 * es cero o negativo, conserva el costo anterior: dividir por él daría infinito
 * y un valorizado sin sentido.
 */
export function recalcAverageCost(params: {
  prevBalanceBaseMilli: number;
  prevCostNetMilliPeso: number;
  incomingBaseMilli: number;
  incomingTotalCostNet: number;
}): number {
  const { prevBalanceBaseMilli, prevCostNetMilliPeso, incomingBaseMilli, incomingTotalCostNet } = params;
  const newBalance = prevBalanceBaseMilli + incomingBaseMilli;
  if (newBalance <= 0) return prevCostNetMilliPeso;
  // Ojo con los denominadores: el saldo está en MILÉSIMAS de unidad base y el
  // costo en MILÉSIMAS de peso por unidad base, así que el valor en pesos
  // divide por 1.000.000, no por 1.000. Con /1000 la primera compra sale bien
  // (parte de saldo cero) y la segunda infla el costo mil veces.
  const prevValue = (prevBalanceBaseMilli * prevCostNetMilliPeso) / 1_000_000;
  const newValue = prevValue + Math.abs(incomingTotalCostNet);
  return roundSym((newValue * 1_000_000) / newBalance);
}

/** Formato chileno: punto de miles, sin decimales. */
export function formatCLP(pesos: number): string {
  return "$" + new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(pesos);
}

/** Cantidad en milésimas → texto con coma decimal, sin ceros de relleno. */
export function formatQty(qtyMilli: number, allowsFraction = true): string {
  const v = qtyMilli / 1000;
  return new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: allowsFraction ? 3 : 0,
  }).format(v);
}
