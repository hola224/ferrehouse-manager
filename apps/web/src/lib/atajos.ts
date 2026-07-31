/**
 * Los atajos de teclado, colgados de `window` y en un solo lugar (2026-07-31).
 *
 * POR QUÉ EXISTE ESTE ARCHIVO. Cada pantalla resolvía el teclado a su manera y
 * dos de ellas lo habían resuelto mal. Medido con el navegador, en Catálogo:
 *
 *     F2 con el foco en el body        → ABRE   (tenía oyente en window)
 *     F2 con el foco en el buscador    → ABRE
 *     F8 con el foco en el body        → nada   (solo onKeyDown en el div)
 *     F8 con el foco en el buscador    → ABRE
 *
 * Misma tecla, mismo dispatch: la diferencia es dónde estaba el oyente. Un
 * `onKeyDown` de React sobre un `<div>` sin `tabIndex` solo recibe lo que sube
 * desde un hijo con foco. Basta que el vendedor haga clic en un botón, en una
 * fila o en el aire para que el foco se vaya al `body` —que NO es hijo del
 * div— y a partir de ahí la tecla anunciada en pantalla no hace nada. La
 * pantalla sigue diciendo «F2 Cobrar», que es la peor forma de fallar: el
 * vendedor prueba, no pasa nada, y deja de creerle a la leyenda.
 *
 * LA OTRA REGLA, la que costó un dato de verdad. En Venta, `Delete` vivía en el
 * mismo manejador que las teclas F, y el buscador no detiene la propagación:
 * borrar un carácter mal escrito **borraba una línea de la venta** y encima se
 * comía el borrado del carácter. Por eso acá se separan dos familias:
 *
 *   - Las teclas F son COMANDOS de la pantalla. Da igual dónde esté el foco.
 *   - Las teclas de edición (flechas, Delete, Inicio, Fin…) son de quien tiene
 *     el foco. Si el foco está en un campo de texto, la pantalla no las toca.
 *
 * Nada de esto se puede probar con un test de unidad de forma convincente: el
 * defecto vive en dónde se registra el oyente, no en la lógica que ejecuta.
 */
import { useEffect, useRef } from "react";

/** `event.key` → qué hacer. Una tecla sin función se ignora. */
export type Manejadores = Record<string, (() => void) | undefined>;

/**
 * Teclas que le pertenecen a quien tiene el foco cuando está escribiendo.
 * No incluye Enter ni Escape a propósito: esos dos los maneja cada campo por
 * su cuenta y significan cosas distintas en cada contexto.
 */
const TECLAS_DE_EDICION = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Delete",
  "Backspace",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

function escribiendo(destino: EventTarget | null): boolean {
  if (!(destino instanceof HTMLElement)) return false;
  if (destino.isContentEditable) return true;
  const etiqueta = destino.tagName;
  return etiqueta === "INPUT" || etiqueta === "TEXTAREA" || etiqueta === "SELECT";
}

/**
 * Registra los atajos de una pantalla.
 *
 * @param manejadores  `{ F2: () => ..., ArrowDown: () => ... }`.
 * @param activo       `false` mientras hay un diálogo abierto: las teclas son
 *                     suyas. Se pasa desde afuera porque solo la pantalla sabe
 *                     cuándo es el caso.
 */
export function useAtajos(manejadores: Manejadores, activo = true): void {
  // Los manejadores se guardan en una ref para no volver a suscribirse en cada
  // render —y sobre todo para que nunca corra una versión vieja de la función,
  // que en esta aplicación significaría cobrar con un carrito de hace un rato.
  const ref = useRef(manejadores);
  useEffect(() => {
    ref.current = manejadores;
  });

  useEffect(() => {
    if (!activo) return;
    function alTeclado(e: KeyboardEvent) {
      // Con un modificador apretado la combinación es del navegador o del
      // sistema (Alt+F4 cierra la ventana): no se pisa.
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const fn = ref.current[e.key];
      if (!fn) return;
      if (TECLAS_DE_EDICION.has(e.key) && escribiendo(e.target)) return;
      e.preventDefault();
      fn();
    }
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [activo]);
}
