/**
 * Base de datos limpia para cada corrida de tests: aplica la migración inicial
 * (con sus CHECK) y siembra lo mínimo con PIN conocidos.
 */
import { beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hash } from "@node-rs/argon2";
import { db } from "./db.js";
import { SETTING_KEYS, defaultSettingRaw } from "@ferrehouse/shared";

const aqui = dirname(fileURLToPath(import.meta.url));

/**
 * El archivo de base que le tocó a ESTE test, puesto por `test-db-url.ts`
 * (ver `vitest.config.ts`). No es un nombre fijo a propósito: compartir uno
 * entre archivos y borrarlo en cada `beforeAll` era una carrera con los
 * descriptores del proceso anterior.
 */
const RUTA_DB = join(aqui, "../prisma", (process.env.DATABASE_URL ?? "").replace(/^file:\.\//, "").split("?")[0]!);

export const PIN_ADMIN = "112233";
export const PIN_VENDEDOR = "445566";

beforeAll(async () => {
  await db.$disconnect();
  for (const suf of ["", "-journal", "-wal", "-shm"]) rmSync(RUTA_DB + suf, { force: true });

  /**
   * WAL y `synchronous=NORMAL` ANTES de tocar nada. No es una optimización
   * cosmética: sin esto SQLite hace un `fsync` por sentencia y preparar una
   * base tardaba **33 segundos** —485 ms por sentencia de migración, 341 ms por
   * insert—. Con WAL, 2 segundos. El `beforeAll` se pasaba de su límite de 60 s
   * una de cada tres o cuatro corridas y el archivo entero fallaba: un test que
   * falla a veces, sin razón visible, se aprende a ignorar, y el día que acuse
   * algo real nadie le va a creer.
   *
   * `synchronous=NORMAL` es solo para los tests: esta base se borra al terminar
   * y no hay nada que sobreviva a un corte de luz. La tienda usa el valor por
   * omisión, que sí espera al disco.
   */
  await db.$queryRawUnsafe(`PRAGMA journal_mode=WAL`);
  await db.$executeRawUnsafe(`PRAGMA synchronous=NORMAL`);

  // TODAS las migraciones, en orden de carpeta. Aplicar solo la inicial dejaría
  // los tests corriendo contra un esquema más viejo que el de producción, que
  // es la clase de diferencia que hace pasar un test y fallar la tienda.
  // Van en UNA transacción: 69 commits son 69 fsync.
  const dirMigraciones = join(aqui, "../prisma/migrations");
  const sentencias: string[] = [];
  for (const carpeta of readdirSync(dirMigraciones).filter((d) => /^\d/.test(d)).sort()) {
    const sql = readFileSync(join(dirMigraciones, carpeta, "migration.sql"), "utf-8");
    for (const s of sql.split(";").map((x) => x.trim()).filter((x) => x && !/^(--|\s)*$/.test(x))) {
      sentencias.push(s);
    }
  }
  await db.$transaction(sentencias.map((s) => db.$executeRawUnsafe(s)));

  const loc = await db.location.create({ data: { name: "Local", isDefault: true, active: true } });
  await db.station.create({ data: { name: "CAJA-1", locationId: loc.id, active: true } });
  await db.station.create({ data: { name: "CAJA-2", locationId: loc.id, active: false } });
  await db.user.create({ data: { name: "Sistema", role: "SYSTEM", active: false, pinHash: "*sin-login*" } });
  await db.user.create({ data: { name: "Cristian", role: "ADMIN", active: true, pinHash: await hash(PIN_ADMIN) } });
  await db.user.create({
    data: { name: "Vendedor Mesón", role: "SELLER", active: true, pinHash: await hash(PIN_VENDEDOR) },
  });
  await db.user.create({ data: { name: "Ex empleado", role: "SELLER", active: false, pinHash: await hash("999999") } });
  for (const k of SETTING_KEYS) await db.setting.create({ data: { key: k, value: defaultSettingRaw(k) } });
});

afterAll(async () => {
  await db.$disconnect();
  for (const suf of ["", "-journal", "-wal", "-shm"]) rmSync(RUTA_DB + suf, { force: true });
});
