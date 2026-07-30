/**
 * Registro central de settings (tarea 0.8 + SEED.md §6).
 *
 * El default y el tipo lógico viven acá y en ningún otro lado: el seed hace
 * upsert desde este registro y `getSetting` valida contra el mismo esquema.
 * Duplicar el default en el seed y en el lector es cómo terminan discrepando.
 *
 * En la base todo se guarda como TEXTO (SQLite, sin Json ni enum): cada entrada
 * define cómo se serializa y cómo se parsea.
 */
import { z } from "zod";

type Entry<T> = {
  schema: z.ZodType<T>;
  default: T;
  parse: (raw: string) => unknown;
  serialize: (v: T) => string;
  descripcion: string;
};

const texto = (def: string, descripcion: string): Entry<string> => ({
  schema: z.string(),
  default: def,
  parse: (raw) => raw,
  serialize: (v) => v,
  descripcion,
});

const entero = (def: number, descripcion: string, extra?: (s: z.ZodNumber) => z.ZodNumber): Entry<number> => ({
  schema: extra ? extra(z.number().int()) : z.number().int(),
  default: def,
  parse: (raw) => (raw.trim() === "" ? NaN : Number(raw)),
  serialize: (v) => String(v),
  descripcion,
});

const booleano = (def: boolean, descripcion: string): Entry<boolean> => ({
  schema: z.boolean(),
  default: def,
  parse: (raw) => raw === "true",
  serialize: (v) => (v ? "true" : "false"),
  descripcion,
});

export const SETTINGS = {
  "store.name": texto("Ferrehouse", "Nombre que sale en el ticket"),
  "tax.rate": entero(19, "IVA vigente en %. Se congela en cada venta", (s) => s.min(0).max(100)),
  "cash.roundTo": entero(10, "Múltiplo de redondeo del efectivo", (s) => s.min(1)),
  "stock.allowNegative": booleano(false, "Permitir vender bajo cero sin autorización"),
  "stock.adminOverride": booleano(true, "El admin puede autorizar venta sin stock"),
  "discount.maxSeller": entero(5, "Tope de descuento del vendedor, en % sobre el TOTAL", (s) => s.min(0).max(100)),
  "alert.cashDiffLimit": entero(2000, "Diferencia de caja que dispara alerta, en pesos", (s) => s.min(0)),
  "ui.showLocations": booleano(false, "Mostrar ubicaciones en la interfaz"),
  "sku.prefix": texto("FH-", "Prefijo del SKU interno"),
  "sku.padding": entero(5, "Dígitos del correlativo de SKU", (s) => s.min(1).max(12)),
  "pos.suspendedStaleHours": entero(48, "Horas para considerar añeja una venta en espera", (s) => s.min(1)),
  "print.maxAttempts": entero(3, "Reintentos de impresión", (s) => s.min(1)),
  "whatsapp.maxAttempts": entero(5, "Reintentos de envío de WhatsApp", (s) => s.min(1)),
  "whatsapp.template": texto(
    "Hola {nombre}, gracias por tu compra en Ferrehouse por {total}.",
    "Plantilla del mensaje post-venta",
  ),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]["default"];

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];

/** Parsea y valida el texto crudo de la base. Lanza si no calza con el esquema. */
export function parseSetting<K extends SettingKey>(key: K, raw: string): SettingValue<K> {
  const entry = SETTINGS[key] as Entry<SettingValue<K>>;
  return entry.schema.parse(entry.parse(raw)) as SettingValue<K>;
}

export function serializeSetting<K extends SettingKey>(key: K, value: SettingValue<K>): string {
  const entry = SETTINGS[key] as Entry<SettingValue<K>>;
  return entry.serialize(entry.schema.parse(value));
}

export function defaultSettingRaw<K extends SettingKey>(key: K): string {
  const entry = SETTINGS[key] as Entry<SettingValue<K>>;
  return entry.serialize(entry.default);
}
