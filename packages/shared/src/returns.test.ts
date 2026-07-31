import { describe, it, expect } from "vitest";
import { resumirLineas, calcularDevolucion, ErrorDeDevolucion } from "./returns.js";

/** Una línea vendida cualquiera, con lo justo para devolverla. */
const linea = (over: Partial<Parameters<typeof calcularDevolucion>[0]["items"][number]> = {}) => ({
  id: 1,
  productId: 10,
  unitId: 1,
  qtyMilli: 3000,
  lineTotalGross: 3000,
  lineCostNet: 1000,
  descriptionSnapshot: "Cable 2,5 mm",
  unitPriceGross: 1000,
  discountAmount: 0,
  reversedByItems: [] as Array<{ qtyMilli: number }>,
  ...over,
});

const venta = (items: ReturnType<typeof linea>[], over: Partial<{ subtotalGross: number; discountAmount: number; roundingAmount: number }> = {}) => ({
  subtotalGross: items.reduce((n, i) => n + i.lineTotalGross, 0),
  discountAmount: 0,
  roundingAmount: 0,
  items,
  ...over,
});

describe("resumirLineas", () => {
  it("suma las reversas en valor absoluto", () => {
    const r = resumirLineas([linea({ reversedByItems: [{ qtyMilli: -1000 }, { qtyMilli: -500 }] })]);
    expect(r[0]).toEqual({ itemId: 1, qtyMilli: 3000, returnedQtyMilli: 1500, vivoQtyMilli: 1500 });
  });
});

describe("calcularDevolucion", () => {
  it("no deja devolver más de lo que queda vivo", () => {
    const v = venta([linea({ reversedByItems: [{ qtyMilli: -2000 }] })]);
    expect(() => calcularDevolucion(v, [{ itemId: 1, qtyMilli: 1001 }])).toThrow(ErrorDeDevolucion);
  });

  it("dice que la línea ya se devolvió completa, no que 'quedan 0'", () => {
    const v = venta([linea({ reversedByItems: [{ qtyMilli: -3000 }] })]);
    expect(() => calcularDevolucion(v, [{ itemId: 1, qtyMilli: 1000 }])).toThrow(/ya se devolvió completa/);
  });

  /**
   * EL CASO QUE JUSTIFICA EL PRORRATEO ACUMULATIVO. $1.000 de costo repartidos
   * en tres devoluciones de un tercio: prorrateando cada trozo por separado
   * cada una se lleva 333 y el peso que sobra no vuelve nunca. El costo
   * histórico de la venta quedaría descuadrado contra el libro de stock.
   */
  it("tres devoluciones de un tercio devuelven exactamente el costo original", () => {
    const trozos: number[] = [];
    const brutos: number[] = [];
    let devueltoHastaAhora = 0;
    for (let i = 0; i < 3; i++) {
      const v = venta([linea({ reversedByItems: [{ qtyMilli: -devueltoHastaAhora }] })]);
      const d = calcularDevolucion(v, [{ itemId: 1, qtyMilli: 1000 }]);
      trozos.push(d.lineas[0]!.lineCostNet);
      brutos.push(d.lineas[0]!.lineTotalGross);
      devueltoHastaAhora += 1000;
    }
    expect(trozos.reduce((a, b) => a + b, 0)).toBe(-1000);
    expect(brutos.reduce((a, b) => a + b, 0)).toBe(-3000);
    expect(trozos).toEqual([-333, -334, -333]);
  });

  it("la anulación total suma cero contra la venta original", () => {
    const items = [linea(), linea({ id: 2, productId: 11, qtyMilli: 1000, lineTotalGross: 1490, lineCostNet: 700 })];
    const v = venta(items, { discountAmount: 449, roundingAmount: -1 });
    const d = calcularDevolucion(
      v,
      items.map((i) => ({ itemId: i.id, qtyMilli: i.qtyMilli })),
    );
    const totalOriginal = v.subtotalGross - v.discountAmount + v.roundingAmount;
    expect(d.subtotalGross).toBe(-v.subtotalGross);
    expect(d.discountAmount).toBe(-v.discountAmount);
    expect(d.roundingAmount).toBe(-v.roundingAmount);
    expect(d.totalGross).toBe(-totalOriginal);
    expect(d.agotaLaVenta).toBe(true);
  });

  /**
   * Con descuento de cabecera, devolver la mitad NO devuelve la mitad del
   * bruto: devuelve la mitad de lo que el cliente efectivamente pagó. Si no,
   * cada devolución parcial le regala al cliente su parte del descuento.
   */
  it("reparte el descuento de cabecera entre las devoluciones parciales", () => {
    const v = venta([linea({ qtyMilli: 2000, lineTotalGross: 2000 })], { discountAmount: 200 });
    const primera = calcularDevolucion(v, [{ itemId: 1, qtyMilli: 1000 }]);
    expect(primera.subtotalGross).toBe(-1000);
    expect(primera.discountAmount).toBe(-100);
    expect(primera.totalGross).toBe(-900);
    expect(primera.agotaLaVenta).toBe(false);

    const v2 = venta([linea({ qtyMilli: 2000, lineTotalGross: 2000, reversedByItems: [{ qtyMilli: -1000 }] })], {
      discountAmount: 200,
    });
    const segunda = calcularDevolucion(v2, [{ itemId: 1, qtyMilli: 1000 }]);
    expect(primera.totalGross + segunda.totalGross).toBe(-(2000 - 200));
  });

  it("una línea que no es de la venta se rechaza", () => {
    expect(() => calcularDevolucion(venta([linea()]), [{ itemId: 99, qtyMilli: 1 }])).toThrow(/no pertenece/);
  });
});
