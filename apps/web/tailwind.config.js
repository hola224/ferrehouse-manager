/**
 * Los colores NO se definen acá: se leen de tokens.css. Tailwind solo les pone
 * nombre. Así cambiar la dirección visual es editar un archivo, no cazar
 * hexadecimales por los componentes (UI-BRIEF §3).
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--fh-bg)",
        surface: "var(--fh-surface)",
        ink: "var(--fh-ink)",
        "ink-soft": "var(--fh-ink-soft)",
        line: "var(--fh-line)",
        accent: "var(--fh-accent)",
        "mono-ink": "var(--fh-mono-ink)",
        ok: "var(--fh-ok)",
        warn: "var(--fh-warn)",
        error: "var(--fh-error)",
      },
      fontFamily: {
        sans: ["Archivo", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Escala XL del POS: el total se lee a 1,5 m (UI-BRIEF §2.3)
        total: ["clamp(2.5rem, 4vw, 3.5rem)", { lineHeight: "1", fontWeight: "900" }],
      },
      minHeight: { touch: "44px" }, // dedos con guantes, mesón con polvo
      minWidth: { touch: "44px" },
    },
  },
  plugins: [],
};
