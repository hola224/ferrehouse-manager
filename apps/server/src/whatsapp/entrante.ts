/**
 * La baja pedida por el cliente (tarea 6.5) — WA-03, requisito legal.
 *
 * Esta función está escrita y probada aunque el adaptador no exista. Lo único
 * que falta cuando se escriba `whatsapp-web.js.ts` es una línea:
 *
 *     client.on("message", (m) => procesarMensajeEntrante(m.from, m.body));
 *
 * Está acá y no adentro del adaptador justamente por eso: si la lógica de la
 * baja viviera pegada al cliente de WhatsApp, no se podría probar sin abrir una
 * sesión, y lo que no se prueba es lo que falla el día que un cliente escribe
 * "BAJA" y le siguen llegando mensajes.
 */
import { db } from "../db.js";
import { audit } from "../audit.js";
import { esPalabraDeBaja, normalizarTelefono } from "@ferrehouse/shared";

export type ResultadoEntrante =
  | { accion: "BAJA"; customerId: number; cancelados: number }
  | { accion: "YA_ESTABA_DE_BAJA"; customerId: number }
  | { accion: "IGNORADO"; motivo: "NO_ES_BAJA" | "TELEFONO_INVALIDO" | "CLIENTE_DESCONOCIDO" };

/**
 * Procesa un mensaje entrante. Hoy solo mira si es una baja: **no** contesta,
 * no arma una conversación y no guarda el mensaje. Un WhatsApp que responde
 * automáticamente es un producto distinto, y meterlo "ya que estamos" es lo que
 * el plan prohíbe en su última sección.
 *
 * El `desde` llega como venga —whatsapp-web.js entrega un JID tipo
 * `56912345678@c.us`— y se normaliza igual que en la captura: si el teléfono
 * guardado y el que llega no colapsan al mismo string, la baja no encuentra a
 * quién dar de baja.
 */
export async function procesarMensajeEntrante(desde: string, texto: string): Promise<ResultadoEntrante> {
  if (!esPalabraDeBaja(texto)) return { accion: "IGNORADO", motivo: "NO_ES_BAJA" };

  // `56912345678@c.us` → los dígitos alcanzan; el normalizador bota el resto.
  const tel = normalizarTelefono(desde.split("@")[0] ?? desde);
  if (!tel.ok) return { accion: "IGNORADO", motivo: "TELEFONO_INVALIDO" };

  const cliente = await db.customer.findUnique({ where: { phone: tel.e164 } });
  if (!cliente) return { accion: "IGNORADO", motivo: "CLIENTE_DESCONOCIDO" };
  if (cliente.optOutAt) return { accion: "YA_ESTABA_DE_BAJA", customerId: cliente.id };

  return darDeBaja(cliente.id, "El cliente respondió pidiendo la baja.");
}

/**
 * Marca la baja y **cancela lo que ya estaba en la cola**.
 *
 * Las dos cosas juntas, o la baja no sirve: un mensaje agendado hace dos horas
 * saldría igual, y el cliente que acaba de pedir que no le escriban recibiría
 * un mensaje más justo después de pedirlo.
 *
 * La baja no se deshace desde ninguna pantalla. Volver a suscribir a alguien
 * requiere que lo pida él, y eso pasa por la captura del mesón con su checkbox.
 */
export async function darDeBaja(
  customerId: number,
  motivo: string,
  porUsuario?: number,
): Promise<{ accion: "BAJA"; customerId: number; cancelados: number }> {
  const ahora = new Date();

  const cancelados = await db.$transaction(async (tx) => {
    await tx.customer.update({ where: { id: customerId }, data: { optOutAt: ahora, whatsappConsent: false } });
    const r = await tx.whatsAppJob.updateMany({
      where: { customerId, status: "PENDING" },
      data: { status: "CANCELLED", lastError: motivo },
    });
    return r.count;
  });

  /**
   * El autor es SYSTEM cuando la baja la pidió el cliente por WhatsApp: no hubo
   * nadie sentado en el mesón. `AuditLog.userId` no admite nulo, y atribuírsela
   * al último que inició sesión sería falso.
   */
  const autor = porUsuario ?? (await db.user.findFirstOrThrow({ where: { role: "SYSTEM" }, select: { id: true } })).id;

  await audit({
    userId: autor,
    action: "WHATSAPP_OPT_OUT",
    entity: "Customer",
    entityId: customerId,
    payload: { motivo, mensajesCancelados: cancelados },
  });

  return { accion: "BAJA", customerId, cancelados };
}
