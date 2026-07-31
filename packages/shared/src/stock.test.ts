import { describe, it, expect } from "vitest";
import {
  STOCK_MOVEMENT_TYPES,
  STOCK_RULES,
  conSigno,
  ingresa,
  exigeMotivo,
  recalcAverageCost,
} from "./index.js";

describe("tabla de tipos de movimiento", () => {
  it("todo tipo del schema tiene regla", () => {
    for (const t of STOCK_MOVEMENT_TYPES) expect(STOCK_RULES[t]).toBeDefined();
  });

  it("ningún movimiento que saca mercadería recalcula el promedio", () => {
    for (const t of STOCK_MOVEMENT_TYPES) {
      if (STOCK_RULES[t].direccion === "OUT") expect(STOCK_RULES[t].recalculaPmp).toBe(false);
    }
  });

  it("el signo lo pone el tipo, no quien llama", () => {
    expect(conSigno("PURCHASE", -5000)).toBe(5000);
    expect(conSigno("SALE", 5000)).toBe(-5000);
    // El ajuste es el único donde el usuario decide la dirección.
    expect(conSigno("ADJUSTMENT", -5000)).toBe(-5000);
    expect(conSigno("ADJUSTMENT", 5000)).toBe(5000);
  });

  it("un ajuste negativo no recalcula el promedio", () => {
    expect(ingresa("ADJUSTMENT", 1000)).toBe(true);
    expect(ingresa("ADJUSTMENT", -1000)).toBe(false);
  });

  it("ajuste y merma exigen motivo; la compra no", () => {
    expect(exigeMotivo("ADJUSTMENT")).toBe(true);
    expect(exigeMotivo("SHRINKAGE")).toBe(true);
    expect(exigeMotivo("PURCHASE")).toBe(false);
  });
});

describe("promedio ponderado con saldo anterior negativo (tarea 4.2)", () => {
  /**
   * El estado real con que llega este sprint: el Sprint 3 vendió contra stock
   * sin cargar, así que hay saldos negativos. Promediar contra ellos da un
   * costo por debajo de lo que se acaba de pagar.
   */
  it("con saldo negativo, el costo del ingreso pasa a ser el costo del producto", () => {
    const nuevo = recalcAverageCost({
      prevBalanceBaseMilli: -5000, // se vendieron 5 sin tener ninguno
      prevCostNetMilliPeso: 1_000_000, // $1.000 tecleado al crear el producto
      incomingBaseMilli: 100_000, // entran 100
      incomingTotalCostNet: 120_000, // a $1.200 cada uno
    });
    expect(nuevo).toBe(1_200_000);
  });

  it("con saldo positivo pondera normal", () => {
    const nuevo = recalcAverageCost({
      prevBalanceBaseMilli: 100_000,
      prevCostNetMilliPeso: 1_000_000,
      incomingBaseMilli: 100_000,
      incomingTotalCostNet: 120_000,
    });
    expect(nuevo).toBe(1_100_000);
  });
});
