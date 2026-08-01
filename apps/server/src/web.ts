/**
 * Servir la interfaz desde el mismo proceso que el API (tarea 7.1, empaquetado).
 *
 * En desarrollo la pantalla la sirve Vite en el 5173 y este archivo no hace
 * nada: el `dist/` de la web no existe todavía y `servirLaInterfaz` se va
 * diciendo que no. En la tienda no hay Vite —es un servicio de Windows, no una
 * consola con `pnpm dev` abierta—, así que si nadie sirve `apps/web/dist` el
 * terminal que entra a `http://servidor:3000` recibe un 404 y la instalación
 * queda a medias sin ningún síntoma del lado del servidor: el API contesta
 * perfecto, `/api/health` dice `ok`, y la pantalla está en blanco.
 *
 * Un solo puerto además evita el problema que no se ve hasta que aparece: dos
 * puertos son dos reglas de firewall, dos direcciones que memorizar y un CORS
 * que empieza a importar.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/**
 * `fileURLToPath` y no `.pathname`: en Windows el pathname llega como "/C:/…"
 * y cualquier `join` posterior produce "C:\C:\…".
 *
 * La ruta relativa sirve igual desde `src/` (tsx, en desarrollo) que desde
 * `dist/` (node, en la tienda), porque las dos carpetas cuelgan de
 * `apps/server` a la misma profundidad. Si algún día el build deja de ser
 * plano, esto se rompe fuerte y a la vista, que es como hay que romperse.
 */
export const CARPETA_WEB = fileURLToPath(new URL("../../web/dist/", import.meta.url));

/**
 * Devuelve `false` si no hay build de la interfaz, en vez de reventar: es
 * exactamente la situación de desarrollo, y ahí el servidor tiene que arrancar
 * igual. En la tienda, quien avisa es el instalador —que compila antes de
 * crear el servicio— y el arranque, que lo deja escrito en el log.
 */
export async function servirLaInterfaz(app: FastifyInstance, carpeta = CARPETA_WEB): Promise<boolean> {
  const indice = join(carpeta, "index.html");
  if (!existsSync(indice)) return false;

  await app.register(fastifyStatic, {
    root: carpeta,
    /**
     * `cacheControl: false` y la cabecera puesta a mano, y NO `maxAge` +
     * `immutable`: esas dos opciones las aplica `send` DESPUÉS de llamar a
     * `setHeaders`, así que la excepción para el index quedaba pisada por el
     * `max-age=1y` general. El síntoma habría sido de los caros: el terminal
     * se queda con el index viejo durante un año, sigue pidiendo los assets
     * que ese index nombra, y una actualización no cambia nada en pantalla sin
     * que nadie pueda explicar por qué.
     */
    cacheControl: false,
    setHeaders(res, ruta) {
      // Vite le pone un hash en el nombre a todo lo que va en `assets/`: ese
      // contenido es inmutable por definición. El index es el único archivo
      // con nombre estable, y por eso es el único que no se cachea.
      const cacheable = !ruta.endsWith("index.html");
      res.setHeader("cache-control", cacheable ? "public, max-age=31536000, immutable" : "no-cache");
    },
  });

  /**
   * El fallback de una SPA: `/venta`, `/catalogo` y `/caja` son rutas de React
   * Router, no archivos. Sin esto funcionan al navegar dentro de la aplicación
   * y fallan al recargar con F5 —o al abrir el acceso directo apuntando a una
   * de ellas—, que es el modo de fallar más confuso posible porque depende de
   * cómo llegaste a la página.
   *
   * `/api` se excluye a mano: una ruta de API mal escrita tiene que contestar
   * un 404 en JSON, como siempre. Si le devolviera el `index.html`, el cliente
   * intentaría parsear HTML como JSON y el error diría cualquier cosa menos
   * "esa ruta no existe".
   */
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api")) {
      return reply.code(404).send({ error: "Esa ruta no existe" });
    }
    return reply.sendFile("index.html");
  });

  return true;
}
