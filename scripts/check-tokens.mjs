/**
 * Chequeo de CI (tarea 0.11 / UI-BRIEF §3): ningún color fuera de tokens.css.
 *
 * No es purismo. Si se cuelan cinco hexadecimales por los componentes, cambiar
 * la dirección visual deja de ser editar un archivo y pasa a ser cazar colores
 * por todo el código — y en la práctica ya no se cambia.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, basename } from "node:path";

const RAIZ = new URL("..", import.meta.url).pathname;
const EXT = new Set([".ts", ".tsx", ".css", ".jsx", ".js"]);
const IGNORAR = new Set(["node_modules", "dist", ".git", "public", "migrations"]);
// El único archivo con colores, más el que documenta la paleta.
const PERMITIDOS = new Set(["tokens.css"]);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const FUNC = /\b(rgb|rgba|hsl|hsla)\s*\(/g;

const hallazgos = [];

function recorrer(dir) {
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR.has(entrada)) continue;
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) recorrer(ruta);
    else if (EXT.has(extname(entrada)) && !PERMITIDOS.has(basename(entrada))) {
      const texto = readFileSync(ruta, "utf-8");
      texto.split("\n").forEach((linea, i) => {
        // `rgb(22 24 26 / 0.15)` dentro de tokens.css está permitido; acá no.
        const colores = [...(linea.match(HEX) ?? []), ...(linea.match(FUNC) ?? [])];
        if (colores.length) {
          hallazgos.push({ ruta: ruta.replace(RAIZ, ""), linea: i + 1, colores: colores.join(" ") });
        }
      });
    }
  }
}

recorrer(join(RAIZ, "apps/web/src"));

if (hallazgos.length) {
  console.error("\nColores fuera de tokens.css:\n");
  for (const h of hallazgos) console.error(`  ${h.ruta}:${h.linea}  →  ${h.colores}`);
  console.error("\nDefínelos como variable --fh-* en tokens.css y úsalos por nombre.\n");
  process.exit(1);
}
console.log("check:tokens — ningún color fuera de tokens.css");
