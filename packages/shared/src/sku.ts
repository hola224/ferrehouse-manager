/**
 * SKU interno (tarea 0.9). El correlativo sale de la tabla `Counter`, y se
 * reserva un RANGO por operación: el importador de Excel carga 500 productos
 * de una vez, y pedir un número por fila son 500 escrituras serializadas
 * (connection_limit=1) contra una misma fila.
 *
 * El SKU nunca se reutiliza, ni siquiera tras `deletedAt`: está impreso en
 * etiquetas pegadas en la repisa.
 */

export const SKU_COUNTER = "product.sku";

export function formatSku(n: number, prefix = "FH-", padding = 5): string {
  if (!Number.isInteger(n) || n < 1) throw new Error(`Correlativo de SKU inválido: ${n}`);
  return `${prefix}${String(n).padStart(padding, "0")}`;
}

/** Los `count` SKU de un rango reservado que empieza en `from` (inclusive). */
export function skuRange(from: number, count: number, prefix = "FH-", padding = 5): string[] {
  return Array.from({ length: count }, (_, i) => formatSku(from + i, prefix, padding));
}

export const SKU_PATTERN = /^[A-Z]{2,4}-\d{4,12}$/;
