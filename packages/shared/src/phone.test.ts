import { describe, it, expect } from "vitest";
import { normalizarTelefono, formatTelefono } from "./phone.js";

function e164(entrada: string): string | null {
  const r = normalizarTelefono(entrada);
  return r.ok ? r.e164 : null;
}

describe("teléfonos a E.164", () => {
  /**
   * EL TEST QUE JUSTIFICA EL ARCHIVO. `Customer.phone` es único: si dos de
   * estas formas dan strings distintos, el mismo cliente entra dos veces y su
   * baja protege solo a una de las dos filas.
   */
  it("las siete formas de escribir el mismo celular dan UN string", () => {
    const formas = [
      "912345678",
      "+56912345678",
      "56912345678",
      "9 1234 5678",
      "+56 9 1234 5678",
      "09-1234-5678",
      "0056912345678",
    ];
    const normalizados = new Set(formas.map(e164));
    expect(normalizados).toEqual(new Set(["+56912345678"]));
  });

  it("un fijo de Concepción también colapsa a una sola forma", () => {
    const formas = ["412123456", "+56412123456", "(41) 212 3456", "041 2123456"];
    expect(new Set(formas.map(e164))).toEqual(new Set(["+56412123456"]));
  });

  it("distingue móvil de fijo", () => {
    const movil = normalizarTelefono("+56912345678");
    const fijo = normalizarTelefono("412123456");
    expect(movil.ok && movil.tipo).toBe("MOVIL");
    expect(fijo.ok && fijo.tipo).toBe("FIJO");
  });

  it("el largo manda: 8 y 10 dígitos se rechazan", () => {
    expect(normalizarTelefono("12345678").ok).toBe(false);
    expect(normalizarTelefono("9123456789").ok).toBe(false);
  });

  it("rechaza lo que no abre ningún código de área ni es celular", () => {
    // El 8 no abre código de área en Chile; el 1 tampoco.
    expect(normalizarTelefono("812345678").ok).toBe(false);
    expect(normalizarTelefono("112345678").ok).toBe(false);
  });

  it("una letra colada no se ignora como si fuera un separador", () => {
    // `9l2345678`: la ele por el uno. Si se filtraran los no-dígitos sin más,
    // quedarían 8 dígitos y el error diría "faltan dígitos" en vez de la causa.
    const r = normalizarTelefono("9l2345678");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toMatch(/solo números/);
  });

  it("vacío y nulo dan error, no una excepción", () => {
    expect(normalizarTelefono("").ok).toBe(false);
    expect(normalizarTelefono(null).ok).toBe(false);
    expect(normalizarTelefono(undefined).ok).toBe(false);
  });

  it("los errores dicen qué corregir, no 'inválido'", () => {
    const corto = normalizarTelefono("91234");
    expect(corto.ok === false && corto.error).toMatch(/9 dígitos/);
    expect(corto.ok === false && corto.error).toMatch(/5/); // cuántos escribió
  });

  it("normalizar es idempotente: lo guardado vuelve a dar lo guardado", () => {
    const primero = e164("9 1234 5678")!;
    expect(e164(primero)).toBe(primero);
  });

  it("se muestra separado, pero se guarda pegado", () => {
    expect(formatTelefono("+56912345678")).toBe("+56 9 1234 5678");
    expect(formatTelefono("+56412123456")).toBe("+56 41 212 3456");
  });

  it("lo que no se puede formatear se muestra tal cual, no se pierde", () => {
    expect(formatTelefono("basura")).toBe("basura");
  });
});
