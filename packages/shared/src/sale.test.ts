import { describe, it, expect } from "vitest";
import {
  calcularVenta,
  totalDeLinea,
  efectivoAlCajon,
  requiereAutorizacion,
  ErrorDeVenta,
} from "./sale.js";

const IVA = 19;
const R10 = 10;

/** Atajo: una línea de N unidades enteras a un precio. */
const linea = (unitPriceGross: number, unidades: number, discountAmount = 0) => ({
  productId: 1,
  qtyMilli: unidades * 1000,
  unitPriceGross,
  discountAmount,
});

describe("total de línea", () => {
  it("multiplica y redondea UNA sola vez", () => {
    expect(totalDeLinea(690, 3000)).toBe(2070);
  });

  /**
   * Venta fraccionada (CAT-05): 7,5 m de cable a $690. Redondear el precio
   * unitario primero y multiplicar después mete error por línea.
   */
  it("acepta cantidades fraccionadas", () => {
    expect(totalDeLinea(690, 7500)).toBe(5175); // 690 × 7,5
    expect(totalDeLinea(1790, 2500)).toBe(4475);
  });

  it("resta el descuento de la línea", () => {
    expect(totalDeLinea(1000, 3000, 500)).toBe(2500);
  });
});

describe("el redondeo va a la pata de efectivo, no al total", () => {
  it("todo en efectivo: el total se ajusta a la decena", () => {
    const v = calcularVenta({
      lineas: [linea(17_495, 1)],
      pagos: [{ method: "CASH", receivedAmount: 20_000 }],
      taxRatePercent: IVA,
      multiploRedondeo: R10,
    });
    expect(v.subtotalGross).toBe(17_495);
    expect(v.roundingAmount).toBe(5);
    expect(v.totalGross).toBe(17_500);
    expect(v.changeAmount).toBe(2_500);
  });

  /**
   * ADR-003: la tarjeta se cobra al peso exacto. Con la parte en efectivo
   * redondeada, el total sube $5 y la tarjeta no se toca.
   */
  it("mixto: se redondea solo lo que se paga en efectivo", () => {
    const v = calcularVenta({
      lineas: [linea(17_495, 1)],
      pagos: [
        { method: "DEBIT", amount: 10_000, reference: "0012" },
        { method: "CASH", receivedAmount: 7_500 },
      ],
      taxRatePercent: IVA,
      multiploRedondeo: R10,
    });
    expect(v.roundingAmount).toBe(5);
    expect(v.totalGross).toBe(17_500);
    expect(v.pagos.find((p) => p.method === "DEBIT")!.amount).toBe(10_000);
    expect(v.pagos.find((p) => p.method === "CASH")!.amount).toBe(7_500);
    expect(v.changeAmount).toBe(0);
  });

  /** Sin pata en efectivo NO hay redondeo: un ajuste de $5 quedaría sin dueño. */
  it("todo con tarjeta: no se redondea nada", () => {
    const v = calcularVenta({
      lineas: [linea(17_495, 1)],
      pagos: [{ method: "DEBIT", amount: 17_495 }],
      taxRatePercent: IVA,
      multiploRedondeo: R10,
    });
    expect(v.roundingAmount).toBe(0);
    expect(v.totalGross).toBe(17_495);
  });

  it("el redondeo puede ser hacia abajo", () => {
    const v = calcularVenta({
      lineas: [linea(17_494, 1)],
      pagos: [{ method: "CASH", receivedAmount: 17_490 }],
      taxRatePercent: IVA,
      multiploRedondeo: R10,
    });
    expect(v.roundingAmount).toBe(-4);
    expect(v.totalGross).toBe(17_490);
    expect(v.changeAmount).toBe(0);
  });
});

