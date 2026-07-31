/**
 * Sprint 7 — respaldo y restauración (7.2 y 7.3).
 *
 * La tarea 7.3 dice, con esas palabras, **"si no se prueba, no existe"**. Así
 * que acá no se prueba que la función devuelva `ok: true`: se pierde la base de
 * verdad —se borran el archivo, su `-wal` y su `-shm`— y se vuelve del
 * respaldo, se comprueba que están los datos de antes y no los de después, y
 * que el servidor pasa sus autochequeos de arranque contra la base restaurada.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PrismaClient } from "@prisma/client";
import { buildApp } from "./app.js";
import { db, enableWAL } from "./db.js";
import { PIN_ADMIN, PIN_VENDEDOR } from "./test-setup.js";
import { setSetting } from "./settings.js";
import { runStartupChecks } from "./startup-checks.js";
import { alertasVigentes } from "./alerts.js";
import { MINIMO_RESPALDOS, nombreDeRespaldo, SKU_COUNTER } from "@ferrehouse/shared";
import {
  carpetaDeRespaldos,
  carpetaPrisma,
  estadoDeRespaldo,
  olvidarUltimaCopia,
  respaldar,
  restaurar,
  rutaBaseDeDatos,
  servidorRespondiendo,
} from "./backup.js";

let app: FastifyInstance;
let tokenAdmin: string, tokenVendedor: string;
let idUnidad: number, idLocal: number;
let dir: string;

/** Una carpeta propia por prueba: nada de lo que se borra acá es de nadie más. */
function carpetaNueva(): string {
  return mkdtempSync(join(tmpdir(), "fh-respaldo-"));
}

async function usarCarpeta(nueva = carpetaNueva()): Promise<string> {
  await setSetting("backup.dir", nueva);
  return nueva;
}

let correlativo = 0;
async function crearProducto(nombre: string): Promise<string> {
  const sku = `FH-9${String(++correlativo).padStart(4, "0")}`;
  await db.product.create({
    data: {
      sku,
      name: nombre,
      saleUnitId: idUnidad,
      purchaseUnitId: idUnidad,
      priceGross: 1000,
      costNetMilliPeso: 500_000,
      searchKey: nombre.toLowerCase(),
    },
  });
  return sku;
}

/** Abre un archivo de base cualquiera y pregunta si ese producto está adentro. */
async function tieneProducto(archivo: string, sku: string): Promise<boolean> {
  const cliente = new PrismaClient({ datasourceUrl: `file:${archivo}?connection_limit=1` });
  try {
    return (await cliente.product.count({ where: { sku } })) === 1;
  } finally {
    await cliente.$disconnect();
    for (const suf of ["-wal", "-shm"]) rmSync(archivo + suf, { force: true });
  }
}

/**
 * Una carpeta donde es imposible escribir, de forma determinista y en cualquier
 * sistema: su carpeta padre es un archivo, así que `mkdir` da ENOTDIR al toque.
 *
 * Antes esto apuntaba a `/proc/...`, que además de depender del sistema **se
 * colgaba**: `mkdirSync` sobre procfs no devolvía nunca en esta máquina y el
 * archivo de pruebas entero quedaba esperando sin decir por qué. Una ruta
 * inventada tampoco sirve: corriendo como root se crearía de verdad.
 */
function carpetaImposible(): string {
  const base = carpetaNueva();
  writeFileSync(join(base, "pendrive"), "esto es un archivo, no una carpeta");
  return join(base, "pendrive", "respaldos");
}

/** Un respaldo de mentira, con la fecha metida en el nombre. */
function respaldoFalso(carpeta: string, diasAtras: number, ahora = new Date()): string {
  const nombre = nombreDeRespaldo(new Date(ahora.getTime() - diasAtras * 24 * 3_600_000));
  writeFileSync(join(carpeta, nombre), "no importa el contenido");
  return nombre;
}

function respaldosEn(carpeta: string): string[] {
  return readdirSync(carpeta).filter((n) => /^ferrehouse-\d{4}/.test(n));
}

