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
 *
 * Todo token de color se nombra acá aunque todavía no lo use nadie: es lo que
 * comprueba `tokens.test.ts` («todo token declarado se usa en alguna parte»), y
 * lo que evita que la próxima pantalla escriba el hexadecimal a mano.
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

        // Tres grises de borde, de más oscuro a más claro.
        line: "rgb(var(--fh-line) / <alpha-value>)",
        "line-soft": "rgb(var(--fh-line-soft) / <alpha-value>)",
        "line-field": "rgb(var(--fh-line-field) / <alpha-value>)",
        "line-idle": "rgb(var(--fh-line-idle) / <alpha-value>)",
        "line-key": "rgb(var(--fh-line-key) / <alpha-value>)",

        // El rojo de marca. `accent` pleno SOLO en la acción principal.
        accent: "rgb(var(--fh-accent) / <alpha-value>)",
        "accent-600": "rgb(var(--fh-accent-600) / <alpha-value>)",
        "accent-tint": "rgb(var(--fh-accent-tint) / <alpha-value>)",
        "accent-ink": "rgb(var(--fh-accent-ink) / <alpha-value>)",

        "mono-ink": "rgb(var(--fh-mono-ink) / <alpha-value>)",
        ok: "rgb(var(--fh-ok) / <alpha-value>)",
        "ok-ink": "rgb(var(--fh-ok-ink) / <alpha-value>)",
        "ok-bright": "rgb(var(--fh-ok-bright) / <alpha-value>)",
        warn: "rgb(var(--fh-warn) / <alpha-value>)",
        "warn-ink": "rgb(var(--fh-warn-ink) / <alpha-value>)",
        error: "rgb(var(--fh-error) / <alpha-value>)",

        // La escala del cascarón oscuro: solo sobre fondo `ink`.
        "shell-text": "rgb(var(--fh-shell-text) / <alpha-value>)",
        "shell-icon": "rgb(var(--fh-shell-icon) / <alpha-value>)",
        "shell-label": "rgb(var(--fh-shell-label) / <alpha-value>)",
        "shell-muted": "rgb(var(--fh-shell-muted) / <alpha-value>)",
        "shell-line": "rgb(var(--fh-shell-line) / <alpha-value>)",
        "shell-line-soft": "rgb(var(--fh-shell-line-soft) / <alpha-value>)",
        "shell-border": "rgb(var(--fh-shell-border) / <alpha-value>)",
        "shell-hover": "rgb(var(--fh-shell-hover) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Archivo", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "monospace"],
      },
      fontSize: {
        // Escala XL del POS: el total se lee a 1,5 m (UI-BRIEF §2.3)
        total: ["clamp(2.5rem, 4vw, 3.5rem)", { lineHeight: "1", fontWeight: "900" }],
      },
      // La única sombra del sistema: la lista de sugerencias que flota sobre la
      // tabla de venta. El resto de la interfaz se separa con reglas, no con
      // profundidad.
      boxShadow: { flotante: "var(--fh-sombra-flotante)" },
      minHeight: { touch: "44px" }, // dedos con guantes, mesón con polvo
      minWidth: { touch: "44px" },
    },
  },
  plugins: [],
};
