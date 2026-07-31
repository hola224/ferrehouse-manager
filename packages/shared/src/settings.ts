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
  /**
   * Respaldo (7.2). La carpeta va relativa a la base de datos si no es
   * absoluta: así el default funciona en cualquier PC sin configurar nada.
   */
  "backup.dir": texto("respaldos", "Carpeta de respaldos, junto a la base si es relativa"),
  /**
   * **Lo que convierte el snapshot en respaldo.** Un archivo en el mismo disco
   * no protege del caso que este sprint declara: se perdió el PC. Vacío = sin
   * copia externa, y el panel lo dice en vez de callarlo.
   */
  "backup.copyTo": texto("", "Carpeta externa (pendrive o nube). Vacío = sin copia"),
  "backup.keepDays": entero(30, "Días que se guardan los respaldos", (s) => s.min(1)),
  /**
   * 13:00 y no las 22: a las diez de la noche el PC de una ferretería está
   * apagado. La hora es una preferencia; que exista un respaldo del día lo
   * asegura la regla de las 24 horas (ver `backup.ts` en shared).
   */
  "backup.hour": entero(13, "Hora del respaldo diario (0-23)", (s) => s.min(0).max(23)),
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
