/**
 * Devoluciones y anulaciones (tarea 4.6, ADR-002).
 *
 * ACÁ VIVE, UNA SOLA VEZ, LA RESPUESTA A "¿CUÁNTO DE ESTA LÍNEA YA VOLVIÓ?".
 * La misma cifra la necesitan tres cosas distintas: el invariante que impide
 * devolver más de lo vendido, la etiqueta que ve el usuario
 * (`deriveSaleStatus`) y el prorrateo del costo. Con tres implementaciones,
 * dos terminan discrepando y el descuadre aparece en el margen, que es donde
 * menos se mira.
 *
 * EL PRORRATEO ES ACUMULATIVO, NO POR TROZO. Para repartir el costo de una
 * línea entre varias devoluciones parciales no se prorratea cada trozo por
 * separado —eso deja migajas de redondeo que no suman el original—, sino que
 * se calcula cuánto corresponde al TOTAL devuelto hasta ahora y se resta lo
 * que ya se había devuelto antes. Así la devolución que agota la línea se
 * lleva el residuo sola, sin ninguna regla especial: cuando la cantidad
 * acumulada iguala la vendida, el acumulado es exactamente el monto original.
 */
import { roundSym } from "./money.js";

/**
 * Lo mínimo para saber cuánto volvió: la cantidad vendida y sus reversas.
 * Deliberadamente NO pide los montos, para que el listado del día pueda pedir
 * tres columnas en vez de la venta entera solo para pintar un chip.
 */
export type LineaConReversas = {
  id: number;
  qtyMilli: number;
  /** Las líneas de devolución que apuntan a esta. `qtyMilli` viene negativo. */
  reversedByItems: Array<{ qtyMilli: number }>;
};

/** Lo mínimo que hay que saber de una línea original para devolverla. */
export type LineaVendida = LineaConReversas & {
  unitId: number;
  lineTotalGross: number;
  lineCostNet: number;
};

export type ResumenLinea = {
  itemId: number;
  qtyMilli: number;
  /** Positivo: cuánto ya volvió. */
  returnedQtyMilli: number;
  /** Lo que queda vivo y todavía se puede devolver o anular. */
  vivoQtyMilli: number;
};

export function resumirLineas(items: LineaConReversas[]): ResumenLinea[] {
  return items.map((it) => {
    const returnedQtyMilli = it.reversedByItems.reduce((n, r) => n + Math.abs(r.qtyMilli), 0);
    return {
      itemId: it.id,
      qtyMilli: it.qtyMilli,
      returnedQtyMilli,
      vivoQtyMilli: it.qtyMilli - returnedQtyMilli,
    };
  });
}

export class ErrorDeDevolucion extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "ErrorDeDevolucion";
  }
}

export type LineaDevuelta = {
  itemId: number;
  productId: number;
  unitId: number;
  /** NEGATIVO, en milésimas de la unidad de la línea original. */
  qtyMilli: number;
  lineTotalGross: number; // negativo
  lineCostNet: number; // negativo
  descriptionSnapshot: string;
  unitPriceGross: number;
  discountAmount: number;
};

export type DevolucionCalculada = {
  lineas: LineaDevuelta[];
  subtotalGross: number; // negativo
  discountAmount: number; // negativo
  roundingAmount: number; // negativo o cero
  totalGross: number; // negativo
  /** Después de esta devolución, ¿queda algo vivo en la venta original? */
  agotaLaVenta: boolean;
};

type VentaOriginal = {
  subtotalGross: number;
  discountAmount: number;
  roundingAmount: number;
  items: (LineaVendida & { productId: number; descriptionSnapshot: string; unitPriceGross: number; discountAmount: number })[];
};

/**
 * Calcula la devolución. `pedido` lleva cuánto se devuelve de cada línea, en
 * POSITIVO y en la unidad de la línea original — nunca en otra: la cantidad
 * está en milésimas de esa unidad y compararla contra milésimas de otra sería
 * comparar denominadores distintos (un rollo contra un metro).
 *
 * Anular es devolver todo lo que quede vivo: no hay dos caminos de cálculo.
 */
