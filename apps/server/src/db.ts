/**
 * Cliente de base de datos (tarea 0.3).
 *
 * `connection_limit=1` no es cosmético (decisión sellada 16, ADR-006): serializa
 * las escrituras. Sin él, dos ventas simultáneas del mismo producto leen el
 * mismo saldo y escriben encima, corrompiendo el libro de stock EN SILENCIO —
 * medido: 200 escrituras concurrentes dan 44 caídas con el pool por defecto y 0
 * con el límite en 1. Por eso el arranque se niega a seguir si falta.
 */
import { PrismaClient } from "@prisma/client";
import { cargarEnv } from "./entorno.js";

/**
 * Va acá, antes de construir el cliente, y no en `main.ts`: los imports de un
 * módulo ESM se evalúan antes que cualquier línea del archivo que los pide, así
 * que una llamada en `main.ts` llegaría tarde. Puesto acá lo alcanzan también
 * el seed y los dos CLI de respaldo, que necesitan `DATABASE_URL` igual y no
 * pasan por `main.ts`.
 *
 * Hasta ahora esto lo hacía Prisma sola al importarse; deja de hacerlo en
 * Prisma 7 (lo avisa en cada corrida). Ver `entorno.ts`.
 */
cargarEnv();

export const db = new PrismaClient({
  log: process.env.NODE_ENV === "production" ? ["warn", "error"] : ["warn", "error"],
});

export function assertConnectionLimit(url = process.env.DATABASE_URL ?? ""): void {
  if (!url) throw new Error("Falta DATABASE_URL.");
  if (!/[?&]connection_limit=1(&|$)/.test(url)) {
    throw new Error(
      "DATABASE_URL debe llevar `connection_limit=1`. Sin eso dos ventas simultáneas " +
        "del mismo producto corrompen el saldo del libro de stock sin dar error. " +
        "Ver ADR-006.",
    );
  }
}

/** WAL: lectores y escritor no se bloquean entre sí. Se activa una vez por archivo. */
export async function enableWAL(): Promise<string> {
  const r = await db.$queryRawUnsafe<Array<Record<string, string>>>(`PRAGMA journal_mode=WAL`);
  return r[0]?.journal_mode ?? "desconocido";
}
