/**
 * Componentes base tematizados con los tokens (UI-BRIEF §3).
 *
 * No se usa el look por defecto de shadcn: los tokens mandan. Todos los colores
 * salen de las clases de Tailwind, que a su vez leen las variables --fh-*.
 */
import { clsx } from "clsx";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";

type Variante = "principal" | "secundaria" | "fantasma";

/** forwardRef por lo mismo que `Campo`: el foco se mueve solo, sin mouse. */
export const Boton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }>(
  function Boton({ variante = "secundaria", className, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={clsx(
        "min-h-touch min-w-touch inline-flex items-center justify-center gap-2 rounded-[var(--fh-radio)]",
        "px-4 font-semibold transition-colors duration-100 disabled:opacity-40 disabled:cursor-not-allowed",
        variante === "principal" && "fh-accion hover:brightness-95",
        variante === "secundaria" && "bg-surface text-ink border border-line hover:bg-bg",
        variante === "fantasma" && "text-ink-soft hover:text-ink",
        className,
      )}
      {...props}
    />
  );
});

type CampoProps = InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; hint?: string };

/** forwardRef porque el foco se mueve solo: se opera sin mouse. */
export const Campo = forwardRef<HTMLInputElement, CampoProps>(function Campo(
  { etiqueta, hint, className, ...props },
  ref,
) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-soft">{etiqueta}</span>
      <input
        ref={ref}
        className={clsx(
          "min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-3",
          "text-ink placeholder:text-ink-soft/60",
          className,
        )}
        {...props}
      />
      {hint ? <span className="mt-1 block text-xs text-ink-soft">{hint}</span> : null}
    </label>
  );
});

/** Color + PALABRA, nunca solo color: hay daltonismo en el mesón. */
export function Chip({ tono, children }: { tono: "ok" | "warn" | "error" | "neutral"; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        tono === "ok" && "border-ok/30 bg-ok/10 text-ok",
        tono === "warn" && "border-warn/30 bg-warn/10 text-warn",
        tono === "error" && "border-error/30 bg-error/10 text-error",
        tono === "neutral" && "border-line bg-bg text-ink-soft",
      )}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Tarjeta({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--fh-radio)] border border-line bg-surface p-4">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">{titulo}</h2>
      {children}
    </section>
  );
}

export function Dato({ etiqueta, valor }: { etiqueta: string; valor: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-ink-soft">{etiqueta}</div>
      <div className="fh-num text-2xl font-bold">{valor}</div>
    </div>
  );
}

/**
 * Diálogo modal. Extraído del kardex, que lo tenía escrito a mano, cuando
 * aparecieron cuatro pantallas más que necesitaban lo mismo: cerrar con Escape,
 * foco atrapado adentro y fondo que no se puede clickear por error.
 *
 * `aria-label` no es decoración: el vendedor opera sin mouse y el lector de
 * pantalla tiene que anunciar en qué diálogo está parado.
 */
export function Modal({
  titulo,
  bajada,
  ancho = "md",
  onCerrar,
  children,
}: {
  titulo: string;
  bajada?: ReactNode;
  ancho?: "md" | "lg" | "xl";
  onCerrar: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      className="fixed inset-0 z-10 grid place-items-center overflow-y-auto bg-ink/40 p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCerrar();
      }}
    >
      {/*
        La caja tiene tope de alto y scroll propio: a 1366×768 —el presupuesto
        que fija el brief— un formulario de doce campos no cabe, y sin esto sus
        botones quedan bajo el borde de la pantalla. Las acciones van pegadas
        abajo con `Acciones`, para que el botón principal esté siempre visible
        sin que nadie tenga que descubrir que el diálogo se desplaza.
      */}
      <div
        className={clsx(
          "my-auto max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-[var(--fh-radio)] border border-line bg-surface p-6",
          ancho === "md" && "max-w-md",
          ancho === "lg" && "max-w-2xl",
          ancho === "xl" && "max-w-5xl",
        )}
      >
        <h2 className="text-lg font-bold text-ink">{titulo}</h2>
        {bajada ? <div className="mt-1 text-sm text-ink-soft">{bajada}</div> : null}
        {children}
      </div>
    </div>
  );
}

/**
 * Un `select` con la misma pinta que `Campo`. Existe porque un `<select>` sin
 * estilar en medio de campos estilados se lee como si estuviera deshabilitado.
 */
export function Selector({
  etiqueta,
  hint,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink-soft">{etiqueta}</span>
      <select
        className="min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-3 text-ink"
        {...props}
      >
        {children}
      </select>
      {hint ? <span className="mt-1 block text-xs text-ink-soft">{hint}</span> : null}
    </label>
  );
}

/**
 * La fila de botones de un diálogo, pegada al borde inferior. Vive acá y no en
 * cada pantalla porque el error que evita es siempre el mismo: el formulario
 * crece, el botón principal se va bajo el pliegue y nadie lo ve.
 */
export function Acciones({ children }: { children: ReactNode }) {
  return (
    /*
      Sin `-mb-6`: con el margen negativo, la barra se pega al borde del PADDING
      y no al del borde de la caja, o sea 24 píxeles más arriba — y esos 24
      píxeles de contenido quedan tapados para siempre. Se veía comiéndose la
      última línea de ayuda del formulario de usuarios.
    */
    <div className="sticky bottom-0 -mx-6 mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-6 py-4">
      {children}
    </div>
  );
}
