/**
 * Respaldo y restauración (tareas 7.2 y 7.3).
 *
 * **Por qué no es `copiar ferrehouse.db`.** La base corre en modo WAL
 * (decisión 16): lo recién escrito vive en `ferrehouse.db-wal` hasta que SQLite
 * hace checkpoint. En esta misma máquina, ahora, el `.db` pesa 340 KB y su
 * `-wal` pesa 2,4 MB — copiar solo el primero se lleva una base **vieja y
 * consistente**, que es la peor combinación posible: abre sin errores y le
 * faltan las últimas ventas. Copiar los dos archivos con la base abierta es
 * peor todavía, porque se copian en instantes distintos.
 *
 * `VACUUM INTO` no tiene ese problema: SQLite lee por la conexión —o sea ve
 * todo lo comprometido, WAL incluido— y escribe un archivo nuevo, completo y
 * compactado, en una sola operación.
 *
 * **Un respaldo que nunca se abrió es una esperanza, no un respaldo.** Por eso
 * cada uno se verifica apenas se produce: se abre, se le corre
 * `PRAGMA integrity_check` y se le cuentan filas. Si no pasa, se borra — un
 * archivo corrupto que se queda es peor que ninguno, porque la rotación lo
 * cuenta como bueno y el panel dice "respaldado hoy".
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { db } from "./db.js";
import { getSetting } from "./settings.js";
import {
  antiguedadDeRespaldo,
  aRotar,
  esRespaldo,
  fechaDeRespaldo,
  hayQueRespaldar,
  nombreDeRespaldo,
} from "@ferrehouse/shared";

const AQUI = dirname(fileURLToPath(import.meta.url));

/**
 * `apps/server/prisma`, tanto desde `src/` en desarrollo como desde `dist/`
 * compilado: la carpeta está un nivel arriba de las dos.
 */
export function carpetaPrisma(): string {
  return resolve(AQUI, "../prisma");
}

/**
 * **La ruta de la base, resuelta como la resuelve Prisma y no como uno
 * supondría.** `file:./ferrehouse.db` es relativo a la carpeta del schema
 * —`apps/server/prisma`—, NO al directorio desde el que se lanzó el proceso.
 * Resolverlo contra `process.cwd()` da una ruta que no existe cuando el
 * servicio arranca desde `C:\Windows\system32`, que es exactamente donde lo
 * lanza NSSM.
 */
export function rutaBaseDeDatos(url = process.env.DATABASE_URL ?? ""): string {
  const archivo = url.replace(/^file:/, "").split("?")[0] ?? "";
  if (!archivo) throw new Error("DATABASE_URL no apunta a ningún archivo.");
  return isAbsolute(archivo) ? archivo : resolve(carpetaPrisma(), archivo);
}

/** La carpeta de respaldos: relativa va junto a la base; absoluta manda. */
export async function carpetaDeRespaldos(): Promise<string> {
  const dir = await getSetting("backup.dir");
  return isAbsolute(dir) ? dir : resolve(dirname(rutaBaseDeDatos()), dir);
}

function bytesDe(ruta: string): number {
  try {
    return statSync(ruta).size;
  } catch {
    return 0;
  }
}

function respaldosDe(dir: string): string[] {
  try {
    return readdirSync(dir).filter(esRespaldo).sort();
  } catch {
    return []; // La carpeta no existe todavía, o el pendrive no está puesto.
  }
}

/**
 * Abre un archivo de respaldo y se asegura de que sea una base sana y de esta
 * aplicación. Devuelve `null` si está bien, o el motivo si no.
 *
 * Cliente aparte a propósito: `db` apunta a la base viva y esto tiene que
 * mirar OTRO archivo.
 */
async function verificar(archivo: string): Promise<string | null> {
  const cliente = new PrismaClient({ datasourceUrl: `file:${archivo}?connection_limit=1` });
  try {
    const r = await cliente.$queryRawUnsafe<Array<Record<string, string>>>("PRAGMA integrity_check");
    const veredicto = Object.values(r[0] ?? {})[0];
    if (veredicto !== "ok") return `la verificación de integridad devolvió «${veredicto ?? "nada"}»`;

    // Que abra no basta: una base vacía también abre. Tiene que traer la
    // aplicación adentro.
    const usuarios = await cliente.user.count();
    if (usuarios === 0) return "no tiene ni un usuario: no es una base de Ferrehouse";
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  } finally {
    await cliente.$disconnect();
    // Abrir deja `-wal`/`-shm` al lado; sin borrarlos el respaldo deja de ser
    // un archivo único que se copia a un pendrive.
    for (const suf of ["-wal", "-shm"]) rmSync(archivo + suf, { force: true });
  }
}

