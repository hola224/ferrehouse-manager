/**
 * Componentes base tematizados con los tokens.
 *
 * Dirección visual "Mesón rojo" (ADR 007): radio 0, reglas de 2px, etiquetas de
 * botón a la izquierda. Ningún color se escribe acá: todos salen de las clases
 * de Tailwind, que a su vez leen las variables --fh-* de `tokens.css`.
 *
 * Las tres reglas de esta dirección que se rompen solas si nadie las cuida:
 *
 * 1. **Sobre el rojo, el texto va en blanco.** Al revés que con el amarillo de
 *    antes, donde iba en tinta. Lo impone `.fh-accion`, no cada botón.
 * 2. **El rojo pleno es SOLO acción.** El error se pinta con superficie
 *    `accent-tint`, borde, y LA PALABRA — mira el `Chip`. Si una pantalla
 *    tiene dos cosas rojas plenas, una de las dos está mal.
 * 3. **Nada se centra**, salvo los teclados numéricos.
 */
import { clsx } from "clsx";
import { forwardRef } from "react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from "react";

type Variante = "principal" | "secundaria" | "fantasma";

/**
 * forwardRef por lo mismo que `Campo`: el foco se mueve solo, sin mouse.
 *
 * `tecla` no es azúcar. Antes cada pantalla escribía la tecla dentro del
 * contenido —`Cobrar <span>F2</span>`— y quedaba pegada a la etiqueta, en medio
 * del botón. La promesa del diseño es otra: la etiqueta arranca en el borde
 * izquierdo y la tecla termina en el derecho, así que en una columna de botones
 * las teclas se leen todas juntas sin perseguirlas.
 */
export const Boton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; tecla?: string }
>(function Boton({ variante = "secundaria", tecla, className, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={clsx(
        "min-h-touch min-w-touch inline-flex items-center gap-3 rounded-[var(--fh-radio)]",
        "px-4 font-semibold transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-40",
        // Nunca centrado. Sin tecla el botón se encoge a su contenido y da lo
        // mismo; con tecla —o estirado a lo ancho— es lo que hace la diferencia.
        tecla ? "justify-between" : "justify-start",
        // `fh-accion` trae fondo, texto blanco y el hover a accent-600. No se
        // le agrega `brightness`: se aplicarían los dos y el hover queda sucio.
        variante === "principal" && "fh-accion",
        variante === "secundaria" && "border border-line-field bg-surface text-ink hover:bg-bg",
        variante === "fantasma" && "text-ink-soft hover:text-ink",
        className,
      )}
      {...props}
    >
      {/* En un `<span>` y no suelto: es lo que permite que `justify-between`
          empuje la tecla al otro extremo en vez de repartir cada palabra. */}
      <span className="inline-flex items-center gap-2">{children}</span>
      {tecla ? (
        <kbd
          className={clsx(
            "fh-num font-mono font-normal",
            variante === "principal"
              ? "border border-white/50 px-[7px] py-0.5 text-[13px]"
              : "text-[11px] text-ink-soft",
          )}
        >
          {tecla}
        </kbd>
      ) : null}
    </button>
  );
});

/**
 * La tecla de función suelta, la de la barra de ayuda del POS. No es la misma
 * que va dentro de un botón: esa hereda el color del botón que la contiene,
 * esta se dibuja sobre la pantalla y necesita su propio borde.
 */
export function Tecla({ children }: { children: ReactNode }) {
  return (
    <kbd className="fh-num border border-line-field bg-surface px-[7px] py-0.5 font-mono text-[11px] font-semibold text-ink">
      {children}
    </kbd>
  );
}

type CampoProps = InputHTMLAttributes<HTMLInputElement> & {
  etiqueta: string;
  hint?: string;
  /**
   * El campo del que depende la pantalla: el de escaneo, el del PIN, el del
   * conteo de caja, el del efectivo. Se dibuja con la regla de 2px y fondo de
   * aplicación en vez de blanco, para que se vea cuál es ANTES de leer nada.
   * La tipografía grande la pone cada pantalla, que sabe cuánto espacio tiene.
   */
  protagonista?: boolean;
};

/** forwardRef porque el foco se mueve solo: se opera sin mouse. */
export const Campo = forwardRef<HTMLInputElement, CampoProps>(function Campo(
  { etiqueta, hint, protagonista, className, ...props },
  ref,
) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
        {etiqueta}
      </span>
      <input
        ref={ref}
        className={clsx(
          "min-h-touch w-full rounded-[var(--fh-radio)] px-3.5 text-ink placeholder:text-ink-soft/60",
          protagonista ? "border-2 border-ink bg-bg" : "border border-line-field bg-surface",
          className,
        )}
        {...props}
      />
      {hint ? <span className="mt-1 block text-xs text-ink-soft">{hint}</span> : null}
    </label>
  );
});