describe("los pagos cuadran siempre", () => {
  it("la suma de los pagos es exactamente el total", () => {
    const casos = [
      { precio: 12_345, tarjeta: 5_000 },
      { precio: 99_999, tarjeta: 50_000 },
      { precio: 1, tarjeta: 0 },
      { precio: 7, tarjeta: 0 },
    ];
    for (const c of casos) {
      const pagos: Parameters<typeof calcularVenta>[0]["pagos"] = c.tarjeta
        ? [{ method: "DEBIT", amount: c.tarjeta }, { method: "CASH", receivedAmount: 1_000_000 }]
        : [{ method: "CASH", receivedAmount: 1_000_000 }];
      const v = calcularVenta({ lineas: [linea(c.precio, 1)], pagos, taxRatePercent: IVA, multiploRedondeo: R10 });
      expect(v.pagos.reduce((t, p) => t + p.amount, 0), `precio ${c.precio}`).toBe(v.totalGross);
    }
  });

  /**
   * El campo en cero, no nulo: SQL descarta las filas nulas al sumar, y veinte
   * pagos justos desaparecerían del arqueo.
   */
  it("pagando justo, el vuelto es CERO y no nulo", () => {
    const v = calcularVenta({
      lineas: [linea(5_000, 1)],
      pagos: [{ method: "CASH", receivedAmount: 5_000 }],
      taxRatePercent: IVA,
      multiploRedondeo: R10,
    });
    const cash = v.pagos.find((p) => p.method === "CASH")!;
    expect(cash.changeAmount).toBe(0);
    expect(cash.changeAmount).not.toBeNull();
    expect(cash.receivedAmount).toBe(5_000);
  });

  it("los pagos con tarjeta no llevan recibido ni vuelto", () => {
    const v = calcularVenta({
      lineas: [linea(5_000, 1)],
      pagos: [{ method: "DEBIT", amount: 5_000 }],
      taxRatePercent: IVA,
      multiploRedondeo: R10,
    });
    const t = v.pagos[0]!;
    expect(t.receivedAmount).toBeNull();
    expect(t.changeAmount).toBeNull();
  });

  it("el efectivo que entra al cajón es el billete menos el vuelto", () => {
    const v = calcularVenta({
      lineas: [linea(17_495, 1)],
      pagos: [{ method: "CASH", receivedAmount: 20_000 }],
      taxRatePercent: IVA,
      multiploRedondeo: R10,
    });
    expect(efectivoAlCajon(v.pagos)).toBe(17_500);
  });

  it("si el efectivo no alcanza, se rechaza diciendo cuánto falta", () => {
    expect(() =>
      calcularVenta({
        lineas: [linea(10_000, 1)],
        pagos: [{ method: "CASH", receivedAmount: 8_000 }],
        taxRatePercent: IVA,
        multiploRedondeo: R10,
      }),
    ).toThrow(/faltan 2000/i);
  });

  it("si la tarjeta no cubre todo y no hay efectivo, se rechaza", () => {
    expect(() =>
      calcularVenta({
        lineas: [linea(10_000, 1)],
        pagos: [{ method: "DEBIT", amount: 6_000 }],
        taxRatePercent: IVA,
        multiploRedondeo: R10,
      }),
    ).toThrow(ErrorDeVenta);
  });

  it("dos patas en efectivo se rechazan: se suman los billetes", () => {
    expect(() =>
      calcularVenta({
        lineas: [linea(10_000, 1)],
        pagos: [
          { method: "CASH", receivedAmount: 5_000 },
          { method: "CASH", receivedAmount: 5_000 },
        ],
        taxRatePercent: IVA,
        multiploRedondeo: R10,
      }),
    ).toThrow(/una sola pata en efectivo/i);
  });
});

describe("IVA por residuo (decisión sellada 1)", () => {
  it("neto + IVA es exactamente el bruto, siempre", () => {
    for (const bruto of [1, 7, 100, 1_190, 12_990, 17_500, 99_999, 1_000_000]) {
      const v = calcularVenta({
        lineas: [linea(bruto, 1)],
        pagos: [{ method: "DEBIT", amount: bruto }],
        taxRatePercent: IVA,
        multiploRedondeo: R10,
      });
      expect(v.netAmount + v.taxAmount, `bruto ${bruto}`).toBe(v.totalGross);
    }
  });

  it("el desglose se calcula sobre el total YA redondeado", () => {
    const v = calcularVenta({
      lineas: [linea(17_495, 1)],
      pagos: [{ method: "CASH", receivedAmount: 17_500 }],
      taxRatePercent: IVA,
      multiploRedondeo: R10,
    });
    expect(v.totalGross).toBe(17_500);
    expect(v.netAmount).toBe(14_706); // round(17.500 / 1,19)
    expect(v.taxAmount).toBe(2_794);
  });
});