beforeAll(async () => {
  app = await buildApp({ jwtSecret: "test-secret" });
  await app.ready();

  idLocal = (await db.location.findFirstOrThrow({ where: { isDefault: true } })).id;
  const idCaja = (await db.station.findFirstOrThrow({ where: { name: "CAJA-1" } })).id;
  const grupo = await db.unitGroup.create({ data: { name: "CONTEO", allowsFraction: false } });
  idUnidad = (
    await db.unit.create({
      data: { groupId: grupo.id, name: "Unidad", symbol: "un", factorMilli: 1000, isBase: true },
    })
  ).id;
  await db.counter.create({ data: { name: SKU_COUNTER, value: 0 } });

  const entrar = async (rol: "ADMIN" | "SELLER", pin: string) => {
    const u = await db.user.findFirstOrThrow({ where: { role: rol, active: true } });
    const r = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId: u.id, pin, stationId: idCaja },
    });
    return JSON.parse(r.body).token as string;
  };
  tokenAdmin = await entrar("ADMIN", PIN_ADMIN);
  tokenVendedor = await entrar("SELLER", PIN_VENDEDOR);

  dir = await usarCarpeta();
  await setSetting("backup.copyTo", "");
});

describe("dónde está la base", () => {
  /**
   * El error que habría dado un respaldo verde de un archivo vacío: NSSM lanza
   * el servicio desde `C:\\Windows\\system32`, y `./ferrehouse.db` resuelto
   * contra el cwd apunta a un archivo que no existe.
   */
  it("se resuelve contra la carpeta del schema, no contra el directorio actual", () => {
    expect(rutaBaseDeDatos("file:./ferrehouse.db?connection_limit=1")).toBe(
      join(carpetaPrisma(), "ferrehouse.db"),
    );
    expect(rutaBaseDeDatos("file:/srv/datos/fh.db")).toBe("/srv/datos/fh.db");
  });

  it("y el archivo de esta corrida existe de verdad", () => {
    expect(existsSync(rutaBaseDeDatos())).toBe(true);
  });

  it("avisa en vez de reventar si la base no está donde dice", async () => {
    const antes = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "file:./esta-base-no-existe.db?connection_limit=1";
    try {
      const r = await respaldar();
      expect(r.ok).toBe(false);
      expect(r.error).toContain("esta-base-no-existe.db");
    } finally {
      process.env.DATABASE_URL = antes;
    }
  });
});

describe("el respaldo", () => {
  /**
   * La prueba que justifica el sprint entero. Con la base en WAL, lo recién
   * escrito NO está en el `.db`: está en el `-wal`. Una copia del `.db` abre
   * perfecto y le faltan las últimas ventas — vieja y consistente, que es la
   * peor combinación, porque no da ningún síntoma.
   */
  it("se lleva lo que todavía está en el WAL; copiar el .db no", async () => {
    await db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
    const sku = await crearProducto("Producto escrito después del checkpoint");

    const ingenua = join(dir, "copia-a-mano.db");
    copyFileSync(rutaBaseDeDatos(), ingenua);

    const r = await respaldar();
    expect(r.ok, r.error ?? "").toBe(true);

    expect(await tieneProducto(ingenua, sku)).toBe(false);
    expect(await tieneProducto(r.archivo!, sku)).toBe(true);
  });

  it("verifica lo que produjo antes de darlo por bueno", async () => {
    const r = await respaldar();
    expect(r.ok).toBe(true);
    expect(r.bytes).toBeGreaterThan(0);
    // Un respaldo con `-wal` al lado ya no es un archivo que se copia y listo.
    expect(existsSync(r.archivo + "-wal")).toBe(false);
    expect(existsSync(r.archivo + "-shm")).toBe(false);
  });

  it("dos respaldos en el mismo segundo no se pisan", async () => {
    const mismoInstante = new Date(2026, 6, 31, 13, 5, 42);
    const a = await respaldar(mismoInstante);
    const b = await respaldar(mismoInstante);
    expect(a.ok && b.ok).toBe(true);
    expect(a.archivo).not.toBe(b.archivo);
    expect(existsSync(a.archivo!) && existsSync(b.archivo!)).toBe(true);
  });
});

describe("la rotación", () => {
  it("borra los vencidos, guarda los últimos y no toca lo ajeno", async () => {
    const carpeta = await usarCarpeta();
    for (let d = 40; d < 52; d++) respaldoFalso(carpeta, d);
    // El destino puede ser un pendrive con cosas de otro.
    writeFileSync(join(carpeta, "fotos-del-local.jpg"), "x");
    writeFileSync(join(carpeta, "ferrehouse.db"), "x");

    const r = await respaldar();
    expect(r.ok).toBe(true);
    expect(r.borrados).toHaveLength(13 - MINIMO_RESPALDOS);
    expect(respaldosEn(carpeta)).toHaveLength(MINIMO_RESPALDOS);
    expect(existsSync(join(carpeta, "fotos-del-local.jpg"))).toBe(true);
    expect(existsSync(join(carpeta, "ferrehouse.db"))).toBe(true);

    dir = await usarCarpeta();
  });
});

