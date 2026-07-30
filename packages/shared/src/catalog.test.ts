import { describe, it, expect } from "vitest";
import {
  normalizeSearch,
  buildSearchKey,
  normalizeBarcode,
  barcodeSchema,
  productInputSchema,
  validarUnidades,
  describirConversion,
  puedeEditarCosto,
  parsePesos,
  parseCantidadMilli,
  validarFraccion,
  supplierInputSchema,
  type UnitLike,
} from "./catalog.js";

const metro: UnitLike = { id: 5, groupId: 2, name: "Metro", symbol: "m", factorMilli: 1000 };
const rollo100: UnitLike = { id: 6, groupId: 2, name: "Rollo 100 m", symbol: "rl100", factorMilli: 100_000 };
const kilo: UnitLike = { id: 1, groupId: 1, name: "Kilogramo", symbol: "kg", factorMilli: 1000 };
const litro: UnitLike = { id: 23, groupId: 4, name: "Litro", symbol: "L", factorMilli: 1000 };

describe("clave de búsqueda", () => {
  /**
   * Este es el bug que la columna `searchKey` vino a evitar: sin normalizar,
   * SQLite no encuentra "Cañería" buscando "caneria" ni "CAÑERIA".
   */
  it("saca tildes y mayúsculas, incluida la ñ", () => {
    expect(normalizeSearch("Cañería")).toBe("caneria");
    expect(normalizeSearch("CAÑERÍA")).toBe("caneria");
    expect(normalizeSearch("Válvula Ángulo")).toBe("valvula angulo");
  });

  it("colapsa los espacios de más", () => {
    expect(normalizeSearch("  Tubo   PVC  ")).toBe("tubo pvc");
  });

  it("las tres formas de buscar el mismo producto caen en la misma clave", () => {
    const clave = buildSearchKey({
      name: "Cañería PVC 110 mm",
      sku: "FH-00042",
      barcodes: ["7801234567890"],
    });
    expect(clave).toContain("caneria pvc 110 mm");
    expect(clave).toContain("fh-00042");
    expect(clave).toContain("7801234567890");
  });
});

describe("códigos de barra", () => {
  it("normaliza espacios y mayúsculas antes de comparar", () => {
    expect(normalizeBarcode("  780 123 4567890 ")).toBe("7801234567890");
    expect(normalizeBarcode("ab-12cd")).toBe("AB-12CD");
  });

  it("acepta un EAN-13 y un código de proveedor", () => {
    expect(barcodeSchema.parse("7801234567890")).toBe("7801234567890");
    expect(barcodeSchema.parse("vulco-9912")).toBe("VULCO-9912");
  });

  it("rechaza lo que no es un código", () => {
    expect(() => barcodeSchema.parse("12")).toThrow();
    expect(() => barcodeSchema.parse("perno de 5/8")).toThrow();
  });
});

describe("el invariante de unidades (tarea 1.7)", () => {
  it("comprar en rollo y vender en metro está bien: los dos son LONGITUD", () => {
    expect(validarUnidades(metro, rollo100)).toBeNull();
  });

  /**
   * El caso del diluyente de `.agents/SEED.md`: comprar en litros y vender en
   * kilos convierte igual —los dos son números— pero sobre magnitudes
   * distintas, y el kardex miente un 13% sin que nadie lo note.
   */
  it("comprar en litros y vender en kilos se rechaza", () => {
    const error = validarUnidades(kilo, litro);
    expect(error).toBeTruthy();
    expect(error).toContain("magnitudes distintas");
  });

  it("explica la conversión en castellano", () => {
    expect(describirConversion(metro, rollo100)).toBe(
      "Se compra en Rollo 100 m, se vende en Metro: cada Rollo 100 m rinde 100 m.",
    );
    expect(describirConversion(kilo, kilo)).toBe("Se compra y se vende en Kilogramo (kg).");
  });
});

describe("el costo se digita solo hasta el primer movimiento", () => {
  it("sin movimientos se puede teclear", () => {
    expect(puedeEditarCosto(0)).toBe(true);
  });

  it("con un movimiento lo manda el libro", () => {
    expect(puedeEditarCosto(1)).toBe(false);
  });
});

describe("lectura de números tecleados o pegados de Excel", () => {
  it("el punto en un precio es de miles, nunca decimal", () => {
    // El peso no tiene decimales: "12.990" son doce mil novecientos noventa.
    expect(parsePesos("12.990")).toBe(12990);
    expect(parsePesos("$12.990")).toBe(12990);
    expect(parsePesos("690")).toBe(690);
    expect(parsePesos("")).toBeNull();
    expect(parsePesos("mil pesos")).toBeNull();
  });

  it("la coma es el decimal de las cantidades", () => {
    expect(parseCantidadMilli("7,5")).toBe(7500);
    expect(parseCantidadMilli("1.250,75")).toBe(1_250_750);
    expect(parseCantidadMilli("7")).toBe(7000);
  });

  it("acepta el punto decimal de un Excel en inglés", () => {
    expect(parseCantidadMilli("7.5")).toBe(7500);
    // Pero un punto seguido de tres dígitos y nada más sigue siendo de miles.
    expect(parseCantidadMilli("1.250")).toBe(1250);
  });

  it("redondea simétrico: la cantidad negativa no se corre", () => {
    expect(parseCantidadMilli("-2,0005")).toBe(-2001);
    expect(parseCantidadMilli("2,0005")).toBe(2001);
  });

  it("un número de Excel llega como número, no como texto", () => {
    expect(parseCantidadMilli(7.5)).toBe(7500);
    expect(parsePesos(12990)).toBe(12990);
  });
});

describe("fracciones", () => {
  it("medio tornillo no existe", () => {
    expect(validarFraccion(1500, false, "Unidad")).toContain("no se vende fraccionada");
    expect(validarFraccion(2000, false, "Unidad")).toBeNull();
  });

  it("medio metro de cable sí", () => {
    expect(validarFraccion(1500, true, "Metro")).toBeNull();
  });
});

describe("esquema del producto", () => {
  const base = { name: "Cable 2,5 mm", saleUnitId: 5, purchaseUnitId: 6, priceGross: 690 };

  it("acepta lo mínimo y pone los valores por omisión", () => {
    const p = productInputSchema.parse(base);
    expect(p.barcodes).toEqual([]);
    expect(p.reorderLevelBaseMilli).toBe(0);
    expect(p.active).toBe(true);
  });

  it("un precio con decimales se rechaza con mensaje, no con 'invalid_type'", () => {
    const r = productInputSchema.safeParse({ ...base, priceGross: 690.5 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toContain("pesos enteros");
  });

  it("el precio negativo se rechaza", () => {
    expect(productInputSchema.safeParse({ ...base, priceGross: -1 }).success).toBe(false);
  });

  it("normaliza los códigos de barra que vienen en la carga", () => {
    const p = productInputSchema.parse({ ...base, barcodes: [" 780123456789 0 ", "vulco-1"] });
    expect(p.barcodes).toEqual(["7801234567890", "VULCO-1"]);
  });
});

describe("proveedor", () => {
  it("normaliza el RUT como lo pide el SII", () => {
    expect(supplierInputSchema.parse({ name: "Vulco", rut: "76.543.210-k" }).rut).toBe("76543210-K");
  });

  it("rechaza un RUT que no tiene forma de RUT", () => {
    expect(supplierInputSchema.safeParse({ name: "Vulco", rut: "76543210" }).success).toBe(false);
  });
});
