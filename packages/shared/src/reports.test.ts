import { describe, it, expect } from "vitest";
import { desglosarVenta, margenRealizadoPct, type VentaParaReporte } from "./reports.js";
import { netFromGross } from "./money.js";

/** Una venta incómoda a propósito: descuento que no divide bien y redondeo. */
const conDescuento: VentaParaReporte = {
  subtotalGross: 33_333,
  discountAmount: 3_333,
  roundingAmount: -4,
  totalGross: 29_996,
  taxRatePercent: 19,
  items: [
    { id: 1, productId: 10, qtyMilli: 1_000, lineTotalGross: 12_990, lineCostNet: 7_000 },
    { id: 2, productId: 11, qtyMilli: 3_500, lineTotalGross: 9_353, lineCostNet: 5_100 },
    { id: 3, productId: 12, qtyMilli: 7_000, lineTotalGross: 10_990, lineCostNet: 9_800 },
  ],
};

/** Sin descuento ni redondeo: el caso normal, que igual tiene que cuadrar. */
const simple: VentaParaReporte = {
  subtotalGross: 12_990,
  discountAmount: 0,
  roundingAmount: 0,
  totalGross: 12_990,
  taxRatePercent: 19,
  items: [{ id: 7, productId: 10, qtyMilli: 1_000, lineTotalGross: 12_990, lineCostNet: 7_000 }],
};

/** Una línea de $1: donde el prorrateo se rompe si se hace por trozo. */
const migajas: VentaParaReporte = {
  subtotalGross: 1_003,
  discountAmount: 501,
  roundingAmount: 8,
  totalGross: 510,
  taxRatePercent: 19,
  items: [
    { id: 1, productId: 1, qtyMilli: 1_000, lineTotalGross: 1, lineCostNet: 0 },
    { id: 2, productId: 2, qtyMilli: 1_000, lineTotalGross: 1, lineCostNet: 1 },
    { id: 3, productId: 3, qtyMilli: 1_000, lineTotalGross: 1, lineCostNet: 0 },
    { id: 4, productId: 4, qtyMilli: 1_000, lineTotalGross: 1_000, lineCostNet: 600 },
  ],
};

const ventas = { conDescuento, simple, migajas };

describe("desglose de una venta en líneas", () => {
  for (const [nombre, venta] of Object.entries(ventas)) {
    it(`${nombre}: la suma de las líneas es exactamente el total`, () => {
      const d = desglosarVenta(venta);
      expect(d.lineas.reduce((n, l) => n + l.bruto, 0)).toBe(venta.totalGross);
    });

    it(`${nombre}: la suma de los netos es el neto del documento`, () => {
      // El IVA es por residuo sobre el TOTAL (decisión sellada 1). Si el neto
      // se calculara línea por línea, la suma se iría por unos pesos del
      // desglose que aparece en el reporte del día, y no habría forma de
      // decidir cuál de los dos números es el bueno.
      const d = desglosarVenta(venta);
      expect(d.lineas.reduce((n, l) => n + l.neto, 0)).toBe(netFromGross(venta.totalGross, 19));
      expect(d.neto + d.iva).toBe(venta.totalGross);
    });
  }

  it("el residuo va siempre a la misma línea, venga como venga ordenada", () => {
    // Si el orden lo decidiera la base, el mismo reporte le atribuiría el peso
    // sobrante a un producto distinto en cada corrida.
    const alReves = { ...conDescuento, items: [...conDescuento.items].reverse() };
    expect(desglosarVenta(alReves).lineas).toEqual(desglosarVenta(conDescuento).lineas);
  });

  it("el margen es el neto de la línea menos su costo congelado", () => {
    const d = desglosarVenta(simple);
    expect(d.lineas[0]!.neto).toBe(netFromGross(12_990, 19)); // 10.916
    expect(d.lineas[0]!.margen).toBe(10_916 - 7_000);
    expect(d.margen).toBe(3_916);
  });

  it("el descuento de cabecera baja el margen: ignorarlo lo infla", () => {
    // Decisión sellada 1. La línea 1 vale 12.990 de repisa, pero la venta se
    // cobró con 10% de descuento: su margen real es menor.
    const conDto = desglosarVenta(conDescuento).lineas[0]!;
    const sinDto = desglosarVenta({ ...conDescuento, discountAmount: 0, roundingAmount: 0, totalGross: 33_333 })
      .lineas[0]!;
    expect(conDto.margen).toBeLessThan(sinDto.margen);
  });
});

