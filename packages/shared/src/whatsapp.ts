/**
 * WhatsApp: lo que se puede razonar sin red (tareas 6.3, 6.4 y 6.5).
 *
 * Acá vive lo puro —plantilla, palabras de baja, esperas de reintento— para
 * poder probarlo con tablas de casos. El envío de verdad vive detrás de un
 * puerto en el servidor (`whatsapp/transporte.ts`) y no aparece en este
 * archivo: `shared` lo importa el navegador, y ahí no hay sesión de WhatsApp.
 */

// ============================================================
// Estados
// ============================================================

/** Lo que muestra el panel 6.6. No es un campo de la base: lo dice el puerto. */
export const ESTADOS_SESION = ["DESCONECTADA", "ESPERANDO_QR", "CONECTADA", "CAIDA"] as const;
export type EstadoSesion = (typeof ESTADOS_SESION)[number];

export const ESTADO_SESION_TEXT: Record<EstadoSesion, string> = {
  DESCONECTADA: "Sin vincular",
  ESPERANDO_QR: "Esperando el escaneo",
  CONECTADA: "Conectada",
  CAIDA: "Se cayó la sesión",
};

/** Color + PALABRA, nunca solo color (UI-BRIEF: hay daltonismo en el mesón). */
export const ESTADO_SESION_TONE: Record<EstadoSesion, "ok" | "warn" | "error" | "neutral"> = {
  DESCONECTADA: "neutral",
  ESPERANDO_QR: "warn",
  CONECTADA: "ok",
  CAIDA: "error",
};

export const ESTADOS_JOB = ["PENDING", "SENT", "FAILED", "CANCELLED"] as const;
export type EstadoJob = (typeof ESTADOS_JOB)[number];

export const ESTADO_JOB_TEXT: Record<EstadoJob, string> = {
  PENDING: "En cola",
  SENT: "Enviado",
  FAILED: "Falló",
  CANCELLED: "Cancelado",
};

export const ESTADO_JOB_TONE: Record<EstadoJob, "ok" | "warn" | "error" | "neutral"> = {
  PENDING: "warn",
  SENT: "ok",
  FAILED: "error",
  CANCELLED: "neutral",
};

// ============================================================
// La plantilla (6.4)
// ============================================================

/**
 * Las únicas variables que existen. Se valida contra esta lista al GUARDAR,
 * no al enviar: un `{telefono}` mal escrito en la plantilla tiene que
 * rebotarle al administrador que la está editando, no salir tal cual en el
 * mensaje de un cliente tres horas después.
 */
export const VARIABLES_PLANTILLA = {
  nombre: "Nombre del cliente, si lo dio",
  total: "Total de la venta, ya formateado ($12.000)",
} as const;

export type VariablePlantilla = keyof typeof VARIABLES_PLANTILLA;

const LLAVE = /\{([a-zA-Z]+)\}/g;

/** Las variables que la plantilla usa y no existen. Vacío = plantilla válida. */
export function variablesDesconocidas(plantilla: string): string[] {
  const malas = new Set<string>();
  for (const m of plantilla.matchAll(LLAVE)) {
    const nombre = m[1]!;
    if (!(nombre in VARIABLES_PLANTILLA)) malas.add(nombre);
  }
  return [...malas];
}

/**
 * Rellena la plantilla.
 *
 * EL CASO QUE OBLIGA A LIMPIAR: el cliente puede dar el teléfono y no el
 * nombre —es lo normal cuando hay cola en el mesón—. Con la plantilla por
 * defecto, sustituir por vacío da "Hola , gracias por tu compra": una coma
 * suelta que se lee como descuido de la ferretería. Así que después de
 * sustituir se pegan los signos de puntuación a la palabra anterior y se
 * colapsan los espacios dobles.
 */
export function renderPlantilla(plantilla: string, vars: { nombre?: string | null; total: string }): string {
  const valores: Record<string, string> = {
    nombre: (vars.nombre ?? "").trim(),
    total: vars.total,
  };
  return plantilla
    .replace(LLAVE, (completo, nombre: string) => (nombre in valores ? valores[nombre]! : completo))
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// ============================================================
// La baja (6.5) — WA-03, requisito legal
// ============================================================

function normalizarTexto(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // fuera los acentos: "más" y "mas" son lo mismo
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Una palabra sola solo cuenta como baja si es TODO el mensaje. "baja" suelta
 * dentro de una frase es ambigua —"la baja calidad de los tornillos" no es una
 * baja— y dar de baja a quien reclamaba por un tornillo lo deja además sin
 * respuesta.
 */
const PALABRAS_EXACTAS = ["baja", "stop", "salir", "cancelar", "eliminar", "desuscribir", "unsubscribe"];

/**
 * Estas frases no son ambiguas en ningún contexto, así que valen aunque vengan
 * dentro de un mensaje más largo.
 */
const FRASES = [
  "dar de baja",
  "darme de baja",
  "me doy de baja",
  "no molestar",
  "no me escriban",
  "no me escriba",
  "no quiero mensajes",
  "no enviar mas mensajes",
  "borrar mis datos",
  "eliminar mis datos",
];

/**
 * ¿Este mensaje entrante es una baja?
 *
 * **Ante la duda, se da de baja.** El error de dar de baja a quien no lo pidió
 * cuesta un mensaje de agradecimiento que no llega; el de no darla cuesta
 * seguir escribiéndole a alguien que dijo que no, que es lo que la ley
 * sanciona. Los dos errores no valen lo mismo, así que el umbral no está al
 * medio.
 */
export function esPalabraDeBaja(mensaje: string): boolean {
  const t = normalizarTexto(mensaje);
  if (t === "") return false;
  if (PALABRAS_EXACTAS.includes(t)) return true;
  return FRASES.some((f) => t.includes(f));
}

// ============================================================
// Reintentos y ritmo (6.3)
// ============================================================

/** Un minuto, doblando, con techo de media hora. */
const BASE_MS = 60_000;
const TECHO_MS = 30 * 60_000;

/**
 * Cuánto esperar antes del intento número `intentos + 1`.
 *
 * `aleatorio` se inyecta —no se llama a `Math.random()` acá— para que el test
 * pueda fijar el jitter. Un test que tolera cualquier número no prueba nada.
 *
 * El jitter es ±20%: sin él, si se cae internet con 30 mensajes en cola, los
 * 30 se reintentan en el mismo milisegundo cuando vuelve, y esa ráfaga es
 * exactamente el patrón que hace que Meta mire el número.
 */
export function esperaDeReintento(intentos: number, aleatorio = Math.random): number {
  const base = Math.min(BASE_MS * 2 ** Math.max(0, intentos - 1), TECHO_MS);
  const factor = 0.8 + aleatorio() * 0.4;
  return Math.round(base * factor);
}

/**
 * La pausa ENTRE dos envíos seguidos: 4 a 15 segundos, al azar.
 *
 * No es cortesía ni backoff: es lo que distingue a una tienda de un bot. Una
 * cola vaciándose a un mensaje cada 200 ms es la firma que hace que Meta
 * bloquee el número, y con el número bloqueado no hay Sprint 6 que valga.
 */
export function esperaEntreEnvios(aleatorio = Math.random): number {
  return Math.round(4000 + aleatorio() * 11_000);
}
