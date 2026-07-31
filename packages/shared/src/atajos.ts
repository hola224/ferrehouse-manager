/**
 * Tabla canónica de atajos (tarea 3.11, decidida el 2026-07-30).
 *
 * Vive acá, en un solo lugar, porque el brief promete que los atajos están
 * **impresos en pantalla**: si cada pantalla escribe su propia leyenda, tarde
 * o temprano una dice F6 y la otra F7 para lo mismo, y el vendedor deja de
 * confiar en lo que lee.
 *
 * QUÉ TECLAS SE PUEDEN USAR, y por qué son solo estas cuatro: los terminales
 * corren **Chrome en modo normal** (pregunta abierta 4, respondida por
 * Cristian). En ese modo el navegador se queda con F3 (buscar), F5 (recargar)
 * y F11 (pantalla completa), y F10 le abre la barra de menú. Ninguna de esas
 * se puede cancelar de forma confiable desde la página, así que quedan fuera.
 *
 * Se decidió ahora y no en el Sprint 3 a propósito: cambiarle un atajo a un
 * vendedor que ya lo aprendió cuesta mucho más que elegir bien la primera vez.
 */

export type Atajo = {
  /** El `event.key` que hay que escuchar. */
  tecla: string;
  /** Lo que se imprime en pantalla. */
  etiqueta: string;
  /** Qué hace, en el mismo verbo que el botón (brief §2.10). */
  accion: string;
  /** En qué pantalla aplica. */
  donde: "catalogo" | "venta" | "caja" | "kardex";
  /**
   * La tecla está **reservada pero la acción todavía no existe**.
   *
   * Sigue en esta tabla para que nadie la reasigne creyéndola libre, pero
   * `atajosVisibles` la deja fuera: una pantalla que imprime «F6 dejar en
   * espera» y no hace nada al apretarla es peor que una sin leyenda. El
   * vendedor prueba, no pasa nada, y a partir de ahí no le cree a ninguna.
   */
  pendiente?: boolean;
};

export const ATAJOS: readonly Atajo[] = [
  // Catálogo (Sprint 1)
  { tecla: "F2", etiqueta: "F2", accion: "Producto nuevo", donde: "catalogo" },
  { tecla: "F4", etiqueta: "F4", accion: "Importar Excel", donde: "catalogo" },
  { tecla: "F6", etiqueta: "F6", accion: "Imprimir etiqueta", donde: "catalogo" },
  { tecla: "F8", etiqueta: "F8", accion: "Editar", donde: "catalogo" },

  // Caja (Sprint 2)
  { tecla: "F2", etiqueta: "F2", accion: "Cerrar caja", donde: "caja" },
  { tecla: "F4", etiqueta: "F4", accion: "Retiro", donde: "caja" },
  { tecla: "F6", etiqueta: "F6", accion: "Ingreso", donde: "caja" },

  // Venta (Sprint 3). Las cuatro construidas y andando desde el 2026-07-31.
  //
  // Hasta ese día tres de ellas estaban marcadas `pendiente`, porque la
  // pantalla las anunciaba sin hacer nada —y F8 además dejaba el teclado
  // muerto—. La marca se quitó en el mismo commit que las hizo funcionar:
  // anunciar una tecla muerta y esconder una que anda son el mismo error.
  { tecla: "F2", etiqueta: "F2", accion: "Cobrar", donde: "venta" },
  { tecla: "F4", etiqueta: "F4", accion: "Descuento", donde: "venta" },
  { tecla: "F6", etiqueta: "F6", accion: "Dejar en espera", donde: "venta" },
  { tecla: "F8", etiqueta: "F8", accion: "Recuperar espera", donde: "venta" },

  // Kardex (Sprint 4). F2 lleva a la caja de búsqueda: en esta pantalla no
  // hay nada que crear, y buscar otro producto es la acción que más se repite.
  // F4 y F6 son las dos correcciones, en el mismo orden que en Caja: la que
  // suma o resta primero, la excepcional después.
  { tecla: "F2", etiqueta: "F2", accion: "Buscar producto", donde: "kardex" },
  { tecla: "F4", etiqueta: "F4", accion: "Ajustar", donde: "kardex" },
  { tecla: "F6", etiqueta: "F6", accion: "Merma", donde: "kardex" },
] as const;

/** Teclas que el navegador se queda: no se pueden asignar. */
export const TECLAS_DEL_NAVEGADOR = ["F1", "F3", "F5", "F10", "F11", "F12"] as const;

/** Todos los de esa pantalla, incluidas las teclas reservadas sin construir. */
export function atajosDe(donde: Atajo["donde"]): Atajo[] {
  return ATAJOS.filter((a) => a.donde === donde);
}

/**
 * Los que se imprimen en pantalla: solo los que de verdad hacen algo.
 *
 * **Toda leyenda de atajos de la interfaz tiene que salir de acá.** El brief
 * promete que los atajos están impresos en pantalla, y esa promesa se rompe
 * igual de feo anunciando de menos que anunciando de más.
 */
export function atajosVisibles(donde: Atajo["donde"]): Atajo[] {
  return atajosDe(donde).filter((a) => !a.pendiente);
}

/**
 * ¿Esta tecla la puede usar la aplicación? Lo usa un test para que nadie
 * agregue un atajo sobre una tecla que Chrome no suelta.
 */
export function teclaDisponible(tecla: string): boolean {
  return !(TECLAS_DEL_NAVEGADOR as readonly string[]).includes(tecla);
}
