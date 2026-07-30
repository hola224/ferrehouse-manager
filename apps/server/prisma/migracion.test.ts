/**
 * Guardián de la migración inicial (tarea 0.2).
 *
 * Los dos CHECK de `CashSession` se agregan A MANO al SQL generado, porque
 * Prisma no los produce. Cualquiera que corra `prisma migrate dev` o
 * `prisma db push` los borra y NADA se queja: el invariante de caja vuelve a
 * estar sin imponer y solo se descubre cuando hay tres sesiones abiertas en la
 * misma caja. Este test es la única alarma.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const SQL = readFileSync(join(__dirname, "migrations/20260730120000_inicial/migration.sql"), "utf-8");

let db: PrismaClient;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "fh-mig-"));
  db = new PrismaClient({ datasources: { db: { url: `file:${join(dir, "test.db")}` } } });
  const sentencias = SQL.split(";").map((s) => s.trim()).filter((s) => s && !/^(--|\s)*$/.test(s));
  for (const s of sentencias) await db.$executeRawUnsafe(s);
});

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("migración inicial", () => {
  it("crea 28 tablas", async () => {
    const filas = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'`,
    );
    expect(Number(filas[0]!.n)).toBe(28);
  });

  it("conserva los dos CHECK de CashSession", async () => {
    const filas = await db.$queryRawUnsafe<Array<{ sql: string }>>(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='CashSession'`,
    );
    const ddl = filas[0]!.sql;
    expect(ddl).toContain("ck_marcador_es_su_estacion");
    expect(ddl).toContain("ck_abierta_sii_marcador");
  });
});

describe("invariante de caja: una sola sesión abierta por estación", () => {
  beforeAll(async () => {
    await db.$executeRawUnsafe(`INSERT INTO "Location" ("id","name","isDefault","active") VALUES (1,'Local',1,1)`);
    await db.$executeRawUnsafe(`INSERT INTO "Station" ("id","name","locationId","active") VALUES (1,'CAJA-1',1,1),(2,'CAJA-2',1,1)`);
    await db.$executeRawUnsafe(`INSERT INTO "User" ("id","name","role","pinHash","active") VALUES (1,'Test','ADMIN','x',1)`);
  });

  const abrir = (id: number, stationId: number, marcador: number | null) =>
    db.$executeRawUnsafe(
      `INSERT INTO "CashSession" ("id","stationId","userId","openingAmount","openStationId") VALUES (${id},${stationId},1,50000,${marcador ?? "NULL"})`,
    );

  it("abrir sin marcador: rechazada", async () => {
    await expect(abrir(1, 1, null)).rejects.toThrow();
  });

  it("marcar una estación ajena: rechazada", async () => {
    await expect(abrir(2, 1, 2)).rejects.toThrow();
  });

  it("abrir bien: funciona", async () => {
    await expect(abrir(3, 1, 1)).resolves.toBeDefined();
  });

  it("segunda sesión abierta en la misma caja: rechazada", async () => {
    await expect(abrir(4, 1, 1)).rejects.toThrow();
  });

  it("otra caja al mismo tiempo: funciona", async () => {
    await expect(abrir(5, 2, 2)).resolves.toBeDefined();
  });

  it("cerrar dejando el marcador puesto: rechazada", async () => {
    await expect(
      db.$executeRawUnsafe(`UPDATE "CashSession" SET "closedAt"=CURRENT_TIMESTAMP WHERE "id"=3`),
    ).rejects.toThrow();
  });

  it("cerrar bien y reabrir: funciona", async () => {
    await db.$executeRawUnsafe(
      `UPDATE "CashSession" SET "closedAt"=CURRENT_TIMESTAMP, "openStationId"=NULL WHERE "id"=3`,
    );
    await expect(abrir(6, 1, 1)).resolves.toBeDefined();
  });
});
