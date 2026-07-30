import { describe, it, expect } from "vitest";
import { formatSku, skuRange } from "./sku.js";

describe("SKU", () => {
  it("formato FH-00001", () => {
    expect(formatSku(1)).toBe("FH-00001");
    expect(formatSku(12345)).toBe("FH-12345");
  });

  it("no se queda corto al pasar el padding", () => {
    expect(formatSku(123456)).toBe("FH-123456");
  });

  it("un rango reservado es contiguo", () => {
    expect(skuRange(10, 3)).toEqual(["FH-00010", "FH-00011", "FH-00012"]);
  });

  it("rechaza correlativos inválidos", () => {
    expect(() => formatSku(0)).toThrow();
    expect(() => formatSku(1.5)).toThrow();
  });
});