describe("la copia externa", () => {
  it("copia el respaldo afuera y el panel lo da por al día", async () => {
    const carpeta = await usarCarpeta();
    const afuera = join(carpetaNueva(), "pendrive");
    await setSetting("backup.copyTo", afuera);

    const r = await respaldar();
    expect(r.copia.ok, r.copia.problema ?? "").toBe(true);
    expect(existsSync(join(afuera, r.archivo!.split("/").pop()!))).toBe(true);

    const estado = await estadoDeRespaldo();
    expect(estado.copia).toMatchObject({ configurada: true, alDia: true, problema: null });
    expect(carpeta).toBe(estado.carpeta);
  });

  /** El pendrive desconectado es lo normal, no una falla del respaldo. */
  it("si el pendrive no está, el respaldo local igual se hace y el panel avisa", async () => {
    await usarCarpeta();
    await setSetting("backup.copyTo", carpetaImposible());

    const r = await respaldar();
    expect(r.ok).toBe(true); // el respaldo local sirve igual
    expect(r.copia.ok).toBe(false);
    expect(r.copia.problema).toContain("pendrive");

    const alertas = await alertasVigentes(idLocal);
    expect(alertas.find((a) => a.type === "BACKUP_COPY")?.severity).toBe("WARNING");
  });

  /**
   * El panel de alertas se calcula en CADA carga del tablero, y una lectura de
   * disco lenta se paga en el bucle de eventos, o sea en el servidor entero —
   * el mesón incluido. Así que desde ahí no se mira la carpeta externa: con la
   * copia configurada y sin ningún intento todavía, no se inventa un problema
   * que no se miró.
   */
  it("el tablero no sondea el pendrive: sin intentos, no acusa nada", async () => {
    await usarCarpeta();
    // Una carpeta externa configurada y vacía: sondeándola diría "atrasada".
    await setSetting("backup.copyTo", carpetaNueva());
    olvidarUltimaCopia();

    const conSondeo = await estadoDeRespaldo(new Date(), { probarCopia: true });
    expect(conSondeo.copia.alDia).toBe(false);

    const sinSondeo = await estadoDeRespaldo(new Date(), { probarCopia: false });
    expect(sinSondeo.copia.alDia).toBe(true);
    expect(sinSondeo.copia.problema).toBeNull();
  });

  it("sin copia configurada lo dice en vez de callarlo", async () => {
    await usarCarpeta();
    await setSetting("backup.copyTo", "");
    await respaldar();

    const estado = await estadoDeRespaldo();
    expect(estado.copia.configurada).toBe(false);
    expect(estado.copia.problema).toContain("se pierde el equipo");
    dir = estado.carpeta;
  });
});

describe("la alerta de respaldo (derivada, decisión 25)", () => {
  it("grita si no hay ninguno", async () => {
    await usarCarpeta();
    const alertas = await alertasVigentes(idLocal);
    const a = alertas.find((x) => x.type === "BACKUP_STALE");
    expect(a?.severity).toBe("CRITICAL");
    expect(a?.message).toContain("Nunca se ha respaldado");
  });

  it("no molesta con el respaldo de hoy", async () => {
    const carpeta = await usarCarpeta();
    respaldoFalso(carpeta, 0);
    expect((await alertasVigentes(idLocal)).some((a) => a.type === "BACKUP_STALE")).toBe(false);
  });

  /**
   * 30 horas y no 24: el respaldo diario es a hora fija, así que su edad roza
   * las 24 casi todos los días. Una alerta diaria se deja de leer.
   */
  it("con el de ayer temprano todavía se calla", async () => {
    const carpeta = await usarCarpeta();
    writeFileSync(join(carpeta, nombreDeRespaldo(new Date(Date.now() - 26 * 3_600_000))), "x");
    expect((await alertasVigentes(idLocal)).some((a) => a.type === "BACKUP_STALE")).toBe(false);
  });

  it("avisa a las 30 horas y grita a los tres días", async () => {
    let carpeta = await usarCarpeta();
    writeFileSync(join(carpeta, nombreDeRespaldo(new Date(Date.now() - 31 * 3_600_000))), "x");
    expect((await alertasVigentes(idLocal)).find((a) => a.type === "BACKUP_STALE")?.severity).toBe("WARNING");

    carpeta = await usarCarpeta();
    respaldoFalso(carpeta, 4);
    const a = (await alertasVigentes(idLocal)).find((x) => x.type === "BACKUP_STALE");
    expect(a?.severity).toBe("CRITICAL");
    expect(a?.message).toContain("hace 4 días");
  });
});

