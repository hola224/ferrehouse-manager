/**
 * La interfaz servida por el propio servidor (empaquetado para Windows).
 *
 * Estas pruebas montan la web a mano sobre una carpeta temporal en vez de
 * apuntar al `apps/web/dist` real: así corren igual en una máquina donde nadie
 * compiló la web todavía —que es el caso normal en CI— y no dependen de que el
 * build de Vite se llame de una manera u otra.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { servirLaInterfaz } from "./web.js";

const HTML = "<!doctype html><title>Ferrehouse Manager</title><div id=root></div>";

function carpetaConBuild(): string {
  const raiz = mkdtempSync(join(tmpdir(), "fh-web-"));
  writeFileSync(join(raiz, "index.html"), HTML);
  mkdirSync(join(raiz, "assets"));
  writeFileSync(join(raiz, "assets", "index-abc123.js"), "console.log(1)");
  return raiz;
}

/** Una app mínima con una ruta de API, para verificar que no la pisa nada. */
async function appConWeb(carpeta: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.get("/api/health", async () => ({ ok: true }));
  await servirLaInterfaz(app, carpeta);
  await app.ready();
  return app;
}

let app: FastifyInstance;

beforeAll(async () => {
  app = await appConWeb(carpetaConBuild());
});

describe("servir la interfaz junto al API", () => {
  it("sin build no monta nada, y lo dice devolviendo false", async () => {
    const vacia = mkdtempSync(join(tmpdir(), "fh-sin-web-"));
    const suelta = Fastify({ logger: false });
    expect(await servirLaInterfaz(suelta, vacia)).toBe(false);
  });

  it("la raíz entrega el index.html", async () => {
    const r = await app.inject({ method: "GET", url: "/" });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Ferrehouse Manager");
  });

  it("los assets con hash se sirven y se cachean para siempre", async () => {
    const r = await app.inject({ method: "GET", url: "/assets/index-abc123.js" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["cache-control"]).toContain("immutable");
  });

  /**
   * El index NO se cachea aunque viva en la misma carpeta: es el único archivo
   * con nombre estable, y cacheado deja al terminal pidiendo los assets viejos
   * después de una actualización.
   */
  it("el index.html no se cachea", async () => {
    const r = await app.inject({ method: "GET", url: "/" });
    expect(r.headers["cache-control"]).toBe("no-cache");
  });

  /**
   * El motivo de existir del fallback: recargar con F5 estando en /venta.
   * Sin esto la aplicación anda al navegar y falla al recargar, que es el modo
   * de fallar más confuso porque depende de cómo llegaste a la página.
   */
  it("una ruta de la SPA recargada con F5 entrega el index, no un 404", async () => {
    for (const ruta of ["/venta", "/catalogo", "/caja/cierre"]) {
      const r = await app.inject({ method: "GET", url: ruta });
      expect(r.statusCode, ruta).toBe(200);
      expect(r.body, ruta).toContain("Ferrehouse Manager");
    }
  });

  it("una ruta de API mal escrita sigue contestando 404 en JSON, no el index", async () => {
    const r = await app.inject({ method: "GET", url: "/api/no-existe" });
    expect(r.statusCode).toBe(404);
    expect(r.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(r.body).error).toBe("Esa ruta no existe");
  });

  it("las rutas de API de verdad siguen funcionando", async () => {
    const r = await app.inject({ method: "GET", url: "/api/health" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
  });

  /**
   * Con el fallback de la SPA, TODO lo desconocido contesta 200 con el index —
   * así que "no filtra" no se comprueba mirando el código de estado, que es el
   * error fácil de cometer acá. Lo que hay que comprobar es el cuerpo: pase lo
   * que pase, nunca puede salir el contenido de un archivo de más arriba. En
   * la tienda, dos carpetas más arriba está `apps/server/.env`, que es la
   * clave con la que se firman los tokens de administrador.
   */
  it("nunca entrega un archivo de fuera de la carpeta del build", async () => {
    const raiz = mkdtempSync(join(tmpdir(), "fh-fuera-"));
    writeFileSync(join(raiz, "secreto.env"), "JWT_SECRET=no-puede-salir-de-aca");
    const build = join(raiz, "dist");
    mkdirSync(build);
    writeFileSync(join(build, "index.html"), HTML);
    const suelta = await appConWeb(build);

    for (const url of [
      "/../secreto.env",
      "/%2e%2e/secreto.env",
      "/..%2fsecreto.env",
      "/assets/../../secreto.env",
      "/%2e%2e%5csecreto.env", // separador de Windows
    ]) {
      const r = await suelta.inject({ method: "GET", url });
      expect(r.body, url).not.toContain("no-puede-salir-de-aca");
    }
  });
});
