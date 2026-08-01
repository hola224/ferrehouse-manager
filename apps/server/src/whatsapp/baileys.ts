/**
 * El adaptador de WhatsApp — la última pieza del Sprint 6.
 *
 * Todo lo que está ARRIBA de `TransporteWhatsApp` ya existía y estaba probado:
 * la captura del cliente, la cola con reintentos, la baja, el panel. Esto es lo
 * único que necesita un número de verdad y a alguien escaneando un QR, y por
 * eso fue lo último.
 *
 * POR QUÉ BAILEYS Y NO whatsapp-web.js, que es lo que decía el plan: el segundo
 * arrastra Puppeteer con su propio Chromium —unos 400 MB de descarga y un
 * navegador headless corriendo siempre— y este PC es el mesón de una ferretería
 * con internet malo y actualizaciones a mano. Baileys habla el protocolo por
 * WebSocket: sin navegador, decenas de megas, y arranca en segundos.
 *
 * LO QUE HAY QUE SABER ANTES DE VINCULAR UN NÚMERO: ninguna de las dos es
 * oficial. Las dos imitan a WhatsApp Web, y WhatsApp puede bloquear el número
 * que las use. Por eso el panel insiste en que sea un número DEDICADO y no el
 * personal de nadie.
 */
import { mkdirSync } from "node:fs";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  Browsers,
  type WASocket,
} from "@whiskeysockets/baileys";
import qrcodeTerminal from "qrcode-terminal";
import type { EstadoSesion } from "@ferrehouse/shared";
import { normalizarTelefono } from "@ferrehouse/shared";
import { procesarMensajeEntrante } from "./entrante.js";
import { setTransporte, type ResultadoEnvio, type TransporteWhatsApp } from "./transporte.js";

/**
 * Las credenciales de la sesión, para no re-escanear el QR en cada reinicio —
 * y el servicio se reinicia solo, así que sin esto habría que escanear después
 * de cada corte de luz.
 *
 * Va fuera de `src` y con punto adelante: no es código, no se compila, y no
 * tiene que viajar en el ZIP de una actualización. El instalador la excluye de
 * la copia por el mismo motivo que excluye la base de datos — es lo único
 * irreemplazable que hay acá.
 */
const CARPETA_SESION = fileURLToPath(new URL("../../.wa-sesion", import.meta.url));

/** Estado observable, que es exactamente lo que el panel muestra. */
let estado: EstadoSesion = "DESCONECTADA";
let qrDibujado: string | null = null;
/** El mismo QR sin dibujar, para que el servidor lo entregue como imagen. */
let qrCrudo: string | null = null;
let desde: Date | null = null;
let socket: WASocket | null = null;
let cerrandoAdrede = false;
let reintento: NodeJS.Timeout | null = null;

function mover(nuevo: EstadoSesion, qr: string | null = null, crudo: string | null = null) {
  if (estado !== nuevo) desde = new Date();
  estado = nuevo;
  qrDibujado = qr;
  qrCrudo = crudo;
}

/**
 * El evento `qr` NO entrega un dibujo: entrega el payload crudo (`2@aBcD…`).
 * Guardarlo tal cual deja al administrador mirando una línea de basura que
 * ningún teléfono escanea — el panel lo pinta dentro de un `<pre>`, y lo que
 * tiene que recibir es el QR ya dibujado con caracteres.
 */
function dibujar(payload: string): Promise<string> {
  return new Promise((resolver) => {
    qrcodeTerminal.generate(payload, { small: true }, (dibujo: string) => resolver(dibujo));
  });
}

/**
 * Traduce una falla de Baileys a algo que el administrador pueda leer y actuar.
 *
 * `e.message` NO sirve: ese string se muestra tal cual en el panel, y
 * "TypeError: Cannot read properties of undefined (reading 'sendMessage')" no
 * le dice a nadie qué hacer (principio 5 del brief). El detalle técnico va a
 * `console.error`; acá va la frase.
 */
function enPalabras(codigo: number | undefined): string {
  switch (codigo) {
    case DisconnectReason.loggedOut:
      return "Se cerró la sesión desde el teléfono. Hay que volver a escanear el QR.";
    case DisconnectReason.connectionReplaced:
      return "Otro dispositivo tomó la sesión. Vincula de nuevo desde acá.";
    case DisconnectReason.badSession:
      return "La sesión guardada quedó inservible. Hay que volver a escanear el QR.";
    case DisconnectReason.multideviceMismatch:
      return "El teléfono pide volver a vincular el dispositivo.";
    case DisconnectReason.forbidden:
      return "WhatsApp bloqueó este número.";
    default:
      return "Se perdió la conexión con WhatsApp. Se reintenta solo.";
  }
}

/**
 * Baileys trae su propio registro y escribe una línea JSON por cada cosa que
 * pasa en el protocolo — incluida la carga útil de cada mensaje.
 *
 * Se silencia por dos razones y la segunda es la que manda: `servidor.log` rota
 * a los 10 MB y este ruido se come el espacio donde tendrían que estar los
 * errores del sistema; y ese registro incluye el TEXTO de los mensajes, o sea
 * que dejaría conversaciones de clientes escritas en un archivo del PC del
 * mesón. Lo que importa —conectada, caída, el motivo— ya lo escribe este
 * archivo, en español y en una línea.
 */