describe("una venta y su anulación se cancelan exacto", () => {
  /**
   * Es lo que permite que los reportes sumen TODAS las filas sin filtrar por
   * estado (ADR-002). Si el desglose no fuera simétrico, anular una venta del
   * día dejaría un residuo de unos pesos en el total, para siempre.
   */
  const espejo = (v: VentaParaReporte): VentaParaReporte => ({
    subtotalGross: -v.subtotalGross,
    discountAmount: -v.discountAmount,
    roundingAmount: -v.roundingAmount,
    totalGross: -v.totalGross,
    taxRatePercent: v.taxRatePercent,
    items: v.items.map((i) => ({
      ...i,
      qtyMilli: -i.qtyMilli,
      lineTotalGross: -i.lineTotalGross,
      lineCostNet: -i.lineCostNet,
    })),
  });

  for (const [nombre, venta] of Object.entries(ventas)) {
    it(`${nombre}: la venta más su anulación suman cero en todo`, () => {
      const v = desglosarVenta(venta);
      const a = desglosarVenta(espejo(venta));
      expect(a.totalGross + v.totalGross).toBe(0);
      expect(a.neto + v.neto).toBe(0);
      expect(a.iva + v.iva).toBe(0);
      expect(a.margen + v.margen).toBe(0);
      for (let i = 0; i < v.lineas.length; i++) {
        expect(a.lineas[i]!.bruto + v.lineas[i]!.bruto).toBe(0);
        expect(a.lineas[i]!.neto + v.lineas[i]!.neto).toBe(0);
        expect(a.lineas[i]!.margen + v.lineas[i]!.margen).toBe(0);
      }
    });
  }
});

describe("casos borde del reparto", () => {
  it("con subtotal cero el ajuste completo cae en la última línea", () => {
    // Una venta de garantía: todo a precio cero y un ajuste de cabecera.
    const d = desglosarVenta({
      subtotalGross: 0,
      discountAmount: 0,
      roundingAmount: -3,
      totalGross: -3,
      taxRatePercent: 19,
      items: [
        { id: 1, productId: 1, qtyMilli: 1_000, lineTotalGross: 0, lineCostNet: 500 },
        { id: 2, productId: 2, qtyMilli: 1_000, lineTotalGross: 0, lineCostNet: 300 },
      ],
    });
    expect(d.lineas.map((l) => l.bruto)).toEqual([0, -3]);
    expect(d.lineas.reduce((n, l) => n + l.bruto, 0)).toBe(-3);
  });

  it("una venta sin líneas devuelve su propio neto e IVA", () => {
    const d = desglosarVenta({
      subtotalGross: 0,
      discountAmount: 0,
      roundingAmount: 0,
      totalGross: 1_000,
      taxRatePercent: 19,
      items: [],
    });
    expect(d.neto + d.iva).toBe(1_000);
    expect(d.lineas).toEqual([]);
  });

  it("cuadra con cualquier descuento, no solo con los del ejemplo", () => {
    for (let descuento = 0; descuento <= 3_000; descuento += 7) {
      const total = 33_333 - descuento;
      const d = desglosarVenta({ ...conDescuento, discountAmount: descuento, roundingAmount: 0, totalGross: total });
      expect(d.lineas.reduce((n, l) => n + l.bruto, 0)).toBe(total);
      expect(d.lineas.reduce((n, l) => n + l.neto, 0)).toBe(netFromGross(total, 19));
    }
  });
});

describe("margen en porcentaje", () => {
  it("va sobre la venta neta, con un decimal", () => {
    expect(margenRealizadoPct(10_916, 3_916)).toBe(35.9);
  });

  it("sin venta neta no es cero: es que no hay dato", () => {
    // "0,0%" se lee como "no deja nada". Un producto que solo tuvo
    // devoluciones no dejó nada Y no vendió nada: son cosas distintas.
    expect(margenRealizadoPct(0, -500)).toBeNull();
  });

  it("un margen negativo se informa negativo", () => {
    expect(margenRealizadoPct(1_000, -200)).toBe(-20);
  });
});
