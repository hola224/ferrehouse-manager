/**
 * La carga del `.env` y el rechazo de la clave pública.
 *
 * Lo que estas pruebas cuidan no es que el `.env` se lea —eso se nota al
 * primer arranque—, sino las dos cosas que fallarían en silencio: que el
 * archivo NO le pise variables que ya venían del entorno (o los tests se
 * pondrían a escribir en la base de la tienda), y que la clave de ejemplo del
 * repositorio no pueda llegar a producción.
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cargarEnv, assertJwtSecret } from "./entorno.js";

function archivoEnv(contenido: string): string {
  const ruta = join(mkdtempSync(join(tmpdir(), "fh-env-")), ".env");
  writeFileSync(ruta, contenido);
  return ruta;
}

const ensuciadas: string[] = [];
function ensuciar(clave: string, valor?: string) {
  ensuciadas.push(clave);
  if (valor === undefined) delete process.env[clave];
  else process.env[clave] = valor;
}
afterEach(() => {
  for (const c of ensuciadas.splice(0)) delete process.env[c];
});

describe("cargar el .env", () => {
  it("sin archivo no revienta: devuelve false", () => {
    expect(cargarEnv(join(tmpdir(), "no-existe-jamas", ".env"))).toBe(false);
  });

  it("trae las variables que faltaban", () => {
    ensuciar("FH_PRUEBA_NUEVA");
    cargarEnv(archivoEnv('FH_PRUEBA_NUEVA="desde-el-archivo"\n'));
    expect(process.env.FH_PRUEBA_NUEVA).toBe("desde-el-archivo");
  });

  /**
   * El invariante caro. `process.loadEnvFile` por su cuenta pisa lo que ya
   * está; si esto se rompiera, `db.ts` le cambiaría a cada archivo de test el
   * `DATABASE_URL` propio por el de la tienda —y los tests borran su base.
   */
  it("NO pisa lo que ya venía en el entorno", () => {
    ensuciar("FH_PRUEBA_EXISTENTE", "del-entorno");
    cargarEnv(archivoEnv('FH_PRUEBA_EXISTENTE="del-archivo"\n'));
    expect(process.env.FH_PRUEBA_EXISTENTE).toBe("del-entorno");
  });

  it("en particular, respeta el DATABASE_URL que ponen los tests", () => {
    const propio = process.env.DATABASE_URL;
    cargarEnv(archivoEnv('DATABASE_URL="file:./la-base-de-la-tienda.db?connection_limit=1"\n'));
    expect(process.env.DATABASE_URL).toBe(propio);
  });
});

describe("la clave de firma", () => {
  it("acepta una clave larga de verdad", () => {
    expect(() => assertJwtSecret("a".repeat(64))).not.toThrow();
  });

  /**
   * Sin argumento lee `process.env.JWT_SECRET`, que es como la llama `main.ts`.
   * Pasarle `undefined` a mano no serviría: el parámetro por omisión se
   * activaría igual y la prueba estaría mirando otra cosa.
   */
  it("rechaza que falte", () => {
    ensuciar("JWT_SECRET");
    expect(() => assertJwtSecret()).toThrow(/Falta JWT_SECRET/);
    expect(() => assertJwtSecret("")).toThrow(/Falta JWT_SECRET/);
  });

  /** Las que están escritas en el repositorio, o sea las que son públicas. */
  it("rechaza los valores de ejemplo, uno por uno", () => {
    for (const publico of ["cambiar", "cambiar-en-instalacion", "dev-solo-para-desarrollo", "test-secret"]) {
      expect(() => assertJwtSecret(publico), publico).toThrow(/valor de ejemplo/);
    }
  });

  it("rechaza una clave corta: contra un token capturado se prueba offline", () => {
    expect(() => assertJwtSecret("abc123")).toThrow(/al menos 32/);
    expect(() => assertJwtSecret("a".repeat(31))).toThrow(/al menos 32/);
  });
});
