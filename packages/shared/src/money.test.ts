import { describe, it, expect } from "vitest";
import {
  roundCash,
  roundSym,
  netFromGross,
  taxFromGross,
  toBaseMilli,
  recalcAverageCost,
  formatCLP,
  formatHora,
  formatCostoMilli,
} from "./money.js";

describe("redondeo de efectivo", () => {
  it("redondea a la decena", () => {
    expect(roundCash(17495)).toBe(17500);
    expect(roundCash(17494)).toBe(17490);
    expect(roundCash(12990)).toBe(12990);
  });

  it("es simétrico: la venta y su anulación suman cero", () => {
    // El bug que esto previene: con "medio hacia arriba", 17495 -> 17500 pero
    // -17495 -> -17490, y el par queda debiendo $10 para siempre, porque los
    // reportes suman todas las filas sin filtrar por estado.
    for (const bruto of [17495, 17490, 12345, 99999, 1, 5, 4, 10005]) {
      expect(roundCash(bruto) + roundCash(-bruto)).toBe(0);
    }
  });

  it("respeta el múltiplo configurable", () => {
    expect(roundCash(1234, 50)).toBe(1250);
    expect(roundCash(1234, 1)).toBe(1234);
  });
});

describe("IVA por residuo", () => {
  it("neto + iva === bruto, siempre", () => {
    for (const bruto of [12990, 1, 999, 17495, 100000, 33333]) {
      expect(netFromGross(bruto, 19) + taxFromGross(bruto, 19)).toBe(bruto);
    }
  });

  /**
   * De esto depende que el reporte del día pueda sumar todas las filas sin
   * filtrar por estado (ADR-002): una devolución lleva `totalGross` negativo,
   * y si el neto de −$12.990 no fuera exactamente −(neto de $12.990), el
   * desglose neto + IVA dejaría de dar el total en cuanto existiera una sola
   * devolución en el día. Se verificó sobre los 200.000 primeros brutos.
   */
  it("es simétrico: el neto de una devolución cancela el de su venta", () => {
    for (const bruto of [12990, 1417, 1, 3, 99999, 17495, 33333]) {
      // Escrito como suma y no como espejo a propósito: `taxFromGross(-1)` da
      // `0` y `-taxFromGross(1)` da `-0`, que para JavaScript son valores
      // distintos aunque sean el mismo número. Lo que el reporte necesita es
      // que el par se cancele, y eso es exactamente lo que dice la suma.
      expect(netFromGross(-bruto, 19) + netFromGross(bruto, 19)).toBe(0);
      expect(taxFromGross(-bruto, 19) + taxFromGross(bruto, 19)).toBe(0);
    }
  });

  it("no usa neto * 0,19", () => {
    // 12990 bruto -> 10916 neto -> 2074 IVA. Con neto*0,19 daría 2074,04 y al
    // redondear por línea el total del día no cuadraría con el desglose.
    expect(netFromGross(12990, 19)).toBe(10916);
    expect(taxFromGross(12990, 19)).toBe(2074);
  });
});

describe("conversión de unidades", () => {
  it("rollo de 100 m a metros", () => {
    expect(toBaseMilli(1000, 100_000)).toBe(100_000);
  });
  it("7,5 m", () => {
    expect(toBaseMilli(7500, 1000)).toBe(7500);
  });
  it("una caja de 100 tornillos", () => {
    expect(toBaseMilli(1000, 100_000)).toBe(100_000);
  });
});

