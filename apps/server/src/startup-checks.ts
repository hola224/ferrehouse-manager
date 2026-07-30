/**
 * Autochequeos de arranque (SEED.md §7).
 *
 * El servidor se NIEGA a arrancar si algo de esto falla. Son invariantes que la
 * base de datos no puede imponer y que, rotos, no dan error: dan resultados
 * equivocados. Dos `Location` marcadas por defecto no hacen fallar ninguna
 * consulta — simplemente el stock empieza a repartirse entre dos bodegas según
 * cuál devuelva primero el índice.
 */
import { db } from "./db.js";
import { SETTING_KEYS } from "@ferrehouse/shared";

export class StartupCheckError extends Error {}

export async function runStartupChecks(): Promise<string[]> {
  const fallas: string[] = [];

  const porDefecto = await db.location.count({ where: { isDefault: true } });
  if (porDefecto !== 1) fallas.push(`Debe haber exactamente una Location con isDefault=true; hay ${porDefecto}.`);

  const grupos = await db.unitGroup.findMany({ include: { units: { where: { isBase: true } } } });
  if (grupos.length === 0) fallas.push("No hay grupos de unidades: ¿se corrió el seed?");
  for (const g of grupos) {
    if (g.units.length !== 1) {
      fallas.push(`El grupo ${g.name} debe tener exactamente una unidad base; tiene ${g.units.length}.`);
    }
  }

  const system = await db.user.findFirst({ where: { role: "SYSTEM" } });
  if (!system) fallas.push("Falta el usuario SYSTEM: los jobs no pueden escribir en el libro ni auditar.");
  else if (system.active) fallas.push("El usuario SYSTEM no puede estar activo.");

  const claves = new Set((await db.setting.findMany({ select: { key: true } })).map((s) => s.key));
  const faltan = SETTING_KEYS.filter((k) => !claves.has(k));
  if (faltan.length) fallas.push(`Faltan settings: ${faltan.join(", ")}.`);

  return fallas;
}

export async function assertStartupChecks(): Promise<void> {
  const fallas = await runStartupChecks();
  if (fallas.length) {
    throw new StartupCheckError(
      "El servidor no puede arrancar:\n" + fallas.map((f) => `  · ${f}`).join("\n") + "\n\nCorre `pnpm db:seed`.",
    );
  }
}