export type ResultadoRespaldo = {
  ok: boolean;
  archivo: string | null;
  bytes: number;
  copia: { destino: string | null; ok: boolean; problema: string | null };
  borrados: string[];
  error: string | null;
  ms: number;
};

/**
 * Toma el respaldo del día. **Nunca lanza**: lo llama un temporizador, y una
 * excepción sin atrapar en un `setInterval` tumba el proceso entero — o sea, el
 * respaldo se llevaría puesto el servidor de la tienda en plena venta.
 */
export async function respaldar(ahora = new Date()): Promise<ResultadoRespaldo> {
  const t0 = Date.now();
  const vacio: ResultadoRespaldo = {
    ok: false,
    archivo: null,
    bytes: 0,
    copia: { destino: null, ok: false, problema: null },
    borrados: [],
    error: null,
    ms: 0,
  };

  try {
    const origen = rutaBaseDeDatos();
    if (!existsSync(origen)) {
      return { ...vacio, error: `No existe el archivo de base de datos en ${origen}.`, ms: Date.now() - t0 };
    }

    const dir = await carpetaDeRespaldos();
    mkdirSync(dir, { recursive: true });

    /**
     * `VACUUM INTO` **falla si el archivo ya existe**, y el respaldo diario y un
     * "respaldar ahora" apretado a mano pueden caer en el mismo segundo. Se
     * corre el reloj hacia adelante hasta encontrar un nombre libre, en vez de
     * pisar un respaldo bueno.
     */
    let cuando = new Date(ahora);
    let destino = join(dir, nombreDeRespaldo(cuando));
    for (let i = 0; existsSync(destino) && i < 60; i++) {
      cuando = new Date(cuando.getTime() + 1000);
      destino = join(dir, nombreDeRespaldo(cuando));
    }

    /**
     * Ocupa la única conexión de la aplicación (decisión 16) mientras dura, o
     * sea que una venta que caiga justo ahí espera. **Medido sobre la base de
     * demostración (332 KB): 132 ms con el WAL vacío y 1,5 s con 2,4 MB de WAL
     * acumulado** — el trabajo real lo da el WAL pendiente, no el tamaño de la
     * base. Un segundo y medio una vez al día es aceptable; por eso el respaldo
     * va a una hora fija y no cada vez que alguien abre el panel.
     */
    await db.$executeRawUnsafe(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);

    const problema = await verificar(destino);
    if (problema) {
      rmSync(destino, { force: true });
      return { ...vacio, error: `El respaldo salió malo y se descartó: ${problema}.`, ms: Date.now() - t0 };
    }

    const bytes = bytesDe(destino);
    const copia = await copiarAfuera(destino);
    const borrados = await rotar(dir);

    return { ok: true, archivo: destino, bytes, copia, borrados, error: null, ms: Date.now() - t0 };
  } catch (e) {
    console.error("[respaldo] falló:", e);
    return { ...vacio, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t0 };
  }
}

/**
 * La copia a la carpeta externa. **Es lo que convierte el snapshot en
 * respaldo**: un archivo en el mismo disco no protege del caso que este sprint
 * declara —se perdió el PC—, solo del "borré algo sin querer".
 *
 * Que el pendrive no esté puesto es lo normal, no un error: degrada a aviso
 * visible y el respaldo local sigue siendo bueno.
 */
async function copiarAfuera(archivo: string): Promise<{ destino: string | null; ok: boolean; problema: string | null }> {
  const carpeta = (await getSetting("backup.copyTo")).trim();
  if (!carpeta) {
    return { destino: null, ok: false, problema: "No hay copia externa configurada." };
  }
  try {
    mkdirSync(carpeta, { recursive: true });
    const destino = join(carpeta, archivo.split(/[\\/]/).pop()!);
    copyFileSync(archivo, destino);
    await rotar(carpeta);
    return { destino: carpeta, ok: true, problema: null };
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    console.error("[respaldo] no se pudo copiar a", carpeta, detalle);
    return {
      destino: carpeta,
      ok: false,
      problema: `No se pudo copiar a ${carpeta}. ¿Está conectado el pendrive?`,
    };
  }
}

