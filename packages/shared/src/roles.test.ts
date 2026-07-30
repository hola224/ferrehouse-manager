import { describe, it, expect } from "vitest";
import { stripForRole, findForbiddenFields } from "./roles.js";

const venta = {
  id: 7,
  totalGross: 12990,
  items: [
    { id: 1, productId: 3, qtyMilli: 1000, lineTotalGross: 12990, lineCostNet: 8000 },
    { id: 2, productId: 4, qtyMilli: 2000, lineTotalGross: 5000, lineCostNet: 3100 },
  ],
  product: { sku: "FH-00003", costNetMilliPeso: 8_000_000, nombre: "Cable" },
};

describe("stripForRole", () => {
  it("le saca los costos al vendedor, a cualquier profundidad", () => {
    const out = stripForRole(venta, "SELLER") as any;
    expect(findForbiddenFields(out)).toEqual([]);
    expect(out.items[0].lineCostNet).toBeUndefined();
    expect(out.product.costNetMilliPeso).toBeUndefined();
  });

  it("conserva todo lo demás", () => {
    const out = stripForRole(venta, "SELLER") as any;
    expect(out.totalGross).toBe(12990);
    expect(out.items).toHaveLength(2);
    expect(out.items[0].qtyMilli).toBe(1000);
    expect(out.product.sku).toBe("FH-00003");
  });

  it("al admin no le saca nada", () => {
    const out = stripForRole(venta, "ADMIN") as any;
    expect(out.items[0].lineCostNet).toBe(8000);
  });

  it("no muta la entrada", () => {
    stripForRole(venta, "SELLER");
    expect(venta.items[0].lineCostNet).toBe(8000);
  });

  it("respeta arreglos sueltos y fechas", () => {
    const d = new Date("2026-07-30T12:00:00Z");
    const out = stripForRole([{ lineCostNet: 1, createdAt: d }], "SELLER") as any;
    expect(out[0].lineCostNet).toBeUndefined();
    expect(out[0].createdAt).toBe(d);
  });
});

describe("findForbiddenFields", () => {
  it("acusa la ruta exacta", () => {
    expect(findForbiddenFields(venta)).toEqual([
      "$.items[0].lineCostNet",
      "$.items[1].lineCostNet",
      "$.product.costNetMilliPeso",
    ]);
  });
});
