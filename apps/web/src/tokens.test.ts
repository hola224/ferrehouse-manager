/**
 * Ata `tailwind.config.js` a `tokens.css`.
 *
 * El modo de fallar que previene: alguien agrega `colors: { peligro: "var(--fh-peligro)" }`
 * a Tailwind sin definir la variable. La clase existe, compila, y en pantalla el
 * elemento sale sin color — sin error, sin advertencia, y solo se ve en el mesón.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const tokens = readFileSync(join(raiz, "src/tokens.css"), "utf-8");
const config = readFileSync(join(raiz, "tailwind.config.js"), "utf-8");

const definidas = new Set([...tokens.matchAll(/^\s*(--fh-[a-z-]+):/gm)].map((m) => m[1]!));
const usadas = new Set([...config.matchAll(/var\((--fh-[a-z-]+)\)/g)].map((m) => m[1]!));

const COLORES = [
  "--fh-bg", "--fh-surface", "--fh-ink", "--fh-ink-soft", "--fh-line",
  "--fh-accent", "--fh-mono-ink", "--fh-ok", "--fh-warn", "--fh-error",
];

describe("tokens", () => {
  it("toda variable que usa Tailwind está definida en tokens.css", () => {
    expect([...usadas].filter((v) => !definidas.has(v))).toEqual([]);
  });

  it("están los diez colores de la dirección Mesón", () => {
    for (const v of COLORES) {
      expect(definidas.has(v), `falta ${v}`).toBe(true);
    }
  });

  it("el acento es el amarillo seguridad del brief", () => {
    // #ffc400 en canales.
    expect(tokens).toMatch(/--fh-accent:\s*255 196 0\b/);
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
    const enHexadecimal = [...tokens.matchAll(/^\s*(--fh-[a-z-]+):\s*(#[0-9a-f]{3,8})/gim)];
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
    const sinAlpha = [...config.matchAll(/^\s*"?([a-z-]+)"?:\s*"rgb\(var\(--fh-[a-z-]+\)\)"/gm)];
    expect(sinAlpha.map((m) => m[1])).toEqual([]);
    for (const v of COLORES) {
      expect(config).toContain(`rgb(var(${v}) / <alpha-value>)`);
    }
  });
});
