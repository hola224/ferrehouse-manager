/**
 * Los colores NO se definen acá: se leen de tokens.css. Tailwind solo les pone
 * nombre. Así cambiar la dirección visual es editar un archivo, no cazar
 * hexadecimales por los componentes (UI-BRIEF §3).
 *
 * El `<alpha-value>` no es adorno: es lo que permite que `bg-ink/40` y
 * `bg-error/10` existan. Tailwind lo reemplaza por la opacidad pedida, y para
 * eso la variable tiene que traer CANALES —`22 24 26`— y no un hexadecimal.
 * Con hexadecimal el navegador recibe CSS inválido y descarta la regla en
 * silencio: el elemento sale transparente y nadie se entera hasta verlo.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--fh-bg) / <alpha-value>)",
        surface: "rgb(var(--fh-surface) / <alpha-value>)",
        ink: "rgb(var(--fh-ink) / <alpha-value>)",
        "ink-soft": "rgb(var(--fh-ink-soft) / <alpha-value>)",
        line: "rgb(var(--fh-line) / <alpha-value>)",
        accent: "rgb(var(--fh-accent) / <alpha-value>)",
        "mono-ink": "rgb(var(--fh-mono-ink) / <alpha-value>)",
        ok: "rgb(var(--fh-ok) / <alpha-value>)",
        warn: "rgb(var(--fh-warn) / <alpha-value>)",
        error: "rgb(var(--fh-error) / <alpha-value>)",
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
