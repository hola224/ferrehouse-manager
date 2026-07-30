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

describe("tokens", () => {
  it("toda variable que usa Tailwind está definida en tokens.css", () => {
    expect([...usadas].filter((v) => !definidas.has(v))).toEqual([]);
  });

  it("están los diez colores de la dirección Mesón", () => {
    for (const v of [
      "--fh-bg", "--fh-surface", "--fh-ink", "--fh-ink-soft", "--fh-line",
      "--fh-accent", "--fh-mono-ink", "--fh-ok", "--fh-warn", "--fh-error",
    ]) {
      expect(definidas.has(v), `falta ${v}`).toBe(true);
    }
  });

  it("el acento es el amarillo seguridad del brief", () => {
    expect(tokens).toMatch(/--fh-accent:\s*#ffc400/i);
  });
});
