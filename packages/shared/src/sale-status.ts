/**
 * Las etiquetas visibles de una venta (STATE.md §Diseño de interfaz).
 *
 * NO son un campo: se derivan. La decisión sellada 7 dice que no existe un
 * estado "parcialmente devuelta" en la base, y eso sigue siendo cierto — los
 * reportes de plata suman todas las filas sin filtrar. Esto es solo la etiqueta
 * que ve el usuario, y se calcula en el servidor para que las pantallas no la
 * reinventen cada una a su manera.
 */
import { resumirLineas, type LineaConReversas } from "./returns.js";

export type SaleStatusLabel =
  | "COMPLETADA"
  | "CON_DEVOLUCIONES"
  | "DEVUELTA"
  | "ANULADA"
  | "DEVOLUCION"
  | "ANULACION";

export const SALE_STATUS_TEXT: Record<SaleStatusLabel, string> = {
  COMPLETADA: "Completada",
  CON_DEVOLUCIONES: "Con devoluciones",
  DEVUELTA: "Devuelta",
  ANULADA: "Anulada",
  DEVOLUCION: "Devolución",
  ANULACION: "Anulación",
};

/** Token de color; el valor concreto sale de tokens.css, nunca de acá. */
export const SALE_STATUS_TONE: Record<SaleStatusLabel, "ok" | "warn" | "error" | "neutral"> = {
  COMPLETADA: "ok",
  CON_DEVOLUCIONES: "warn",
  DEVUELTA: "warn",
  ANULADA: "error",
  DEVOLUCION: "neutral",
  ANULACION: "neutral",
};

/**
 * La versión que se usa contra la base: recibe las líneas con sus reversas y
 * deriva la cantidad devuelta con `resumirLineas`, que es la única función que
 * sabe sumar eso. `deriveSaleStatus` queda debajo para poder probarla con
 * tablas de casos sin armar filas de reversa.
 */
export function etiquetaDeVenta(sale: {
  status: string;
  reversalKind: string | null;
  items: LineaConReversas[];
}): SaleStatusLabel {
  return deriveSaleStatus({ ...sale, items: resumirLineas(sale.items) });
}

export function deriveSaleStatus(sale: {
  status: string;
  reversalKind: string | null;
  items: Array<{ qtyMilli: number; returnedQtyMilli: number }>;
}): SaleStatusLabel {
  // La fila que ES la reversa: documento propio, aparece en el listado del día
  // con su folio de nota de crédito.
  if (sale.reversalKind === "VOID") return "ANULACION";
  if (sale.reversalKind === "RETURN") return "DEVOLUCION";

  if (sale.status === "REVERSED") return "ANULADA";

  const devuelto = sale.items.reduce((n, i) => n + Math.abs(i.returnedQtyMilli), 0);
  if (devuelto === 0) return "COMPLETADA";

  // Agotada línea por línea: anularla se rechaza, ya no queda nada vivo.
  const agotada = sale.items.every((i) => Math.abs(i.returnedQtyMilli) >= i.qtyMilli);
  return agotada ? "DEVUELTA" : "CON_DEVOLUCIONES";
}