/** Borra los vencidos de una carpeta. La decisión de cuáles vive en `shared`. */
async function rotar(dir: string): Promise<string[]> {
  const dias = await getSetting("backup.keepDays");
  const { borrar } = aRotar(respaldosDe(dir), { ahora: new Date(), dias });
  for (const nombre of borrar) rmSync(join(dir, nombre), { force: true });
  return borrar;
}

export type EstadoRespaldo = {
  base: { ruta: string; existe: boolean; bytes: number };
  carpeta: string;
  cantidad: number;
  bytesTotales: number;
  ultimo: { archivo: string; fecha: Date; bytes: number } | null;
  antiguedad: string;
  copia: { configurada: boolean; carpeta: string | null; alDia: boolean; problema: string | null };
  hora: number;
  dias: number;
};

/**
 * Todo lo que el panel necesita, **leído del disco y no de una tabla**.
 *
 * No hay estado que mantener sincronizado: el último respaldo es el archivo más
 * nuevo de la carpeta, y "la copia está al día" es que ese mismo archivo exista
 * en el pendrive. Un registro en la base podría decir "respaldado" de un
 * archivo que alguien borró.
 */
export async function estadoDeRespaldo(ahora = new Date()): Promise<EstadoRespaldo> {
  const ruta = rutaBaseDeDatos();
  const dir = await carpetaDeRespaldos();
  const nombres = respaldosDe(dir);
  const ultimoNombre = nombres[nombres.length - 1] ?? null;

  const externa = (await getSetting("backup.copyTo")).trim();
  let copia: EstadoRespaldo["copia"] = {
    configurada: false,
    carpeta: null,
    alDia: false,
    problema: "El respaldo se guarda en el mismo PC. Si se pierde el equipo, se pierde con él.",
  };
  if (externa) {
    const afuera = respaldosDe(externa);
    const alDia = ultimoNombre !== null && afuera.includes(ultimoNombre);
    copia = {
      configurada: true,
      carpeta: externa,
      alDia,
      problema: alDia
        ? null
        : afuera.length === 0
          ? `No hay ningún respaldo en ${externa}. ¿Está conectado?`
          : `La copia en ${externa} quedó atrasada: el último que tiene es de ${
              antiguedadDeRespaldo(fechaDeRespaldo(afuera[afuera.length - 1]!), ahora)
            }.`,
    };
  }

  return {
    base: { ruta, existe: existsSync(ruta), bytes: bytesDe(ruta) },
    carpeta: dir,
    cantidad: nombres.length,
    bytesTotales: nombres.reduce((s, n) => s + bytesDe(join(dir, n)), 0),
    ultimo: ultimoNombre
      ? {
          archivo: ultimoNombre,
          fecha: fechaDeRespaldo(ultimoNombre)!,
          bytes: bytesDe(join(dir, ultimoNombre)),
        }
      : null,
    antiguedad: antiguedadDeRespaldo(ultimoNombre ? fechaDeRespaldo(ultimoNombre) : null, ahora),
    copia,
    hora: await getSetting("backup.hour"),
    dias: await getSetting("backup.keepDays"),
  };
}

// --- 7.3: la restauración ---

export type ResultadoRestauracion = {
  ok: boolean;
  pasos: string[];
  apartada: string | null;
  error: string | null;
};

/**
 * Restaura la base desde un respaldo. **Corre con el servidor detenido**: es
 * mecanismo, no ruta HTTP — restaurar mientras Fastify tiene la base abierta la
 * corrompe.
 *
 * Tres reglas, y las tres existen porque restaurar mal es peor que no restaurar:
 *
 * 1. **Se verifica el respaldo ANTES de tocar la base viva.** Sobrescribir con
 *    un archivo corrupto pierde las dos cosas de una vez.
 * 2. **La base actual no se borra: se aparta con fecha.** Restaurar el respaldo
 *    equivocado es un error de dedo perfectamente posible, y sin esto no tiene
 *    vuelta.
 * 3. **Se borran el `-wal` y el `-shm` del destino.** Es la trampa fina: SQLite
 *    encuentra un WAL viejo junto a una base nueva y le aplica encima
 *    transacciones que no le corresponden. El archivo queda abriendo bien y con
 *    datos mezclados de dos bases distintas.
 */
