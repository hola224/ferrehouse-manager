/**
 * El reparto exacto de una venta en líneas (Sprint 5, tareas 5.1 y 5.2).
 *
 * ACÁ VIVE, UNA SOLA VEZ, LA RESPUESTA A "¿CUÁNTA PLATA ES ESTA LÍNEA?".
 * Cuatro reportes distintos hacen la misma pregunta —el total del día, el
 * margen por producto, el margen por categoría y la venta por vendedor— y si
 * cada uno la responde por su cuenta, los cuatro dan números parecidos pero
 * distintos. Parecidos es lo peor que pueden dar: nadie sospecha, y el que
 * decide con el reporte de márgenes decide con otra plata que la que cuadró
 * en caja.
 *
 * DOS REPARTOS, LOS DOS ACUMULATIVOS (decisión sellada 23):
 *
 * 1. **El ajuste de cabecera.** El descuento y el redondeo se aplican a la
 *    venta entera, no a una línea. Repartirlos por línea y redondear cada
 *    trozo deja migajas que no suman el original. Se calcula cuánto ajuste
 *    corresponde al bruto ACUMULADO hasta cada línea y se resta el de la
 *    anterior: la última línea se lleva el residuo sola, porque su acumulado
 *    es exactamente el subtotal. Resultado: Σ bruto === totalGross, siempre.
 *
 * 2. **El neto.** El IVA es por residuo sobre el total del documento
 *    (decisión sellada 1), no línea por línea. Mismo truco sobre el bruto ya
 *    ajustado: Σ neto === netFromGross(totalGross), al peso.
 *
 * EL ORDEN ES POR `id` ASCENDENTE, EXPLÍCITO. Alguna línea tiene que llevarse
 * el peso que sobra, y tiene que ser siempre la misma: si el orden lo decide
 * la base de datos, el mismo reporte corrido dos veces le atribuye el peso a
 * un producto distinto y el margen de dos productos baila sin que nadie haya
 * vendido nada.
 */
import { netFromGross, roundSym } from "./money.js";

export type LineaParaReporte = {
  /** `SaleItem.id`. Define quién se lleva el residuo: el mayor. */
  id: number;
  productId: number;
  qtyMilli: number;
  lineTotalGross: number;
  /** Costo neto congelado de la línea completa (decisión sellada 6). */
  lineCostNet: number;
};

export type VentaParaReporte = {
  subtotalGross: number;
  discountAmount: number;
  roundingAmount: number;
  totalGross: number;
  taxRatePercent: number;
  items: LineaParaReporte[];
};

export type LineaDesglosada = {
  itemId: number;
  productId: number;
  qtyMilli: number;
  /** Bruto de la línea CON su parte del descuento y del redondeo. */
  bruto: number;
  neto: number;
  iva: number;
  /** Costo neto congelado, tal cual salió de la venta. */
  costo: number;
  /** `neto − costo`. La única definición de margen del sistema. */
  margen: number;
};

export type VentaDesglosada = {
  lineas: LineaDesglosada[];
  totalGross: number;
  neto: number;
  iva: number;
  costo: number;
  margen: number;
};

/**
 * Reparte una venta —o una devolución, que es una venta de signo contrario—
 * entre sus líneas, sin perder ni inventar un peso.
 *
 * Funciona igual con montos negativos: la simetría de `roundSym` es lo que
 * hace que una venta y su anulación se cancelen exacto, y por eso los
 * reportes pueden sumar todas las filas sin filtrar por estado (ADR-002).
 */
export function desglosarVenta(venta: VentaParaReporte): VentaDesglosada {
  const neto = netFromGross(venta.totalGross, venta.taxRatePercent);
  const vacia: VentaDesglosada = {
    lineas: [],
    totalGross: venta.totalGross,
    neto,
    iva: venta.totalGross - neto,
    costo: 0,
    margen: neto,
  };
  if (venta.items.length === 0) return vacia;

  const ordenadas = [...venta.items].sort((a, b) => a.id - b.id);

  // Lo que la cabecera le agrega o le quita al subtotal, en un solo número:
  // el descuento y el redondeo no se reparten por separado porque juntos son
  // exactamente la diferencia que hay que repartir.
  const ajuste = venta.totalGross - venta.subtotalGross;

  const lineas: LineaDesglosada[] = [];
  let brutoAcum = 0;
  let ajusteAcum = 0;
  let brutoAjustadoAcum = 0;
  let netoAcum = 0;

  for (let i = 0; i < ordenadas.length; i++) {
    const it = ordenadas[i]!;
    const ultima = i === ordenadas.length - 1;
    brutoAcum += it.lineTotalGross;

    /**
     * Con subtotal cero no hay proporción posible (dividiría por cero) y el
     * caso existe: una venta de garantía a precio cero. El ajuste completo va
     * a la última línea, que es la regla que ya se cumple por construcción en
     * todos los demás casos.
     */
    const ajusteHasta =
      venta.subtotalGross === 0
        ? ultima
          ? ajuste
          : 0
        : roundSym((ajuste * brutoAcum) / venta.subtotalGross);
    const bruto = it.lineTotalGross + (ajusteHasta - ajusteAcum);
    ajusteAcum = ajusteHasta;

    brutoAjustadoAcum += bruto;
    const netoHasta = netFromGross(brutoAjustadoAcum, venta.taxRatePercent);
    const netoLinea = netoHasta - netoAcum;
    netoAcum = netoHasta;

    lineas.push({
      itemId: it.id,
      productId: it.productId,
      qtyMilli: it.qtyMilli,
      bruto,
      neto: netoLinea,
      iva: bruto - netoLinea,
      costo: it.lineCostNet,
      margen: netoLinea - it.lineCostNet,
    });
  }

  const costo = lineas.reduce((n, l) => n + l.costo, 0);
  return {
    lineas,
    totalGross: venta.totalGross,
    neto: netoAcum,
    iva: venta.totalGross - netoAcum,
    costo,
    margen: netoAcum - costo,
  };
}

/**
 * El margen en porcentaje sobre la venta neta, con un decimal.
 *
 * Sobre la VENTA y no sobre el costo: es el número que un ferretero usa para
 * decidir si un producto le conviene, y el que aparece en cualquier reporte
 * de proveedor. Devuelve `null` cuando no hay venta neta que dividir —un
 * producto que solo tuvo devoluciones—, para que la pantalla escriba una raya
 * en vez de "0,0%", que se leería como "no deja nada" en vez de "no hay dato".
 */
export function margenRealizadoPct(neto: number, margen: number): number | null {
  if (neto === 0) return null;
  return Math.round((margen / neto) * 1000) / 10;
}
