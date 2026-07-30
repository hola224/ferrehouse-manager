/**
 * Componentes base tematizados con los tokens (UI-BRIEF §3).
 *
 * No se usa el look por defecto de shadcn: los tokens mandan. Todos los colores
 * salen de las clases de Tailwind, que a su vez leen las variables --fh-*.
 */
import { clsx } from "clsx";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

type Variante = "principal" | "secundaria" | "fantasma";

export function Boton({
  variante = "secundaria",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante }) {
  return (
    <button
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
}

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
