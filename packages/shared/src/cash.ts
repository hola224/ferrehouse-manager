/**
 * Caja: validación y lectura del arqueo (Sprint 2).
 *
 * Dos cosas viven acá y no en el servidor, por el mismo motivo que el catálogo:
 * la pantalla de cierre y el ticket impreso tienen que decir EXACTAMENTE lo
 * mismo sobre una diferencia. Si cada uno decide su propio umbral o su propia
 * palabra, el papel y la pantalla se contradicen delante del dueño.
 */
import { z } from "zod";
import { formatCLP } from "./money.js";

// ============================================================
// Entradas
// ============================================================

/** Plata que se teclea: pesos enteros, nunca negativa. */
const pesos = (que: string) =>
  z
    .number()
    .int(`${que} va en pesos enteros: el peso chileno no tiene decimales`)
    .min(0, `${que} no puede ser negativa`);

export const cashOpenSchema = z.object({
  openingAmount: pesos("La apertura"),
});

/**
 * El signo NO viaja desde el cliente: lo pone el servidor según el tipo. Si el
 * cliente pudiera mandar `-5000` en un DEPOSIT, un error de tipeo en la
 * pantalla se convertiría en un retiro sin motivo registrado.
 */
export const cashMovementSchema = z.object({
  type: z.enum(["WITHDRAWAL", "DEPOSIT"], {
    errorMap: () => ({ message: "El movimiento es un retiro o un ingreso" }),
  }),
  amount: pesos("La cantidad").refine((n) => n > 0, "La cantidad tiene que ser mayor que cero"),
  /**
   * El motivo es obligatorio y no es burocracia: un retiro sin motivo es
   * indistinguible de plata que falta, y a fin de mes nadie se acuerda.
   */
  description: z
    .string()
    .trim()
    .min(3, "Escribe el motivo: sin él, un retiro es indistinguible de plata que falta")
    .max(120),
});

export const cashCloseSchema = z.object({
  countedAmount: pesos("Lo contado"),
  notes: z.string().trim().max(300).nullable().optional(),
});

export type CashMovementInput = z.infer<typeof cashMovementSchema>;

/** Los tipos que existen en el libro de caja. */
export const CASH_MOVEMENT_TYPES = ["OPENING", "SALE", "REFUND", "WITHDRAWAL", "DEPOSIT", "CLOSING"] as const;
export type CashMovementType = (typeof CASH_MOVEMENT_TYPES)[number];

export const CASH_MOVEMENT_TEXT: Record<CashMovementType, string> = {
  OPENING: "Apertura",
  SALE: "Venta",
  REFUND: "Devolución",
  WITHDRAWAL: "Retiro",
  DEPOSIT: "Ingreso",
  CLOSING: "Cierre",
};

// ============================================================
// El arqueo
// ============================================================

export type EstadoArqueo = {
  /** Para el color. Nunca va solo: siempre acompañado de `palabra`. */
  tono: "ok" | "warn" | "error";
  /** La palabra que se lee. Sin esto, un vendedor daltónico no ve diferencia. */
  palabra: string;
  /** Frase completa, la misma en pantalla y en el papel. */
  mensaje: string;
  /**
   * Solo el descuadre grave lleva la franja diagonal amarillo/negro
   * (UI-BRIEF §4). Una por pantalla como máximo: si hay dos, ninguna se mira.
   */
  franja: boolean;
};

/**
 * Cómo se lee una diferencia de caja.
 *
 * `diferencia = contado − esperado`. Positiva sobra plata, negativa falta.
 *
 * Los mensajes están en PASADO —"quedó registrado", no "antes de cerrar"—
 * porque cuando este texto se lee, la caja YA está cerrada. Con conteo ciego no
 * hay otra forma: el esperado no se puede mostrar sin comprometer el conteo, y
 * comprometerlo es cerrar. El aviso de "revisa bien" va en el paso anterior,
 * que es donde todavía se puede volver atrás. Un texto que pide algo imposible
 * enseña a no leer los textos.
 *
 * Que sobre NO es bueno: significa que algo no se registró —una venta cobrada
 * y no ingresada, un vuelto mal dado— y es tan sintomático como que falte. Por
 * eso el umbral se compara en valor absoluto.
 */
export function estadoArqueo(diferencia: number, limite: number): EstadoArqueo {
  if (diferencia === 0) {
    return { tono: "ok", palabra: "cuadrada", mensaje: "La caja cuadra exacto.", franja: false };
  }

  const falta = diferencia < 0;
  const monto = formatCLP(Math.abs(diferencia));
  const verbo = falta ? "Faltan" : "Sobran";

  if (Math.abs(diferencia) <= limite) {
    return {
      tono: "warn",
      palabra: falta ? "falta poco" : "sobra poco",
      mensaje: `${verbo} ${monto}. Está dentro de lo tolerado, y quedó registrado.`,
      franja: false,
    };
  }

  return {
    tono: "error",
    palabra: "descuadrada",
    mensaje: falta
      ? `Faltan ${monto}. Quedó registrado y el administrador tiene una alerta.`
      : `Sobran ${monto}. Suele ser una venta cobrada y no registrada. Quedó registrado y el administrador tiene una alerta.`,
    franja: true,
  };
}

/**
 * Saldo esperado a partir del libro. Se suma, no se recalcula desde la
 * apertura: cada movimiento ya trae su monto con signo, y sumar enteros exactos
 * nunca acumula error.
 */
export function saldoEsperado(movimientos: readonly { amount: number }[]): number {
  return movimientos.reduce((t, m) => t + m.amount, 0);
}
