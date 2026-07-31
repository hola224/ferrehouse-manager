/**
 * El libro de stock: qué significa cada tipo de movimiento (Sprint 4).
 *
 * Acá no hay base de datos. Es la tabla que contesta, para cada tipo, tres
 * preguntas que hoy están repartidas en comentarios de `schema.prisma` y en la
 * lista de invariantes de `SPRINTS.md`:
 *
 *   1. ¿entra o sale mercadería?
 *   2. ¿recalcula el costo promedio?
 *   3. ¿exige motivo escrito?
 *
 * Tenerlas en un solo lugar es lo que permite que el escritor del libro sea uno
 * solo. Con la tabla repartida, cada ruta decide por su cuenta y basta que una
 * se equivoque de signo para que el saldo quede mal sin que nada reclame.
 */

import { z } from "zod";
import { roundSym } from "./money.js";

export const STOCK_MOVEMENT_TYPES = [
  "INITIAL",
  "PURCHASE",
  "SALE",
  "RETURN_IN",
  "ADJUSTMENT",
  "SHRINKAGE",
  "TRANSFER_IN",
  "TRANSFER_OUT",
] as const;

export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/**
 * `SIGNED` es solo del ajuste: es el único tipo donde el usuario decide si
 * suma o resta. Todos los demás tienen el signo determinado por lo que son —
 * una compra jamás saca mercadería— y por eso el signo lo pone el servidor y
 * no viaja en la petición.
 */
type Direccion = "IN" | "OUT" | "SIGNED";

type Regla = {
  direccion: Direccion;
  /**
   * El PMP lo recalculan SOLO los que ingresan. Sacar mercadería no cambia lo
   * que costó la que queda: si el egreso tocara el promedio, vender barato
   * abarataría el inventario restante, que es exactamente al revés.
   */
  recalculaPmp: boolean;
  exigeMotivo: boolean;
  etiqueta: string;
  /** Token de color del chip en el kardex; el valor sale de tokens.css. */
  tono: "ok" | "warn" | "error" | "neutral";
};

export const STOCK_RULES: Record<StockMovementType, Regla> = {
  INITIAL: {
    direccion: "IN",
    recalculaPmp: true,
    exigeMotivo: false,
    etiqueta: "Inventario inicial",
    tono: "neutral",
  },
  PURCHASE: { direccion: "IN", recalculaPmp: true, exigeMotivo: false, etiqueta: "Compra", tono: "ok" },
  SALE: { direccion: "OUT", recalculaPmp: false, exigeMotivo: false, etiqueta: "Venta", tono: "neutral" },
  RETURN_IN: { direccion: "IN", recalculaPmp: true, exigeMotivo: false, etiqueta: "Devolución", tono: "warn" },
  ADJUSTMENT: { direccion: "SIGNED", recalculaPmp: true, exigeMotivo: true, etiqueta: "Ajuste", tono: "warn" },
  SHRINKAGE: { direccion: "OUT", recalculaPmp: false, exigeMotivo: true, etiqueta: "Merma", tono: "error" },
  TRANSFER_IN: { direccion: "IN", recalculaPmp: true, exigeMotivo: false, etiqueta: "Traslado entra", tono: "neutral" },
  TRANSFER_OUT: {
    direccion: "OUT",
    recalculaPmp: false,
    exigeMotivo: false,
    etiqueta: "Traslado sale",
    tono: "neutral",
  },
};

/**
 * Aplica el signo que corresponde al tipo sobre una cantidad que llega en
 * valor absoluto. Para `ADJUSTMENT` el signo ya viene en la cantidad y se
 * respeta: es el único donde el usuario decide la dirección.
 */
export function conSigno(tipo: StockMovementType, qtyBaseMilli: number): number {
  const { direccion } = STOCK_RULES[tipo];
  if (direccion === "SIGNED") return qtyBaseMilli;
  return direccion === "IN" ? Math.abs(qtyBaseMilli) : -Math.abs(qtyBaseMilli);
}

