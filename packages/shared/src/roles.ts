/**
 * Visibilidad por rol (decisión sellada 17, USR-03, tarea 0.12).
 *
 * "El vendedor no ve costos" es regla de negocio, no `display:none`. Si el
 * campo viaja en el JSON ya se puede leer en la pestaña de red del navegador,
 * y da igual que la pantalla no lo pinte.
 *
 * Por eso la lista está acá, en un solo lugar, y el servidor la aplica como
 * hook global de salida: un endpoint nuevo queda cubierto por omisión, sin que
 * nadie tenga que acordarse.
 */

export const ROLES = ["ADMIN", "SELLER", "SYSTEM"] as const;
export type Role = (typeof ROLES)[number];

/** Campos que jamás salen del servidor hacia un token de rol SELLER. */
export const FORBIDDEN_FOR_SELLER = [
  "costNetMilliPeso",
  "lineCostNet",
  "totalCostNet",
  "balanceCostNetMilliPeso",
  "unitCostNet",
  "margin",
  "marginPercent",
] as const;

const FORBIDDEN_SET: ReadonlySet<string> = new Set(FORBIDDEN_FOR_SELLER);

/**
 * Borra recursivamente los campos prohibidos. Devuelve una copia: no muta la
 * entrada, porque puede venir de un objeto de Prisma que se reutiliza.
 */
export function stripForRole<T>(payload: T, role: Role): T {
  if (role !== "SELLER") return payload;
  return strip(payload) as T;
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_SET.has(k)) continue;
    out[k] = strip(v);
  }
  return out;
}

/** Para el test de la tarea 0.12: ¿queda algún campo prohibido en el cuerpo? */
export function findForbiddenFields(payload: unknown, path = "$"): string[] {
  const hits: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (Array.isArray(v)) return v.forEach((item, i) => walk(item, `${p}[${i}]`));
    if (v === null || typeof v !== "object" || v instanceof Date) return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (FORBIDDEN_SET.has(k)) hits.push(`${p}.${k}`);
      walk(val, `${p}.${k}`);
    }
  };
  walk(payload, path);
  return hits;
}