describe("el panel", () => {
  const get = (url: string, token: string) =>
    app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });
  const post = (url: string, token: string) =>
    app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token}` } });
  const put = (url: string, token: string, payload: unknown) =>
    app.inject({ method: "PUT", url, headers: { authorization: `Bearer ${token}` }, payload });

  it("le muestra al administrador dónde está todo", async () => {
    dir = await usarCarpeta();
    await respaldar();
    const r = await get("/api/backup", tokenAdmin);
    expect(r.statusCode).toBe(200);
    const cuerpo = JSON.parse(r.body);
    expect(cuerpo.cantidad).toBe(1);
    expect(cuerpo.respaldos).toHaveLength(1);
    expect(cuerpo.antiguedad).toBe("recién");
    expect(cuerpo.base.existe).toBe(true);
  });

  it("respalda a pedido y lo deja auditado", async () => {
    dir = await usarCarpeta();
    const r = await post("/api/backup", tokenAdmin);
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).mensaje).toContain("Respaldo listo");
    expect(respaldosEn(dir)).toHaveLength(1);

    const registro = await db.auditLog.findFirst({ where: { action: "BACKUP_CREATED" }, orderBy: { id: "desc" } });
    expect(registro).not.toBeNull();
  });

  /**
   * La carpeta de respaldos y el tamaño de la base son estructura del servidor:
   * decisión sellada 17, lo que el vendedor no puede ver no sale del servidor.
   */
  it("al vendedor no le llega nada de esto", async () => {
    expect((await get("/api/backup", tokenVendedor)).statusCode).toBe(403);
    expect((await post("/api/backup", tokenVendedor)).statusCode).toBe(403);
    expect((await put("/api/backup/copia", tokenVendedor, { carpeta: "/tmp" })).statusCode).toBe(403);
  });

  /**
   * Sin esta ruta la copia externa no se configura NUNCA: el valor vive en
   * `Setting` y no había forma de tocarlo desde la aplicación, así que el
   * respaldo se quedaba para siempre en el mismo disco que la base.
   */
  it("deja elegir dónde se copia, y lo prueba escribiendo de verdad", async () => {
    const afuera = join(carpetaNueva(), "pendrive");
    const r = await put("/api/backup/copia", tokenAdmin, { carpeta: afuera });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).mensaje).toContain(afuera);

    dir = await usarCarpeta();
    const hecho = await respaldar();
    expect(hecho.copia.ok, hecho.copia.problema ?? "").toBe(true);
  });

  /**
   * Que la carpeta se vea bien desde afuera no dice nada: un pendrive protegido
   * contra escritura o una unidad de red sin permiso se ven igual. Se rechaza
   * ahora y no dentro de doce horas, de noche, sin nadie mirando.
   */
  it("rechaza en el acto una carpeta donde no se puede escribir", async () => {
    const r = await put("/api/backup/copia", tokenAdmin, { carpeta: carpetaImposible() });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).message ?? JSON.parse(r.body).error).toContain("pendrive");
  });

  it("vacío significa sin copia, y lo dice", async () => {
    const r = await put("/api/backup/copia", tokenAdmin, { carpeta: "" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).mensaje).toContain("solo en este PC");
    expect((await estadoDeRespaldo()).copia.configurada).toBe(false);
  });
});

describe("la restauración", () => {
  it("se niega con un archivo que no es una base", async () => {
    const carpeta = await usarCarpeta();
    writeFileSync(join(carpeta, "ferrehouse-2026-01-01-120000.db"), "esto no es una base de datos");
    const r = await restaurar("ferrehouse-2026-01-01-120000.db");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("No se tocó la base actual");
    // Y la base viva sigue ahí, intacta.
    expect(await db.product.count()).toBeGreaterThan(0);
  });

  it("se niega con un archivo que no existe", async () => {
    const r = await restaurar("ferrehouse-2020-01-01-000000.db");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("No existe");
  });

  it("no arranca si el servidor está vivo (puerto sin nadie escuchando)", async () => {
    expect(await servidorRespondiendo(59_999, 300)).toBe(false);
  });

  /**
   * EL CICLO COMPLETO. Se borra la base como si el PC se hubiera perdido y se
   * vuelve del respaldo.
   */
  it("se pierde el PC y se vuelve del respaldo", async () => {
    dir = await usarCarpeta();
    const antes = await crearProducto("Cargado ANTES del respaldo");
    const r = await respaldar();
    expect(r.ok, r.error ?? "").toBe(true);

    const despues = await crearProducto("Cargado DESPUÉS del respaldo");
    const ruta = rutaBaseDeDatos();

    // Se apaga el servidor y se pierde el disco.
    await db.$disconnect();
    for (const suf of ["", "-wal", "-shm"]) rmSync(ruta + suf, { force: true });
    expect(existsSync(ruta)).toBe(false);

    const vuelta = await restaurar(r.archivo!);
    expect(vuelta.ok, vuelta.error ?? "").toBe(true);
    expect(vuelta.pasos.join(" ")).toContain("Base restaurada");

    /**
     * `VACUUM INTO` produce un archivo que NO está en WAL: el modo se activa
     * por archivo, no por servidor. Si el arranque no lo volviera a poner, la
     * tienda quedaría trabajando en modo rollback después de una restauración
     * —más lenta y con lectores bloqueando al escritor— sin que nadie lo note.
     */
    expect(await enableWAL()).toBe("wal");

    expect(await db.product.count({ where: { sku: antes } })).toBe(1);
    expect(await db.product.count({ where: { sku: despues } })).toBe(0);

    // Y el servidor puede arrancar contra ella: seed completo, settings, SYSTEM.
    expect(await runStartupChecks()).toEqual([]);
  });

  /**
   * El caso que nadie mira: falta el `.db` pero sobrevivió su `-wal`.
   *
   * Pasa de verdad —el antivirus pone en cuarentena un archivo y no los otros,
   * alguien borra "la base de datos" y deja los de al lado— y es el peor,
   * porque el WAL huérfano se queda junto a la base recién restaurada y SQLite
   * intenta aplicárselo encima. Los otros dos tests no lo tocan: uno borra los
   * tres archivos y el otro tiene el `.db` presente.
   */
  it("se lleva el -wal huérfano aunque la base no esté", async () => {
    dir = await usarCarpeta();
    const r = await respaldar();
    const ruta = rutaBaseDeDatos();

    await db.$disconnect();
    rmSync(ruta, { force: true }); // se perdió la base…
    writeFileSync(ruta + "-wal", "wal huérfano de la base perdida"); // …pero no su -wal

    const vuelta = await restaurar(r.archivo!);
    expect(vuelta.ok, vuelta.error ?? "").toBe(true);
    expect(existsSync(ruta + "-wal")).toBe(false);
    expect(vuelta.pasos.join(" ")).toContain("-wal viejo");

    expect(await enableWAL()).toBe("wal");
    expect(await runStartupChecks()).toEqual([]);
  });

  /**
   * La base que había NO se borra: restaurar el respaldo equivocado es un error
   * de dedo perfectamente posible y sin esto no tendría vuelta.
   */
  it("aparta la base que había, con su -wal, en vez de borrarla", async () => {
    dir = await usarCarpeta();
    const r = await respaldar();
    const ruta = rutaBaseDeDatos();

    await db.$disconnect();
    // Un `-wal` viejo junto a una base nueva es la trampa fina de SQLite: se
    // aplica encima y mezcla dos bases distintas.
    writeFileSync(ruta + "-wal", "wal viejo");

    const vuelta = await restaurar(r.archivo!);
    expect(vuelta.ok, vuelta.error ?? "").toBe(true);
    expect(vuelta.apartada).not.toBeNull();
    expect(existsSync(vuelta.apartada!)).toBe(true);
    expect(existsSync(ruta + "-wal")).toBe(false);
    expect(existsSync(vuelta.apartada! + "-wal")).toBe(true);

    expect(await enableWAL()).toBe("wal");
    expect(await runStartupChecks()).toEqual([]);

    // Limpieza: la base apartada no se queda ocupando disco en los tests.
    for (const suf of ["", "-wal", "-shm"]) rmSync(vuelta.apartada! + suf, { force: true });
  });
});