export function calcularDevolucion(
  venta: VentaOriginal,
  pedido: Array<{ itemId: number; qtyMilli: number }>,
): DevolucionCalculada {
  const porId = new Map(venta.items.map((i) => [i.id, i]));
  const resumen = new Map(resumirLineas(venta.items).map((r) => [r.itemId, r]));

  if (pedido.length === 0) throw new ErrorDeDevolucion("No hay nada que devolver.");

  const lineas: LineaDevuelta[] = [];
  let subtotalGross = 0;

  for (const p of pedido) {
    const original = porId.get(p.itemId);
    const r = resumen.get(p.itemId);
    if (!original || !r) throw new ErrorDeDevolucion("Esa línea no pertenece a la venta.");
    if (p.qtyMilli <= 0) throw new ErrorDeDevolucion("La cantidad a devolver tiene que ser mayor que cero.");
    if (p.qtyMilli > r.vivoQtyMilli) {
      throw new ErrorDeDevolucion(
        r.vivoQtyMilli === 0
          ? `«${original.descriptionSnapshot}» ya se devolvió completa.`
          : `De «${original.descriptionSnapshot}» solo quedan ${r.vivoQtyMilli / 1000} sin devolver.`,
      );
    }

    const yaDevuelto = r.returnedQtyMilli;
    const acumulado = yaDevuelto + p.qtyMilli;

    // Acumulado − ya devuelto: el residuo cae solo en la que agota la línea.
    const brutoAntes = roundSym((original.lineTotalGross * yaDevuelto) / original.qtyMilli);
    const brutoDespues = roundSym((original.lineTotalGross * acumulado) / original.qtyMilli);
    const costoAntes = roundSym((original.lineCostNet * yaDevuelto) / original.qtyMilli);
    const costoDespues = roundSym((original.lineCostNet * acumulado) / original.qtyMilli);

    lineas.push({
      itemId: original.id,
      productId: original.productId,
      unitId: original.unitId,
      qtyMilli: -p.qtyMilli,
      lineTotalGross: -(brutoDespues - brutoAntes),
      lineCostNet: -(costoDespues - costoAntes),
      descriptionSnapshot: original.descriptionSnapshot,
      unitPriceGross: original.unitPriceGross,
      discountAmount: 0,
    });
    subtotalGross -= brutoDespues - brutoAntes;
  }

  /**
   * El descuento y el redondeo de la cabecera se reparten por la MISMA regla
   * acumulativa, ponderados por bruto. Ignorar el descuento de cabecera al
   * devolver es devolverle al cliente más plata de la que pagó: si compró con
   * 10% y devuelve la mitad, la mitad que se le devuelve también traía ese 10%.
   */
  const brutoDevueltoAntes = venta.items.reduce((n, it) => {
    const r = resumen.get(it.id)!;
    return n + roundSym((it.lineTotalGross * r.returnedQtyMilli) / it.qtyMilli);
  }, 0);
  const brutoDevueltoDespues = brutoDevueltoAntes + Math.abs(subtotalGross);

  const proporcion = (monto: number, bruto: number) =>
    venta.subtotalGross === 0 ? 0 : roundSym((monto * bruto) / venta.subtotalGross);

  const discountAmount = -(
    proporcion(venta.discountAmount, brutoDevueltoDespues) - proporcion(venta.discountAmount, brutoDevueltoAntes)
  );
  const roundingAmount = -(
    proporcion(venta.roundingAmount, brutoDevueltoDespues) - proporcion(venta.roundingAmount, brutoDevueltoAntes)
  );

  const totalGross = subtotalGross - discountAmount + roundingAmount;

  const agotaLaVenta = venta.items.every((it) => {
    const r = resumen.get(it.id)!;
    const ahora = pedido.find((p) => p.itemId === it.id)?.qtyMilli ?? 0;
    return r.returnedQtyMilli + ahora >= it.qtyMilli;
  });

  return { lineas, subtotalGross, discountAmount, roundingAmount, totalGross, agotaLaVenta };
}
