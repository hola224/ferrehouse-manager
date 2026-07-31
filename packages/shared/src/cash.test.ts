import { describe, it, expect } from "vitest";
import { estadoArqueo, saldoEsperado, cashMovementSchema, cashOpenSchema, CASH_MOVEMENT_TEXT } from "./cash.js";

describe("lectura del arqueo", () => {
  const LIMITE = 2000; // el valor por omisión de `alert.cashDiffLimit`

  it("sin diferencia, cuadra", () => {
    const e = estadoArqueo(0, LIMITE);
    expect(e.tono).toBe("ok");
    expect(e.palabra).toBe("cuadrada");
    expect(e.franja).toBe(false);
  });

  it("una diferencia dentro del límite avisa pero no alarma", () => {
    const e = estadoArqueo(-1500, LIMITE);
    expect(e.tono).toBe("warn");
    expect(e.palabra).toBe("falta poco");
    expect(e.mensaje).toContain("$1.500");
    expect(e.franja).toBe(false);
  });

  it("justo en el límite todavía es tolerado", () => {
    expect(estadoArqueo(-2000, LIMITE).tono).toBe("warn");
    expect(estadoArqueo(-2001, LIMITE).tono).toBe("error");
  });

  /**
   * Que SOBRE plata no es una buena noticia: significa que algo no se
   * registró. Por eso el umbral se compara en valor absoluto y el mensaje
   * nombra la causa probable.
   */
  it("que sobre descuadra igual que si faltara", () => {
    const e = estadoArqueo(15_000, LIMITE);
    expect(e.tono).toBe("error");
    expect(e.palabra).toBe("descuadrada");
    expect(e.mensaje).toContain("venta cobrada y no registrada");
    expect(e.franja).toBe(true);
  });

  /** La franja diagonal se reserva para el descuadre grave: una por pantalla. */
  it("solo el descuadre grave pide la franja", () => {
    expect(estadoArqueo(0, LIMITE).franja).toBe(false);
    expect(estadoArqueo(-1000, LIMITE).franja).toBe(false);
    expect(estadoArqueo(-9000, LIMITE).franja).toBe(true);
  });

  /** Color y palabra siempre juntos: hay daltonismo en el mesón. */
  it("todo estado trae palabra, no solo color", () => {
    for (const d of [0, -500, -5000, 500, 5000]) {
      const e = estadoArqueo(d, LIMITE);
      expect(e.palabra.length).toBeGreaterThan(3);
      expect(e.mensaje.length).toBeGreaterThan(10);
    }
  });
});

describe("saldo esperado", () => {
  it("suma los montos con signo, sin recalcular desde la apertura", () => {
    expect(saldoEsperado([{ amount: 50_000 }, { amount: -10_000 }, { amount: 5_000 }])).toBe(45_000);
  });

  it("sin movimientos, cero", () => {
    expect(saldoEsperado([])).toBe(0);
  });
});

describe("entradas", () => {
  it("el motivo es obligatorio y explica por qué", () => {
    const r = cashMovementSchema.safeParse({ type: "WITHDRAWAL", amount: 1000, description: "" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]!.message).toContain("indistinguible de plata que falta");
  });

  it("no se acepta plata con decimales", () => {
    expect(cashOpenSchema.safeParse({ openingAmount: 1000.5 }).success).toBe(false);
    expect(cashOpenSchema.safeParse({ openingAmount: 1000 }).success).toBe(true);
  });

  it("el monto es siempre positivo: el signo lo pone el servidor según el tipo", () => {
    const r = cashMovementSchema.safeParse({ type: "WITHDRAWAL", amount: -1000, description: "Flete" });
    expect(r.success).toBe(false);
  });

  it("solo hay retiros e ingresos: una venta no se teclea a mano", () => {
    expect(cashMovementSchema.safeParse({ type: "SALE", amount: 1000, description: "Venta" }).success).toBe(false);
  });

  it("los tipos del libro tienen nombre en castellano", () => {
    expect(CASH_MOVEMENT_TEXT.OPENING).toBe("Apertura");
    expect(CASH_MOVEMENT_TEXT.WITHDRAWAL).toBe("Retiro");
  });
});
