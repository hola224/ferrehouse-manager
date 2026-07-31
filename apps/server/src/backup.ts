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
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
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

/**
 * TODA la lectura de disco de este módulo es asíncrona, y no por estilo.
 *
 * `readdirSync` sobre una carpeta de red que se cayó **bloquea el bucle de
 * eventos entero**: no se atrasa esa petición, se atrasa el servidor completo,
 * incluida la venta que se está cobrando en el mesón. Y no es teórico —en esta
 * misma máquina un `mkdirSync` sobre procfs no devolvió nunca y se comió una
 * corrida de pruebas de dos minutos—. En la versión asíncrona la espera ocurre
 * en el pool de hilos y el mesón sigue vendiendo.
 */
async function bytesDe(ruta: string): Promise<number> {
  try {
    return (await stat(ruta)).size;
  } catch {
    return 0;
  }
}

async function respaldosDe(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter(esRespaldo).sort();
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

    const bytes = await bytesDe(destino);
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
let ultimaCopia: { ok: boolean; problema: string | null } | null = null;

/**
 * Olvida cómo le fue al último intento de copia.
 *
 * Lo llama la ruta que cambia la carpeta de destino: el fallo de la carpeta
 * vieja no dice nada de la nueva, y dejarlo puesto haría que el tablero siguiera
 * acusando un problema que acaban de arreglar — que es la forma más rápida de
 * que dejen de creerle al panel.
 */
export function olvidarUltimaCopia(): void {
  ultimaCopia = null;
}

async function copiarAfuera(archivo: string): Promise<{ destino: string | null; ok: boolean; problema: string | null }> {
  const carpeta = (await getSetting("backup.copyTo")).trim();
  if (!carpeta) {
    ultimaCopia = { ok: false, problema: "No hay copia externa configurada." };
    return { destino: null, ok: false, problema: "No hay copia externa configurada." };
  }
  try {
    mkdirSync(carpeta, { recursive: true });
    const destino = join(carpeta, archivo.split(/[\\/]/).pop()!);
    copyFileSync(archivo, destino);
    await rotar(carpeta);
    ultimaCopia = { ok: true, problema: null };
    return { destino: carpeta, ok: true, problema: null };
  } catch (e) {
    const detalle = e instanceof Error ? e.message : String(e);
    console.error("[respaldo] no se pudo copiar a", carpeta, detalle);
    const problema = `No se pudo copiar a ${carpeta}. ¿Está conectado el pendrive?`;
    ultimaCopia = { ok: false, problema };
    return { destino: carpeta, ok: false, problema };
  }
}

/** Borra los vencidos de una carpeta. La decisión de cuáles vive en `shared`. */
async function rotar(dir: string): Promise<string[]> {
  const dias = await getSetting("backup.keepDays");
  const { borrar } = aRotar(await respaldosDe(dir), { ahora: new Date(), dias });
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
export async function estadoDeRespaldo(
  ahora = new Date(),
  /**
   * `probarCopia: false` no mira la carpeta externa.
   *
   * Lo usa el panel de alertas, que se calcula en cada carga del tablero: ahí
   * un pendrive desconectado o una carpeta de red caída no pueden costar una
   * espera. El sondeo de verdad queda para `/api/backup`, donde el
   * administrador entró a mirar el respaldo y sabe que está preguntando.
   */
  opts: { probarCopia?: boolean } = {},
): Promise<EstadoRespaldo> {
  const ruta = rutaBaseDeDatos();
  const dir = await carpetaDeRespaldos();
  const nombres = await respaldosDe(dir);
  const ultimoNombre = nombres[nombres.length - 1] ?? null;

  const externa = (await getSetting("backup.copyTo")).trim();
  let copia: EstadoRespaldo["copia"] = {
    configurada: false,
    carpeta: null,
    alDia: false,
    problema: "El respaldo se guarda en el mismo PC. Si se pierde el equipo, se pierde con él.",
  };
  if (externa && opts.probarCopia === false) {
    /**
     * Sin sondear, lo único que se sabe con certeza es cómo le fue al último
     * intento de copia de este proceso. Si todavía no hubo ninguno **no se
     * inventa nada**: se dice que está al día, que es lo mismo que decir "no
     * tengo nada que reportar", en vez de acusar un problema que no se miró.
     */
    copia = {
      configurada: true,
      carpeta: externa,
      alDia: ultimaCopia?.ok !== false,
      problema: ultimaCopia?.ok === false ? ultimaCopia.problema : null,
    };
  } else if (externa) {
    const afuera = await respaldosDe(externa);
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
    base: { ruta, existe: existsSync(ruta), bytes: await bytesDe(ruta) },
    carpeta: dir,
    cantidad: nombres.length,
    bytesTotales: (await Promise.all(nombres.map((n) => bytesDe(join(dir, n))))).reduce((s, b) => s + b, 0),
    ultimo: ultimoNombre
      ? {
          archivo: ultimoNombre,
          fecha: fechaDeRespaldo(ultimoNombre)!,
          bytes: await bytesDe(join(dir, ultimoNombre)),
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
    /**
     * El nombre de reserva se calcula SIEMPRE, exista o no la base.
     *
     * Antes se calculaba solo si el `.db` estaba, y entonces los `-wal`/`-shm`
     * se "apartaban" con `renameSync(x, x)` — que no hace nada. O sea que en el
     * caso de un `.db` perdido con su `-wal` sobreviviente (el antivirus puso en
     * cuarentena un archivo y no los otros, alguien borró "la base de datos" y
     * dejó los de al lado) el WAL viejo se quedaba junto a la base recién
     * copiada: exactamente la trampa que esta función existe para evitar. Y los
     * pasos informaban que se había apartado.
     */
    const aparte = `${destino}.antes-de-restaurar-${nombreDeRespaldo(ahora).replace(/^ferrehouse-|\.db$/g, "")}`;
    let apartada: string | null = null;
    if (existsSync(destino)) {
      renameSync(destino, aparte);
      apartada = aparte;
      pasos.push(`La base que había se guardó como ${aparte}`);
    }
    for (const suf of ["-wal", "-shm", "-journal"]) {
      if (existsSync(destino + suf)) {
        renameSync(destino + suf, aparte + suf);
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
      const nombres = await respaldosDe(dir);
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