/** ¿Este movimiento, ya con signo, ingresa mercadería? */
export function ingresa(tipo: StockMovementType, qtyBaseMilliConSigno: number): boolean {
  return STOCK_RULES[tipo].recalculaPmp && qtyBaseMilliConSigno > 0;
}

export function exigeMotivo(tipo: StockMovementType): boolean {
  return STOCK_RULES[tipo].exigeMotivo;
}

/**
 * Los tipos que FIJAN el costo del producto. Es la lista que decide si el
 * costo todavía se puede teclear (decisión sellada 18).
 *
 * Ojo con la diferencia respecto de `recalculaPmp`: un ajuste positivo
 * recalcula el promedio, pero no debería ser lo que le quita al administrador
 * la posibilidad de corregir un costo mal tecleado; lo que se la quita es que
 * haya entrado mercadería con un costo propio. Hoy las dos listas coinciden
 * salvo en `ADJUSTMENT`, y se mantienen separadas porque responden preguntas
 * distintas.
 */
export const TIPOS_QUE_FIJAN_COSTO: StockMovementType[] = ["INITIAL", "PURCHASE", "RETURN_IN", "TRANSFER_IN"];

/**
 * Costo unitario de una línea de compra, en milésimas de peso por unidad BASE.
 *
 * Es la conversión que más se equivoca en todo el sistema: el proveedor cobra
 * por unidad de COMPRA (el saco, el rollo) y el libro lleva unidad BASE (el
 * kilo, el metro). Un saco de 25 kg a $4.500 son $180 el kilo, no $4.500.
 */
export function costoUnitarioBaseMilliPeso(params: {
  lineTotalNet: number;
  qtyBaseMilli: number;
}): number {
  if (params.qtyBaseMilli === 0) return 0;
  return roundSym((params.lineTotalNet * 1_000_000) / params.qtyBaseMilli);
}

// ============================================================
// Lo que se digita (tareas 4.1 y 4.3)
// ============================================================

export const purchaseItemSchema = z.object({
  productId: z.number().int().positive(),
  /**
   * La unidad en que FACTURA el proveedor, que casi nunca es la de venta: el
   * saco, el rollo, la caja. Se guarda tal cual en `PurchaseItem.unitId` para
   * que la factura se pueda releer como se digitó.
   */
  unitId: z.number().int().positive(),
  qtyMilli: z.number().int().positive("La cantidad tiene que ser mayor que cero"),
  /** Pesos exactos, NETOS, por unidad de compra. El IVA es crédito fiscal. */
  unitCostNet: z.number().int().min(0, "El costo no puede ser negativo"),
});

export const purchaseInputSchema = z.object({
  supplierId: z.number().int().positive(),
  documentNumber: z.string().trim().max(40).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  /**
   * Fecha de RECEPCIÓN, no de tecleo. La factura del viernes se digita el
   * lunes y el movimiento tiene que quedar fechado el viernes, o el valorizado
   * a una fecha y el reporte de compras del mismo día no coinciden.
   */
  receivedAt: z.coerce.date().optional(),
  items: z.array(purchaseItemSchema).min(1, "Una compra necesita al menos una línea"),
});

export type PurchaseInput = z.infer<typeof purchaseInputSchema>;

export const adjustmentInputSchema = z.object({
  productId: z.number().int().positive(),
  /** Sin unidad se entiende en la de venta, que es en la que se cuenta. */
  unitId: z.number().int().positive().optional(),
  type: z.enum(["ADJUSTMENT", "SHRINKAGE"]),
  /**
   * CON SIGNO en el ajuste: negativo saca, positivo mete. En la merma se toma
   * el valor absoluto — una merma nunca suma mercadería.
   */
  qtyMilli: z.number().int(),
  reason: z
    .string()
    .trim()
    .min(4, "Escribe el motivo: un ajuste sin motivo es un descuadre sin explicación")
    .max(200),
});

export type AdjustmentInput = z.infer<typeof adjustmentInputSchema>;