/**
 * Color + PALABRA, nunca solo color: hay daltonismo en el mesón.
 *
 * Rectángulo, no píldora: nada se redondea en esta dirección. Y el texto NO usa
 * el mismo tono que el borde — `ok` y `warn` plenos sobre su propia superficie
 * tintada no llegan a contraste de lectura a 10px. Para eso están `ok-ink` y
 * `warn-ink`, que son el mismo color un par de pasos más profundo.
 *
 * El tono `error` se pinta con el rojo de marca en el borde y `accent-ink` en
 * el texto, sobre `accent-tint`. NUNCA con fondo rojo pleno: el rojo pleno de
 * esta interfaz significa "aprieta acá", y un estado no se aprieta.
 */
export function Chip({ tono, children }: { tono: "ok" | "warn" | "error" | "neutral"; children: ReactNode }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 border px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.1em]",
        tono === "ok" && "border-ok bg-ok/[0.08] text-ok-ink",
        tono === "warn" && "border-warn bg-warn/10 text-warn-ink",
        tono === "error" && "border-accent bg-accent-tint text-accent-ink",
        tono === "neutral" && "border-line-field bg-bg text-ink-soft",
      )}
    >
      <span aria-hidden className="h-2 w-[7px] shrink-0 bg-current" />
      {children}
    </span>
  );
}

/**
 * `titulo` es opcional: con él la tarjeta lleva encabezado propio, separado por
 * la regla de 2px; sin él es una caja lisa.
 *
 * `borde` es la franja de 4px de arriba, y solo se usa en las tarjetas de cifra
 * del panel. No es decoración: dice de qué habla el número sin leer la etiqueta
 * —verde la caja abierta, rojo las alertas— y por eso admite tres valores y no
 * un color libre.
 */
export function Tarjeta({
  titulo,
  borde,
  children,
}: {
  titulo?: string;
  borde?: "ink" | "ok" | "accent";
  children: ReactNode;
}) {
  return (
    <section
      className={clsx(
        "rounded-[var(--fh-radio)] border border-line bg-surface",
        borde === "ink" && "border-t-4 border-t-ink",
        borde === "ok" && "border-t-4 border-t-ok",
        borde === "accent" && "border-t-4 border-t-accent",
      )}
    >
      {titulo ? (
        <h2 className="border-b-2 border-ink px-[18px] py-[11px] text-xs font-extrabold uppercase tracking-[0.14em]">
          {titulo}
        </h2>
      ) : null}
      <div className="px-[18px] py-4">{children}</div>
    </section>
  );
}

/**
 * Diálogo modal. Extraído del kardex, que lo tenía escrito a mano, cuando
 * aparecieron cuatro pantallas más que necesitaban lo mismo: cerrar con Escape,
 * foco atrapado adentro y fondo que no se puede clickear por error.
 *
 * `aria-label` no es decoración: el vendedor opera sin mouse y el lector de
 * pantalla tiene que anunciar en qué diálogo está parado.
 *
 * `cifra` es el número que va a la derecha del encabezado negro —el total a
 * cobrar, lo que se va a devolver—. Va ahí y no en el cuerpo porque es el dato
 * que se mira mientras se teclea, y en el cuerpo se lo comen los campos.
 */
export function Modal({
  titulo,
  bajada,
  cifra,
  ancho = "md",
  onCerrar,
  children,
}: {
  titulo: string;
  bajada?: ReactNode;
  cifra?: ReactNode;
  ancho?: "md" | "lg" | "xl";
  onCerrar: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={titulo}
      /* El velo: el traspaso pide un negro de canales 14/15/16 al 60%, y acá va
         `bg-ink/60`, que es la tinta del sistema —22/24/26— a la misma
         opacidad. A 60% la diferencia entre los dos no existe en pantalla, y un
         token de más sí existiría para siempre.
         (Los canales van con barras y no con la sintaxis de función a propósito:
         `check:tokens` no filtra comentarios, y con razón — la forma más fácil
         de colar un color es escribirlo donde nadie lo lee.) */
      className="fixed inset-0 z-10 grid place-items-center overflow-y-auto bg-ink/60 p-4"
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

        Borde de 2px y CERO sombra: en esta dirección la profundidad se dice con
        una regla, no con un desenfoque.
      */}
      <div
        className={clsx(
          "my-auto max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-[var(--fh-radio)] border-2 border-ink bg-surface",
          ancho === "md" && "max-w-md",
          ancho === "lg" && "max-w-2xl",
          ancho === "xl" && "max-w-5xl",
        )}
      >
        <header className="flex items-center justify-between gap-4 bg-ink px-5 py-3 text-surface">
          <h2 className="text-xl font-black">{titulo}</h2>
          {cifra ? <div className="fh-num text-[38px] font-black leading-none">{cifra}</div> : null}
        </header>
        <div className="p-6">
          {bajada ? <div className="mb-4 text-sm text-ink-soft">{bajada}</div> : null}
          {children}
        </div>
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
      <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
        {etiqueta}
      </span>
      <select
        className="min-h-touch w-full rounded-[var(--fh-radio)] border border-line-field bg-surface px-3.5 text-ink"
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
    <div className="sticky bottom-0 -mx-6 mt-4 flex flex-wrap items-center justify-end gap-2 border-t-2 border-ink bg-bg px-6 py-4">
      {children}
    </div>
  );
}
