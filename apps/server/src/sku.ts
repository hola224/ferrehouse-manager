/**
 * Generador de SKU con reserva de rango (tarea 0.9).
 *
 * Se reserva un RANGO, no un número por fila: el importador de Excel carga 500
 * productos de una vez y pedir el correlativo fila por fila son 500 escrituras
 * serializadas contra la misma fila de `Counter` (connection_limit=1).
 *
 * El incremento es atómico. Un rango entregado NO se devuelve aunque la carga
 * falle a medio camino: se pierden números, y eso está bien. El SKU está
 * impreso en etiquetas pegadas en la repisa y no se reutiliza nunca.
 */
import { db } from "./db.js";
import { SKU_COUNTER, formatSku } from "@ferrehouse/shared";
import { getSetting } from "./settings.js";
import type { Prisma } from "@prisma/client";

export async function reserveSkuRange(count: number, tx?: Prisma.TransactionClient): Promise<string[]> {
  if (!Number.isInteger(count) || count < 1) throw new Error(`Cantidad de SKU inválida: ${count}`);
  const cliente = tx ?? db;
  const contador = await cliente.counter.update({
    where: { name: SKU_COUNTER },
    data: { value: { increment: count } },
  });
  const ultimo = contador.value;
  const primero = ultimo - count + 1;

  const prefix = await getSetting("sku.prefix");
  const padding = await getSetting("sku.padding");
  return Array.from({ length: count }, (_, i) => formatSku(primero + i, prefix, padding));
}

export async function nextSku(tx?: Prisma.TransactionClient): Promise<string> {
  const [sku] = await reserveSkuRange(1, tx);
  return sku!;
}
