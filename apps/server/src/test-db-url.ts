/**
 * Una base de datos por archivo de test. Se ejecuta como `setupFiles`, o sea
 * ANTES del grafo de módulos del archivo: cuando `db.ts` construya el
 * `PrismaClient`, `DATABASE_URL` ya apunta a un archivo propio.
 *
 * POR QUÉ EXISTE. Antes todos los archivos compartían `test-e2e.db`, y cada uno
 * lo borraba y lo recreaba en su `beforeAll`. Con `fileParallelism: false` los
 * archivos corren en fila, pero el borrado de un `.db` —con su `-wal` y su
 * `-shm`— mientras el proceso anterior todavía suelta sus descriptores es una
 * carrera. Se manifestaba una de cada tres o cuatro corridas de `pnpm check`:
 * un archivo entero fallaba al preparar y sus tests salían como omitidos. Un
 * test que falla una de cada cuatro veces sin razón visible es peor que un test
 * que falla siempre — se aprende a ignorarlo, y el día que acuse algo real
 * nadie le va a creer.
 *
 * Con un archivo por test no hay nada que compartir, así que no hay carrera.
 */
import { randomUUID } from "node:crypto";

const nombre = `test-${randomUUID().slice(0, 8)}.db`;
process.env.DATABASE_URL = `file:./${nombre}?connection_limit=1`;