describe("costo promedio ponderado", () => {
  it("promedia dos compras a distinto precio", () => {
    // 100 m a $1.000/m, luego 100 m a $2.000/m -> $1.500/m
    const c1 = recalcAverageCost({
      prevBalanceBaseMilli: 0,
      prevCostNetMilliPeso: 0,
      incomingBaseMilli: 100_000,
      incomingTotalCostNet: 100_000,
    });
    expect(c1).toBe(1_000_000); // $1.000 en milésimas
    const c2 = recalcAverageCost({
      prevBalanceBaseMilli: 100_000,
      prevCostNetMilliPeso: c1,
      incomingBaseMilli: 100_000,
      incomingTotalCostNet: 200_000,
    });
    expect(c2).toBe(1_500_000); // $1.500
  });

  /**
   * Cambió en el Sprint 4 (tarea 4.2). Antes, con saldo anterior negativo se
   * conservaba el costo viejo; ahora manda el costo de lo que entra.
   *
   * El caso real: se vendió contra stock sin cargar, el saldo quedó bajo cero,
   * y llega la factura del proveedor con el precio nuevo. Promediar contra una
   * deuda cuyo costo nunca existió da un promedio por debajo de lo que se
   * acaba de pagar; conservar el viejo es peor todavía, porque el sistema
   * sigue calculando el margen con un costo obsoleto sin avisar nada.
   */
  it("con saldo anterior negativo, manda el costo de lo que entra", () => {
    const c = recalcAverageCost({
      prevBalanceBaseMilli: -5_000,
      prevCostNetMilliPeso: 3_500,
      incomingBaseMilli: 5_000,
      incomingTotalCostNet: 100,
    });
    // $100 por 5 unidades = $20 cada una = 20.000 milésimas.
    expect(c).toBe(20_000);
  });

  it("un movimiento que no ingresa nada deja el costo como estaba", () => {
    const c = recalcAverageCost({
      prevBalanceBaseMilli: -5_000,
      prevCostNetMilliPeso: 3_500,
      incomingBaseMilli: 0,
      incomingTotalCostNet: 0,
    });
    expect(c).toBe(3_500);
  });

  it("no pierde precisión con envases grandes", () => {
    // Una caja de 1.000 tarugos a $3.500: $3,5 por tarugo. En pesos enteros
    // sería $3 o $4 — 14% de error en el margen. En milésimas: 3500.
    const c = recalcAverageCost({
      prevBalanceBaseMilli: 0,
      prevCostNetMilliPeso: 0,
      incomingBaseMilli: 1_000_000,
      incomingTotalCostNet: 3_500,
    });
    expect(c).toBe(3_500);
  });
});

describe("roundSym", () => {
  it("aleja del cero en el 0,5 exacto", () => {
    expect(roundSym(2.5)).toBe(3);
    expect(roundSym(-2.5)).toBe(-3);
  });
});

describe("formato de plata negativa y horas", () => {
  /**
   * `$-10.000` se lee como un guion perdido en medio del número, sobre todo en
   * una columna angosta. Se vio en la tabla de movimientos de caja.
   */
  it("el signo va delante del peso", () => {
    expect(formatCLP(-10_000)).toBe("-$10.000");
    expect(formatCLP(10_000)).toBe("$10.000");
    expect(formatCLP(0)).toBe("$0");
    expect(formatCLP(-500)).toBe("-$500");
  });

  it("la hora va en 24 horas, no en 'p. m.'", () => {
    const tarde = new Date(2026, 6, 30, 21, 1);
    expect(formatHora(tarde)).toBe("21:01");
    expect(formatHora(new Date(2026, 6, 30, 9, 5))).toBe("09:05");
  });
});

describe("costo por unidad (no es un monto: lleva decimales)", () => {
  /**
   * La razón de ser de las milésimas (decisión sellada 2). Mostrar "$4" donde
   * el costo es $3,5 es un 14% de error a la vista, justo en el número con el
   * que se calcula el margen.
   */
  it("un tarugo de $3,5 no se muestra como $4", () => {
    expect(formatCostoMilli(3_500)).toBe("$3,5");
  });

  it("dos decimales bastan: un metro de cable a $485,587", () => {
    expect(formatCostoMilli(485_587)).toBe("$485,59");
  });

  it("un costo redondo no arrastra ceros de relleno", () => {
    expect(formatCostoMilli(450_000)).toBe("$450");
  });

  it("el signo va delante del peso, igual que en formatCLP", () => {
    expect(formatCostoMilli(-3_500)).toBe("-$3,5");
  });
});
