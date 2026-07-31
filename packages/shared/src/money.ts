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
 * Devuelve el nuevo costo unitario en milésimas de peso.
 *
 * **La guarda de saldo ≤ 0 (tarea 4.2) no es solo para no dividir por cero.**
 * Si el saldo anterior es negativo —y lo es cada vez que se vendió contra
 * stock sin cargar, que es exactamente el estado en que llega este sprint—,
 * el promedio ponderado estaría promediando contra una deuda cuyo costo nunca
 * existió: el valor previo entra negativo y el promedio sale muy por debajo de
 * lo que se acaba de pagar. En ese caso el costo del ingreso PASA A SER el
 * costo del producto, sin promediar. Es el único dato real que hay.
 *
 * Conservar el costo anterior sería peor y además silencioso: se digita una
 * factura con el precio nuevo del proveedor y el sistema sigue calculando el
 * margen con el costo viejo sin avisar nada.
 */
export function recalcAverageCost(params: {
  prevBalanceBaseMilli: number;
  prevCostNetMilliPeso: number;
  incomingBaseMilli: number;
  incomingTotalCostNet: number;
}): number {
  const { prevBalanceBaseMilli, prevCostNetMilliPeso, incomingBaseMilli, incomingTotalCostNet } = params;
  const newBalance = prevBalanceBaseMilli + incomingBaseMilli;

  if (prevBalanceBaseMilli <= 0) {
    if (incomingBaseMilli <= 0) return prevCostNetMilliPeso;
    return roundSym((Math.abs(incomingTotalCostNet) * 1_000_000) / incomingBaseMilli);
  }
  if (newBalance <= 0) return prevCostNetMilliPeso;
  // Ojo con los denominadores: el saldo está en MILÉSIMAS de unidad base y el
  // costo en MILÉSIMAS de peso por unidad base, así que el valor en pesos
  // divide por 1.000.000, no por 1.000. Con /1000 la primera compra sale bien
  // (parte de saldo cero) y la segunda infla el costo mil veces.
  const prevValue = (prevBalanceBaseMilli * prevCostNetMilliPeso) / 1_000_000;
  const newValue = prevValue + Math.abs(incomingTotalCostNet);
  return roundSym((newValue * 1_000_000) / newBalance);
}

/**
 * Formato chileno: punto de miles, sin decimales.
 *
 * El signo va DELANTE del peso: `-$10.000`, no `$-10.000`. Pegar el `$` al
 * número deja el menos en medio y se lee como un guion, sobre todo en una
 * columna angosta y a la distancia del mesón. Se descubrió mirando la tabla de
 * movimientos de caja, donde un retiro salía como `$-10.000`.
 */
export function formatCLP(pesos: number): string {
  const signo = pesos < 0 ? "-" : "";
  const absoluto = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(Math.abs(pesos));
  return `${signo}$${absoluto}`;
}

/**
 * Hora en formato de 24 horas. `es-CL` por omisión devuelve "09:01 p. m.", que
 * es más largo, se lee peor en una columna y obliga a distinguir "a. m." de
 * "p. m." de un vistazo. En una tienda se habla en 24 horas.
 */
export function formatHora(fecha: Date | string): string {
  return new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false }).format(
    typeof fecha === "string" ? new Date(fecha) : fecha,
  );
}

/**
 * Costo por unidad, que a diferencia de un MONTO sí lleva decimales.
 *
 * Es la razón de ser de las milésimas (decisión sellada 2): una caja de 1.000
 * tarugos a $3.500 da $3,5 por tarugo, y mostrarlo como "$4" es un 14% de
 * error a la vista, justo en el número con el que se calcula el margen.
 * `formatCLP` es para plata que cambia de manos; esto es para razones.
 */
export function formatCostoMilli(milliPeso: number): string {
  const signo = milliPeso < 0 ? "-" : "";
  const texto = new Intl.NumberFormat("es-CL", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(
    Math.abs(milliPeso) / 1000,
  );
  return `${signo}$${texto}`;
}

/** Cantidad en milésimas → texto con coma decimal, sin ceros de relleno. */
export function formatQty(qtyMilli: number, allowsFraction = true): string {
  const v = qtyMilli / 1000;
  return new Intl.NumberFormat("es-CL", {
    minimumFractionDigits: 0,
    maximumFractionDigits: allowsFraction ? 3 : 0,
  }).format(v);
}