const silencioso = {
  level: "silent",
  fatal: () => {},
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  trace: () => {},
  child: () => silencioso,
};

async function conectar(): Promise<void> {
  const { state, saveCreds } = await useMultiFileAuthState(CARPETA_SESION);

  socket = makeWASocket({
    auth: state,
    logger: silencioso as never,
    // El nombre que el dueño va a ver en «Dispositivos vinculados» del teléfono.
    browser: Browsers.appropriate("Ferrehouse Manager"),
    // El QR lo dibuja y lo guarda este archivo; que Baileys lo escupa además a
    // la consola solo ensucia `servidor.log`, donde nadie lo va a escanear.
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  socket.ev.on("creds.update", saveCreds);

  socket.ev.on("connection.update", (u) => {
    void (async () => {
      if (u.qr) mover("ESPERANDO_QR", await dibujar(u.qr), u.qr);
      if (u.connection === "open") {
        mover("CONECTADA");
        console.log("[whatsapp] sesión abierta");
      }
      if (u.connection !== "close") return;

      const codigo = (u.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      console.error(`[whatsapp] conexión cerrada (${codigo ?? "sin código"}): ${enPalabras(codigo)}`);

      if (cerrandoAdrede) return;

      /**
       * `loggedOut` es el único que NO se reintenta: las credenciales dejaron
       * de servir, y reconectar con ellas es un lazo infinito contra el
       * servidor de WhatsApp. Se borran y se vuelve al principio, o sea a un
       * QR nuevo — que es lo que el panel va a mostrar.
       */
      if (codigo === DisconnectReason.loggedOut) {
        await rm(CARPETA_SESION, { recursive: true, force: true }).catch(() => {});
        mover("DESCONECTADA");
        return;
      }

      mover("CAIDA");
      // 5 segundos: la caída típica es el wifi de la tienda, que vuelve solo.
      reintento = setTimeout(() => void conectar().catch(() => mover("CAIDA")), 5_000);
      reintento.unref?.();
    })();
  });

  /**
   * Los entrantes. La única línea que faltaba: la lógica de la baja vive en
   * `entrante.ts`, escrita y probada desde antes que este archivo existiera.
   */
  socket.ev.on("messages.upsert", ({ messages }) => {
    for (const m of messages) {
      if (m.key.fromMe || !m.key.remoteJid) continue;
      const texto = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? "";
      if (!texto) continue;
      void procesarMensajeEntrante(m.key.remoteJid, texto).catch((e) =>
        console.error("[whatsapp] no se pudo procesar un entrante:", e),
      );
    }
  });
}

export const transporteBaileys: TransporteWhatsApp = {
  estado: () => estado,
  qr: () => qrDibujado,
  qrPayload: () => qrCrudo,
  desde: () => desde,

  async enviar(e164: string, mensaje: string): Promise<ResultadoEnvio> {
    if (!socket || estado !== "CONECTADA") {
      return { ok: false, error: "No hay sesión de WhatsApp conectada.", permanente: false };
    }

    const tel = normalizarTelefono(e164);
    if (!tel.ok) {
      return { ok: false, error: "Ese número no tiene un formato válido.", permanente: true };
    }
    const numero = tel.e164.replace(/\D/g, "");

    try {
      /**
       * SE RESUELVE EL JID, no se arma. Pegarle `@s.whatsapp.net` al número
       * funciona hasta que no: WhatsApp tiene números con identificador
       * distinto del teléfono, y `onWhatsApp` es la consulta que existe
       * justamente para eso. De paso contesta la otra pregunta —si ese número
       * tiene WhatsApp— antes de intentar el envío.
       */
      const encontrado = (await socket.onWhatsApp(numero))?.[0];
      if (!encontrado?.exists) {
        return { ok: false, error: "Ese número no tiene WhatsApp.", permanente: true };
      }

      const r = await socket.sendMessage(encontrado.jid, { text: mensaje });
      return { ok: true, idExterno: r?.key?.id ?? undefined };
    } catch (e) {
      console.error("[whatsapp] falló el envío:", e);
      return { ok: false, error: "La sesión se cayó a mitad del envío.", permanente: false };
    }
  },
};

/**
 * Lo llama `main.ts`. **Nunca los tests**: abrir una sesión de verdad manda
 * mensajes de verdad a teléfonos de verdad, y una suite que hace eso es una
 * suite que le escribe a los clientes de la tienda.
 */
export function iniciarWhatsApp(): void {
  mkdirSync(CARPETA_SESION, { recursive: true });
  setTransporte(transporteBaileys);
  void conectar().catch((e) => {
    console.error("[whatsapp] no se pudo iniciar:", e);
    mover("CAIDA");
  });
}

export async function detenerWhatsApp(): Promise<void> {
  cerrandoAdrede = true;
  if (reintento) clearTimeout(reintento);
  try {
    socket?.end(undefined);
  } catch {
    // Cerrar un socket ya cerrado no es un problema que reportar.
  }
  socket = null;
}
