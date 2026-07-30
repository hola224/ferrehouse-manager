/**
 * Lector tipado de settings (tarea 0.8).
 *
 * El default y el esquema viven en `@ferrehouse/shared`, no acá: así el seed y
 * el lector no pueden discrepar. Si la fila falta o su texto está corrupto,
 * devuelve el default y lo avisa — un `tax.rate` corrupto no puede tumbar el
 * mesón en plena venta, pero tampoco puede pasar inadvertido.
 */
import { db } from "./db.js";
import { SETTINGS, parseSetting, type SettingKey, type SettingValue } from "@ferrehouse/shared";

const cache = new Map<SettingKey, unknown>();

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  if (cache.has(key)) return cache.get(key) as SettingValue<K>;
  const fila = await db.setting.findUnique({ where: { key } });
  let valor: SettingValue<K>;
  if (!fila) {
    valor = SETTINGS[key].default as SettingValue<K>;
    console.warn(`[settings] falta la fila '${key}', se usa el default`);
  } else {
    try {
      valor = parseSetting(key, fila.value);
    } catch {
      valor = SETTINGS[key].default as SettingValue<K>;
      console.warn(`[settings] '${key}' tiene un valor inválido (${fila.value}), se usa el default`);
    }
  }
  cache.set(key, valor);
  return valor;
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>): Promise<void> {
  const { serializeSetting } = await import("@ferrehouse/shared");
  const raw = serializeSetting(key, value);
  await db.setting.upsert({ where: { key }, update: { value: raw }, create: { key, value: raw } });
  cache.set(key, value);
}

export function clearSettingsCache(): void {
  cache.clear();
}
