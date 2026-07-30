/**
 * Code128 implementado a mano necesita comprobarse contra el estándar, no
 * contra sí mismo: un código que se ve como un código de barras pero codifica
 * mal se descubre recién cuando el vendedor pasa el lector tres veces con el
 * cliente al frente.
 *
 * Los patrones de referencia salen de la especificación: Start B es
 * 11010010000 y Stop es 1100011101011.
 */
import { describe, it, expect } from "vitest";
import { code128Widths, code128Svg, esCodificableCode128B } from "./code128.js";

/** Anchos → bits. Los índices pares son barra (1), los impares espacio (0). */
function aBits(anchos: number[]): string {
  return anchos.map((ancho, i) => (i % 2 === 0 ? "1" : "0").repeat(ancho)).join("");
}

describe("code128", () => {
  it("empieza con Start B y termina con Stop, tal como los define el estándar", () => {
    const bits = aBits(code128Widths("A"));
    expect(bits.startsWith("11010010000")).toBe(true);
    expect(bits.endsWith("1100011101011")).toBe(true);
  });

  it("un símbolo son 11 módulos, y la parada 13", () => {
    // Start + 8 caracteres + dígito de control = 10 símbolos de 11, más 13.
    const anchos = code128Widths("FH-00001");
    expect(anchos.reduce((a, b) => a + b, 0)).toBe(10 * 11 + 13);
  });

  it("calcula el dígito de control de FH-00001", () => {
    // A mano: 104 + 38·1 + 40·2 + 13·3 + 16·4 + 16·5 + 16·6 + 16·7 + 17·8 = 749.
    // 749 mod 103 = 28, y el patrón 28 es 322112.
    const anchos = code128Widths("FH-00001");
    const control = anchos.slice(9 * 6, 10 * 6).join("");
    expect(control).toBe("322112");
  });

  it("cada símbolo tiene 3 barras y 3 espacios que suman 11", () => {
    const anchos = code128Widths("FH-00042");
    // Sin la barra extra del final, que pertenece a la parada.
    const simbolos = anchos.slice(0, -1);
    for (let i = 0; i < simbolos.length; i += 6) {
      expect(simbolos.slice(i, i + 6).reduce((a, b) => a + b, 0)).toBe(11);
    }
  });

  it("empieza y termina en barra, que es lo que el lector espera", () => {
    const bits = aBits(code128Widths("FH-00001"));
    expect(bits[0]).toBe("1");
    expect(bits[bits.length - 1]).toBe("1");
  });

  it("rechaza lo que el subconjunto B no codifica", () => {
    expect(esCodificableCode128B("FH-00001")).toBe(true);
    expect(esCodificableCode128B("CAÑERÍA")).toBe(false);
    expect(esCodificableCode128B("")).toBe(false);
    expect(() => code128Widths("Ñ")).toThrow();
  });

  it("el SVG es autocontenido y no trae colores propios", () => {
    const svg = code128Svg("FH-00001", { titulo: "Cable 2,5 mm", precio: "$690" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("FH-00001");
    expect(svg).toContain("Cable 2,5 mm");
    // El brief prohíbe colores fuera de los tokens: la etiqueta hereda el suyo.
    expect(svg).toContain('fill="currentColor"');
    expect(svg).not.toMatch(/#[0-9a-fA-F]{3,6}/);
  });

  it("escapa el texto en vez de romper el SVG", () => {
    const svg = code128Svg("FH-00001", { titulo: "Perno <5/8> & tuerca" });
    expect(svg).toContain("&lt;5/8&gt; &amp; tuerca");
  });
});
