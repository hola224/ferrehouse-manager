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
  donde: "catalogo" | "venta" | "caja";
};

export const ATAJOS: readonly Atajo[] = [
  // Catálogo (Sprint 1)
  { tecla: "F2", etiqueta: "F2", accion: "Producto nuevo", donde: "catalogo" },
  { tecla: "F4", etiqueta: "F4", accion: "Importar Excel", donde: "catalogo" },
  { tecla: "F6", etiqueta: "F6", accion: "Imprimir etiqueta", donde: "catalogo" },
  { tecla: "F8", etiqueta: "F8", accion: "Editar", donde: "catalogo" },

  // Venta (Sprint 3). Se listan desde ya para que nadie reasigne una tecla
  // creyendo que está libre.
  { tecla: "F2", etiqueta: "F2", accion: "Cobrar", donde: "venta" },
  { tecla: "F4", etiqueta: "F4", accion: "Descuento", donde: "venta" },
  { tecla: "F6", etiqueta: "F6", accion: "Dejar en espera", donde: "venta" },
  { tecla: "F8", etiqueta: "F8", accion: "Recuperar espera", donde: "venta" },
] as const;

/** Teclas que el navegador se queda: no se pueden asignar. */
export const TECLAS_DEL_NAVEGADOR = ["F1", "F3", "F5", "F10", "F11", "F12"] as const;

export function atajosDe(donde: Atajo["donde"]): Atajo[] {
  return ATAJOS.filter((a) => a.donde === donde);
}

/**
 * ¿Esta tecla la puede usar la aplicación? Lo usa un test para que nadie
 * agregue un atajo sobre una tecla que Chrome no suelta.
 */
export function teclaDisponible(tecla: string): boolean {
  return !(TECLAS_DEL_NAVEGADOR as readonly string[]).includes(tecla);
}
