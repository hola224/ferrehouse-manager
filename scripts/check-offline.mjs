/**
 * Chequeo de CI (tarea 0.10): nada puede depender de internet.
 *
 * La tienda no tiene conexión. Una fuente remota, un CDN de iconos o un script
 * externo funcionan perfecto en el PC del desarrollador y fallan callados en el
 * mesón — la tipografía cae al fallback, el icono no aparece, y nadie relaciona
 * el síntoma con la causa. Este script hace que eso sea un error de build.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname;
const EXT = new Set([".ts", ".tsx", ".css", ".html", ".js", ".jsx", ".json"]);
// `public` NO se excluye: es justo donde viviría un CSS vendorizado con un
// @import remoto, que es el modo de fallar que este script existe para atrapar.
const IGNORAR = new Set(["node_modules", "dist", ".git", "migrations", ".claude"]);

// Hosts que no pueden aparecer en el código que se sirve al navegador.
const PROHIBIDOS = [
  ["fonts." + "googleapis.com", "fuente remota"],
  ["fonts." + "gstatic.com", "fuente remota"],
  ["cdn.jsdelivr.net", "CDN"],
  ["unpkg.com", "CDN"],
  ["cdnjs.cloudflare.com", "CDN"],
];

const hallazgos = [];

function recorrer(dir) {
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR.has(entrada)) continue;
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) recorrer(ruta);
    else if (EXT.has(extname(entrada))) {
      const texto = readFileSync(ruta, "utf-8");
      for (const [aguja, tipo] of PROHIBIDOS) {
        if (texto.includes(aguja)) hallazgos.push({ ruta: ruta.replace(RAIZ, ""), aguja, tipo });
      }
    }
  }
}

recorrer(join(RAIZ, "apps"));
recorrer(join(RAIZ, "packages"));

if (hallazgos.length) {
  console.error("\nDependencias de internet en el código:\n");
  for (const h of hallazgos) console.error(`  ${h.ruta}\n    → ${h.aguja} (${h.tipo})`);
  console.error("\nLa tienda no tiene conexión: descarga el recurso al repositorio.\n");
  process.exit(1);
}
console.log("check:offline — sin dependencias de internet");
