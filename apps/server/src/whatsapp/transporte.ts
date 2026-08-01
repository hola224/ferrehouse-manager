/**
 * El puerto de WhatsApp (tarea 6.2, la mitad que se puede escribir sin teléfono).
 *
 * TODO EL SPRINT 6 SE APOYA EN ESTA INTERFAZ Y NADA MÁS. Arriba de ella: la
 * captura del cliente, la cola con reintentos, la baja, el panel — código real,
 * probado, que corre hoy. Debajo: un solo archivo por escribir,
 * `whatsapp-web.js.ts`, que es el único que necesita un número dedicado y a
 * alguien escaneando un QR.
 *
 * POR QUÉ EL ADAPTADOR NO ESTÁ ESCRITO. Instanciar el cliente de
 * whatsapp-web.js abre una sesión de verdad y manda mensajes a teléfonos de
 * verdad; y `pnpm add whatsapp-web.js` arrastra un Chromium de Puppeteer del
 * que no se puede ejercitar una línea sin esa sesión. Escribirlo a ciegas sería
 * escribir contra una API imaginada. La costura de abajo confina ese riesgo a
 * UN archivo.
 *
 * LO QUE EL ADAPTADOR TIENE QUE HACER CUANDO SE ESCRIBA:
 *
 * - **Resolver el JID, no armarlo.** whatsapp-web.js tiene `getNumberId(e164)`
 *   justamente porque pegar `@c.us` al número no siempre da el identificador
 *   correcto. Concatenar a mano funciona hasta que no.
 * - `LocalAuth` con la carpeta de sesión fuera del repo, para no re-escanear el
 *   QR en cada reinicio del servicio (7.1 lo reinicia solo).
 * - Emitir `qr` → `ESPERANDO_QR`; `ready` → `CONECTADA` y QR a `null`;
 *   `disconnected` / `auth_failure` → `CAIDA`.
 * - **Convertir el QR antes de guardarlo.** El evento `qr` no entrega un
 *   dibujo: entrega el payload crudo (`2@aBcD…`), y el panel lo pinta tal cual
 *   dentro de un `<pre>`. Guardar el payload deja al administrador mirando una
 *   línea de basura que ningún teléfono escanea. Por eso todos los ejemplos de
 *   la librería lo pasan por `qrcode-terminal` o equivalente: lo que `qr()`
 *   devuelve tiene que ser **el QR ya dibujado con caracteres**.
 * - En `message`, llamar a `procesarMensajeEntrante` de `entrante.ts` — que ya
 *   está escrito y probado.
 * - Distinguir el fallo permanente (el número no tiene WhatsApp) del transitorio
 *   (no hay internet): el primero no se reintenta nunca, el segundo sí.
 * - **`error` es texto para el administrador, no `e.message`.** Ese string se
 *   muestra tal cual en el panel, y "TypeError: Cannot read properties of
 *   undefined (reading 'sendMessage')" no le dice a nadie qué hacer (principio
 *   5 del brief). El detalle técnico va a `console.error`; al panel va "La
 *   sesión se cayó a mitad del envío" o "Ese número no tiene WhatsApp".
 */
import type { EstadoSesion } from "@ferrehouse/shared";

export type ResultadoEnvio =
  | { ok: true; idExterno?: string }
  | {
      ok: false;
      error: string;
      /**
       * `true` = no sirve reintentar (ese número no tiene WhatsApp). El trabajo
       * se marca FALLIDO de una vez, sin quemar los cinco intentos ni ocupar la
       * cola media hora con algo que nunca va a salir.
       */
      permanente: boolean;
    };

export interface TransporteWhatsApp {
  estado(): EstadoSesion;
  /**
   * El QR **ya dibujado con caracteres**, listo para pintar en un `<pre>`, o
   * `null`. No el payload crudo del evento `qr`: eso no lo escanea nadie.
   *
   * **Es una credencial de sesión**: quien lo escanea se lleva la sesión de la
   * ferretería. Por eso las rutas que lo entregan son de ADMIN y además `qr`
   * está en la lista de campos que nunca salen hacia un vendedor (decisión 17).
   */
  qr(): string | null;
  /**
   * El payload CRUDO del QR (`2@aBcD…`), para dibujarlo como imagen.
   *
   * Existe además del de caracteres porque los dos sirven para cosas
   * distintas: el de caracteres se lee en un log o en una consola, pero
   * depende de que la fuente tenga los medios bloques `▀▄█` y de que la altura
   * de línea calce al píxel. Si algo de eso falla, el dibujo se ve «casi bien»
   * y NO escanea — que es el peor resultado posible, porque nadie sospecha de
   * la fuente. Con el payload, el servidor entrega un SVG y el problema
   * desaparece.
   *
   * Opcional: un transporte que no lo tenga sigue cumpliendo la interfaz.
   */
  qrPayload?(): string | null;
  /** Desde cuándo está en el estado actual. Para el panel: "caída hace 2 h". */
  desde(): Date | null;
  enviar(e164: string, mensaje: string): Promise<ResultadoEnvio>;
}

/**
 * El transporte por defecto, y el único que existe hoy: no hay sesión.
 *
 * No es un stub de prueba ni un mock: es el estado real del sistema mientras
 * nadie haya vinculado un número. Se comporta como corresponde —dice que está
 * desconectado y se niega a enviar— y el mensaje de error es el que va a leer
 * el administrador en el panel, así que dice qué hacer.
 */
export const transporteSinVincular: TransporteWhatsApp = {
  estado: () => "DESCONECTADA",
  qr: () => null,
  desde: () => null,
  enviar: async () => ({
    ok: false,
    error: "No hay ningún número de WhatsApp vinculado.",
    permanente: false,
  }),
};

let actual: TransporteWhatsApp = transporteSinVincular;

export function transporte(): TransporteWhatsApp {
  return actual;
}

/**
 * Lo llama `main.ts` cuando exista el adaptador, y los tests para poner uno
 * falso. Que sea un registro y no un import directo es lo que permite que la
 * cola se pruebe entera sin abrir una sesión.
 */
export function setTransporte(t: TransporteWhatsApp): void {
  actual = t;
}

export function resetTransporte(): void {
  actual = transporteSinVincular;
}