describe("descuentos", () => {
  it("el descuento de la venta baja el total", () => {
    const v = calcularVenta({
      lineas: [linea(10_000, 1)],
      descuentoVenta: 1_000,
      pagos: [{ method: "CASH", receivedAmount: 9_000 }],
      taxRatePercent: IVA,
      multiploRedondeo: R10,
    });
    expect(v.subtotalGross).toBe(10_000);
    expect(v.discountAmount).toBe(1_000);
    expect(v.totalGross).toBe(9_000);
  });

  it("un descuento mayor que la venta se rechaza", () => {
    expect(() =>
      calcularVenta({
        lineas: [linea(1_000, 1)],
        descuentoVenta: 2_000,
        pagos: [{ method: "CASH", receivedAmount: 0 }],
        taxRatePercent: IVA,
        multiploRedondeo: R10,
      }),
    ).toThrow(/no puede superar el total/i);
  });

  it("un descuento de línea mayor que la línea se rechaza", () => {
    expect(() =>
      calcularVenta({
        lineas: [linea(1_000, 1, 2_000)],
        pagos: [{ method: "CASH", receivedAmount: 0 }],
        taxRatePercent: IVA,
        multiploRedondeo: R10,
      }),
    ).toThrow(/superar su precio/i);
  });

  /**
   * El tope se evalúa sobre el TOTAL, no por línea: si no, tres descuentos del
   * 5% en tres líneas pasarían sin autorización y suman 15% de la boleta.
   */
  it("el tope del vendedor se mide sobre el total de la venta", () => {
    expect(requiereAutorizacion({ subtotalGross: 100_000, descuentoTotal: 5_000, topeVendedorPorciento: 5 })).toBe(
      false,
    );
    expect(requiereAutorizacion({ subtotalGross: 100_000, descuentoTotal: 5_001, topeVendedorPorciento: 5 })).toBe(
      true,
    );
    // Tres líneas al 5% suman 15%: pide autorización.
    expect(requiereAutorizacion({ subtotalGross: 100_000, descuentoTotal: 15_000, topeVendedorPorciento: 5 })).toBe(
      true,
    );
  });

  it("sin descuento nunca pide autorización", () => {
    expect(requiereAutorizacion({ subtotalGross: 100_000, descuentoTotal: 0, topeVendedorPorciento: 5 })).toBe(false);
  });
});

describe("una venta de mesón completa", () => {
  it("cable por metro, pernos y cemento, pagando con tarjeta y efectivo", () => {
    const v = calcularVenta({
      lineas: [
        { productId: 1, qtyMilli: 7_500, unitPriceGross: 690 }, // 7,5 m de cable
        { productId: 2, qtyMilli: 12_000, unitPriceGross: 350 }, // 12 pernos
        { productId: 3, qtyMilli: 2_000, unitPriceGross: 6_490 }, // 2 sacos
      ],
      pagos: [
        { method: "DEBIT", amount: 10_000, reference: "TBK-4471" },
        { method: "CASH", receivedAmount: 20_000 },
      ],
      taxRatePercent: IVA,
      multiploRedondeo: R10,
    });

    // 5.175 + 4.200 + 12.980 = 22.355
    expect(v.subtotalGross).toBe(22_355);
    // Efectivo crudo 12.355 → 12.360, o sea +5 de redondeo.
    expect(v.roundingAmount).toBe(5);
    expect(v.totalGross).toBe(22_360);
    expect(v.changeAmount).toBe(20_000 - 12_360);
    expect(v.pagos.reduce((t, p) => t + p.amount, 0)).toBe(v.totalGross);
    expect(v.netAmount + v.taxAmount).toBe(v.totalGross);
    expect(efectivoAlCajon(v.pagos)).toBe(12_360);
  });
});
