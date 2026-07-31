/**
 * Ata `tailwind.config.js` a `tokens.css`.
 *
 * El modo de fallar que previene: alguien agrega `colors: { peligro: "var(--fh-peligro)" }`
 * a Tailwind sin definir la variable. La clase existe, compila, y en pantalla el
 * elemento sale sin color — sin error, sin advertencia, y solo se ve en el mesón.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = readFileSync(join(raiz, "src/tokens.css"), "utf-8");
const config = readFileSync(join(raiz, "tailwind.config.js"), "utf-8");

/**
 * Todo el código del frontend, SIN comentarios: un comentario que explica el
 * error —"antes decía `var(--fh-ink)`"— no es el error, y sin sacarlos
 * documentar la corrección la volvería a marcar como defecto.
 */
function sinComentarios(texto: string): string {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function fuentes(dir: string, acc: { ruta: string; texto: string }[] = []) {
  for (const e of readdirSync(dir)) {
    const ruta = join(dir, e);
    if (statSync(ruta).isDirectory()) fuentes(ruta, acc);
    else if (/\.(css|tsx?|jsx?)$/.test(e) && !/\.test\./.test(e)) {
      acc.push({ ruta, texto: sinComentarios(readFileSync(ruta, "utf-8")) });
    }
  }
  return acc;
}
const ARCHIVOS = fuentes(join(raiz, "src"));

/**
 * `[a-z0-9-]`, no `[a-z-]`: la dirección "Mesón rojo" trae `--fh-accent-600`, y
 * con el patrón de solo letras ese token no lo capturaba NINGUNA de las cinco
 * expresiones de este archivo. El resultado no era un test rojo sino algo peor:
 * el token quedaba fuera de todas las comprobaciones —podía estar en
 * hexadecimal, podía faltar en Tailwind, podía usarse como `var()` pelado— y el
 * archivo seguía en verde diciendo que había revisado todo.
 */
const NOMBRE = "--fh-[a-z0-9-]+";

const definidas = new Set([...tokens.matchAll(new RegExp(`^\\s*(${NOMBRE}):`, "gm"))].map((m) => m[1]!));
const usadas = new Set([...config.matchAll(new RegExp(`var\\((${NOMBRE})\\)`, "g"))].map((m) => m[1]!));

/**
 * Los colores de la dirección "Mesón rojo" (ADR 007). Están todos acá y no solo
 * los del `tokens.css` del traspaso: los de borde, los de texto sobre
 * superficie tintada y los del cascarón oscuro los nombra el README de la
 * entrega en «Componentes» y «Navegación», y si no fueran tokens tendrían que
 * escribirse a mano en un .tsx — que es justo lo que `check:tokens` prohíbe.
 */
const COLORES = [
  "--fh-bg", "--fh-surface", "--fh-ink", "--fh-ink-soft",
  "--fh-line", "--fh-line-soft", "--fh-line-field", "--fh-line-idle", "--fh-line-key",
  "--fh-accent", "--fh-accent-600", "--fh-accent-tint", "--fh-accent-ink",
  "--fh-mono-ink",
  "--fh-ok", "--fh-ok-ink", "--fh-ok-bright",
  "--fh-warn", "--fh-warn-ink", "--fh-error",
  "--fh-shell-text", "--fh-shell-icon", "--fh-shell-label", "--fh-shell-muted",
  "--fh-shell-line", "--fh-shell-line-soft", "--fh-shell-border", "--fh-shell-hover",
];

describe("tokens", () => {
  it("toda variable que usa Tailwind está definida en tokens.css", () => {
    expect([...usadas].filter((v) => !definidas.has(v))).toEqual([]);
  });

  it("están todos los colores de la dirección Mesón rojo", () => {
    for (const v of COLORES) {
      expect(definidas.has(v), `falta ${v}`).toBe(true);
    }
  });

  it("el acento es el rojo del logo, no el amarillo del brief anterior", () => {
    // #f9353f en canales.
    expect(tokens).toMatch(/--fh-accent:\s*249 53 63\b/);
    expect(tokens, "el amarillo #ffc400 se retiró por completo").not.toMatch(/255 196 0\b/);
  });

  /**
   * La trampa de haber movido el acento al rojo, y la única regla de la
   * dirección nueva que se puede comprobar sin mirar la pantalla: el rojo de
   * ACCIÓN y el rojo de ERROR no pueden ser el mismo tono, o "cobrar" y "algo
   * salió mal" se confunden. `--fh-error` es un paso más profundo, y coincide
   * con `--fh-accent-ink` a propósito: es el rojo que se puede leer chico.
   */
  it("el rojo de la acción y el rojo del error no son el mismo", () => {
    const valor = (v: string) => tokens.match(new RegExp(`${v}:\\s*([\\d ]+);`))?.[1]?.trim();
    expect(valor("--fh-accent")).not.toEqual(valor("--fh-error"));
    expect(valor("--fh-error")).toEqual(valor("--fh-accent-ink"));
  });

  it("el radio es cero: nada se redondea", () => {
    expect(tokens).toMatch(/--fh-radio:\s*0px/);
  });

  /**
   * El guardián del defecto que estuvo vivo todo el Sprint 0.
   *
   * Si un color se define como hexadecimal, Tailwind sirve `bg-ink/40` como
   * `rgb(#16181a / 0.4)` — CSS inválido, que el navegador DESCARTA ENTERO sin
   * avisar. El elemento queda transparente. Así, el `Chip` de estado nunca
   * tuvo color de fondo y el velo de los diálogos no oscurecía nada; se
   * descubrió mirando una captura, no fallando un test. Por eso este test.
   */
  it("los colores van en canales RGB, que es lo que hace funcionar la opacidad", () => {
    const enHexadecimal = [...tokens.matchAll(new RegExp(`^\\s*(${NOMBRE}):\\s*(#[0-9a-f]{3,8})`, "gim"))];
    expect(
      enHexadecimal.map((m) => `${m[1]} = ${m[2]}`),
      "un color en hexadecimal rompe bg-*/opacidad en silencio",
    ).toEqual([]);

    for (const v of COLORES) {
      expect(tokens, `${v} tiene que ser tres canales`).toMatch(
        new RegExp(`${v}:\\s*\\d{1,3} \\d{1,3} \\d{1,3}\\b`),
      );
    }
  });

  it("Tailwind pide la opacidad con <alpha-value> en todos los colores", () => {
    const sinAlpha = [...config.matchAll(new RegExp(`^\\s*"?([a-z0-9-]+)"?:\\s*"rgb\\(var\\(${NOMBRE}\\)\\)"`, "gm"))];
    expect(sinAlpha.map((m) => m[1])).toEqual([]);
    for (const v of COLORES) {
      expect(config, `${v} no está nombrado en Tailwind`).toContain(`rgb(var(${v}) / <alpha-value>)`);
    }
  });

  /**
   * Un token declarado y nunca usado es una promesa que nadie cumplió.
   * `--fh-foco` estuvo así todo el Sprint 0: definido, documentado, y el
   * anillo de foco lo escribía a mano en otra parte.
   */
  it("todo token declarado se usa en alguna parte", () => {
    const declarados = [...tokens.matchAll(new RegExp(`^\\s*(${NOMBRE}):`, "gm"))].map((m) => m[1]!);
    const sinUsar = declarados.filter((v) => {
      if (config.includes(v)) return false;
      return !ARCHIVOS.some((a) => a.texto.includes(`var(${v})`) && !a.ruta.endsWith("tokens.css"));
    });
    expect(sinUsar, "declarados pero no usados en ninguna parte").toEqual([]);
  });

  /**
   * El guardián de la regresión que introdujo el paso a canales: fuera de
   * tokens.css, un token de COLOR no se puede usar como `var(--fh-ink)` a
   * secas. Con canales adentro eso es CSS inválido y el navegador descarta la
   * declaración sin decir nada — así se perdió el anillo de foco.
   */
  it("ningún color se usa como var() pelado fuera de tokens.css", () => {
    const malos: string[] = [];
    for (const a of ARCHIVOS) {
      if (a.ruta.endsWith("tokens.css")) continue;
      for (const m of a.texto.matchAll(new RegExp(`(?<!rgb\\()var\\((${NOMBRE})\\)`, "g"))) {
        if (COLORES.includes(m[1]!)) malos.push(`${a.ruta.split("/src/")[1]} → ${m[0]}`);
      }
    }
    expect(malos, "envuélvelo en rgb(), o usa la clase de Tailwind").toEqual([]);
  });
});