export async function restaurar(archivo: string, ahora = new Date()): Promise<ResultadoRestauracion> {
  const pasos: string[] = [];
  try {
    const dir = await carpetaDeRespaldos();
    const origen = isAbsolute(archivo) ? archivo : join(dir, archivo);
    if (!existsSync(origen)) return { ok: false, pasos, apartada: null, error: `No existe el archivo ${origen}.` };

    const problema = await verificar(origen);
    if (problema) {
      return {
        ok: false,
        pasos,
        apartada: null,
        error: `Ese respaldo no sirve (${problema}). No se tocó la base actual.`,
      };
    }
    pasos.push(`Respaldo verificado: ${origen}`);

    const destino = rutaBaseDeDatos();
    let apartada: string | null = null;
    if (existsSync(destino)) {
      apartada = `${destino}.antes-de-restaurar-${nombreDeRespaldo(ahora).replace(/^ferrehouse-|\.db$/g, "")}`;
      renameSync(destino, apartada);
      pasos.push(`La base que había se guardó como ${apartada}`);
    }
    for (const suf of ["-wal", "-shm", "-journal"]) {
      if (existsSync(destino + suf)) {
        renameSync(destino + suf, `${apartada ?? destino}${suf}`);
        pasos.push(`Se apartó el ${suf} viejo (aplicarlo sobre la base restaurada la mezclaría)`);
      }
    }

    copyFileSync(origen, destino);
    pasos.push(`Base restaurada en ${destino}`);
    return { ok: true, pasos, apartada, error: null };
  } catch (e) {
    return { ok: false, pasos, apartada: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * ¿Hay un servidor vivo en ese puerto? La restauración se niega a correr si lo
 * hay. No es una precaución teórica: sobrescribir el archivo que SQLite tiene
 * abierto es la forma más directa de corromper las dos bases.
 */
export async function servidorRespondiendo(puerto: number, ms = 1500): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${puerto}/api/health`, { signal: AbortSignal.timeout(ms) });
    return r.ok;
  } catch {
    return false;
  }
}

// --- El temporizador ---

let reloj: NodeJS.Timeout | null = null;

/**
 * Arranca el respaldo diario. **Se llama desde `main.ts`, no desde `buildApp`**:
 * los tests construyen la app decenas de veces y un temporizador vivo por cada
 * una las haría pisarse entre ellas — la misma razón por la que el worker de
 * WhatsApp también vive ahí.
 *
 * Revisa seguido y respalda poco: la decisión de si toca es de `hayQueRespaldar`
 * y cuesta nada. Revisar cada 15 minutos es lo que hace que un PC que se
 * enciende a las 14:20 igual tenga su respaldo del día.
 */
export function iniciarRespaldoDiario(cadaMs = 15 * 60_000): void {
  if (reloj) return;
  const pasada = async () => {
    try {
      const dir = await carpetaDeRespaldos();
      const nombres = respaldosDe(dir);
      const ultimo = nombres.length ? fechaDeRespaldo(nombres[nombres.length - 1]!) : null;
      const veredicto = hayQueRespaldar(ultimo, new Date(), await getSetting("backup.hour"));
      if (!veredicto.debe) return;

      console.log(`[respaldo] ${veredicto.motivo}`);
      const r = await respaldar();
      if (r.ok) {
        console.log(
          `[respaldo] ${r.archivo} (${Math.round(r.bytes / 1024)} KB, ${r.ms} ms)` +
            (r.copia.ok ? ` · copiado a ${r.copia.destino}` : ` · sin copia externa: ${r.copia.problema}`),
        );
      } else {
        console.error(`[respaldo] NO se pudo respaldar: ${r.error}`);
      }
    } catch (e) {
      console.error("[respaldo] la pasada falló:", e);
    }
  };
  void pasada();
  reloj = setInterval(() => void pasada(), cadaMs);
  reloj.unref();
}

export function detenerRespaldoDiario(): void {
  if (reloj) clearInterval(reloj);
  reloj = null;
}
