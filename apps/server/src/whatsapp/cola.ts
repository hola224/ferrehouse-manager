/**
 * La cola de WhatsApp (tarea 6.3) — decisión sellada 15.
 *
 * DOS REGLAS QUE NO SE NEGOCIAN:
 *
 * 1. **Encolar pasa DESPUÉS de que la venta esté escrita, y fuera de su
 *    transacción.** `WhatsAppJob.saleId` es único: si el insert viviera dentro
 *    de la transacción de la venta, un duplicado o un fallo de esta cola haría
 *    rollback de la venta entera. La plata ya cambió de manos; perderla porque
 *    no se pudo agendar un "gracias por tu compra" es exactamente lo que la
 *    decisión 15 prohíbe. Por eso `encolarMensajeDeVenta` **nunca lanza**.
 *
 * 2. **Sin sesión conectada, el worker no toca nada.** No marca intentos, no
 *    falla trabajos, no los mueve: se va. Si consumiera un intento por cada
 *    pasada, dos horas sin internet dejarían toda la cola en FALLIDO y los
 *    mensajes no saldrían nunca al volver la conexión — que es literalmente la
 *    demo de cierre del sprint. Un intento se gasta solo cuando hubo un envío
 *    de verdad que falló.
 */
import { db } from "../db.js";
import { getSetting } from "../settings.js";
import { transporte, type TransporteWhatsApp } from "./transporte.js";
import { esperaDeReintento, esperaEntreEnvios, formatCLP, renderPlantilla } from "@ferrehouse/shared";

export type MotivoNoEncolado =
  | "SIN_CLIENTE"
  | "SIN_CONSENTIMIENTO"
  | "DADO_DE_BAJA"
  | "YA_ENCOLADO"
  | "ERROR";

export type ResultadoEncolar = { encolado: true; jobId: string } | { encolado: false; motivo: MotivoNoEncolado };

/**
 * Agenda el mensaje post-venta. **No lanza jamás**: cualquier problema vuelve
 * como `{encolado:false}` y queda en el log del servidor. Quien llama ya cobró.
 */
export async function encolarMensajeDeVenta(saleId: number): Promise<ResultadoEncolar> {
  try {
    const venta = await db.sale.findUnique({
      where: { id: saleId },
      select: { id: true, totalGross: true, customerId: true, customer: true },
    });

    if (!venta?.customer) return { encolado: false, motivo: "SIN_CLIENTE" };

    /**
     * Las dos puertas de WA-01 y WA-03, juntas y del lado del servidor. El
     * consentimiento es un checkbox que la pantalla puede olvidar de mandar; la
     * baja es una obligación legal. Ninguna de las dos puede depender de que la
     * pantalla se acuerde.
     */
    if (venta.customer.optOutAt) return { encolado: false, motivo: "DADO_DE_BAJA" };
    if (!venta.customer.whatsappConsent) return { encolado: false, motivo: "SIN_CONSENTIMIENTO" };

    const yaHay = await db.whatsAppJob.findUnique({ where: { saleId }, select: { id: true } });
    if (yaHay) return { encolado: false, motivo: "YA_ENCOLADO" };

    const plantilla = await getSetting("whatsapp.template");
    const mensaje = renderPlantilla(plantilla, {
      nombre: venta.customer.name,
      total: formatCLP(venta.totalGross),
    });

    /**
     * El teléfono se copia del cliente al trabajo. No es redundancia: si mañana
     * el cliente corrige su número, el mensaje que ya salió tiene que seguir
     * diciendo a qué número se mandó. Lo mismo con el texto, que cambia cuando
     * el admin edita la plantilla.
     */
    const job = await db.whatsAppJob.create({
      data: { saleId, customerId: venta.customer.id, phone: venta.customer.phone, message: mensaje },
      select: { id: true },
    });

    return { encolado: true, jobId: job.id };
  } catch (e) {
    console.error(`[whatsapp] no se pudo encolar el mensaje de la venta ${saleId}:`, e);
    return { encolado: false, motivo: "ERROR" };
  }
}

// ============================================================
// El worker
// ============================================================

export type DepsCola = {
  ahora?: () => Date;
  aleatorio?: () => number;
  /** Inyectable para que los tests no esperen 15 segundos de verdad. */
  esperar?: (ms: number) => Promise<void>;
  transporte?: TransporteWhatsApp;
};

export type ResumenPasada = {
  estado: string;
  revisados: number;
  enviados: number;
  reagendados: number;
  fallidos: number;
  cancelados: number;
  /** Las esperas aplicadas entre envíos, en ms. El test las mira. */
  pausas: number[];
};

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Una pasada de la cola: manda hasta `limite` mensajes pendientes y vencidos.
 *
 * Uno a uno y con pausa al azar entre medio (`esperaEntreEnvios`). Vaciar 30
 * mensajes de un viaje es la firma de un bot, y el número bloqueado no lo
 * devuelve nadie.
 */
export async function procesarPendientes(deps: DepsCola = {}, limite = 10): Promise<ResumenPasada> {
  const ahora = deps.ahora?.() ?? new Date();
  const aleatorio = deps.aleatorio ?? Math.random;
  const esperar = deps.esperar ?? dormir;
  const t = deps.transporte ?? transporte();

  const resumen: ResumenPasada = {
    estado: t.estado(),
    revisados: 0,
    enviados: 0,
    reagendados: 0,
    fallidos: 0,
    cancelados: 0,
    pausas: [],
  };

  // Ver el bloque de arriba: sin sesión no se gastan intentos.
  if (t.estado() !== "CONECTADA") return resumen;

  const maxIntentos = await getSetting("whatsapp.maxAttempts");

  const pendientes = await db.whatsAppJob.findMany({
    where: { status: "PENDING", scheduledAt: { lte: ahora } },
    orderBy: { scheduledAt: "asc" },
    take: limite,
    include: { customer: { select: { optOutAt: true } } },
  });

  for (const [i, job] of pendientes.entries()) {
    resumen.revisados++;

    /**
     * Se vuelve a mirar la baja acá, no solo al encolar: entre que se agendó el
     * mensaje y que sale pueden pasar horas, y en el medio el cliente puede
     * haber respondido "BAJA". Escribirle igual porque "ya estaba en la cola"
     * es precisamente lo que la baja prohíbe.
     */
    if (job.customer.optOutAt) {
      await db.whatsAppJob.update({
        where: { id: job.id },
        data: { status: "CANCELLED", lastError: "El cliente se dio de baja antes de que saliera el mensaje." },
      });
      resumen.cancelados++;
      continue;
    }

    if (i > 0) {
      const pausa = esperaEntreEnvios(aleatorio);
      resumen.pausas.push(pausa);
      await esperar(pausa);
    }

    const r = await t.enviar(job.phone, job.message);
    const intentos = job.attempts + 1;

    if (r.ok) {
      await db.whatsAppJob.update({
        where: { id: job.id },
        data: { status: "SENT", attempts: intentos, sentAt: ahora, lastError: null },
      });
      resumen.enviados++;
      continue;
    }

    if (r.permanente || intentos >= maxIntentos) {
      await db.whatsAppJob.update({
        where: { id: job.id },
        data: { status: "FAILED", attempts: intentos, lastError: r.error },
      });
      resumen.fallidos++;
      continue;
    }

    await db.whatsAppJob.update({
      where: { id: job.id },
      data: {
        attempts: intentos,
        lastError: r.error,
        scheduledAt: new Date(ahora.getTime() + esperaDeReintento(intentos, aleatorio)),
      },
    });
    resumen.reagendados++;
  }

  return resumen;
}

/**
 * Devuelve un trabajo fallido a la cola (botón del panel 6.6).
 *
 * Los intentos vuelven a cero a propósito: si el administrador reintenta a mano
 * es porque arregló algo —volvió el internet, se re-vinculó el número— y
 * dejarle un solo intento haría que se cayera de nuevo al primer tropiezo.
 */
export async function reintentar(jobId: string): Promise<void> {
  await db.whatsAppJob.update({
    where: { id: jobId },
    data: { status: "PENDING", attempts: 0, lastError: null, scheduledAt: new Date() },
  });
}

export async function cancelar(jobId: string, motivo: string): Promise<void> {
  await db.whatsAppJob.update({ where: { id: jobId }, data: { status: "CANCELLED", lastError: motivo } });
}

/** Cuenta para el panel y para el dashboard. */
export async function resumenDeCola(): Promise<{
  pendientes: number;
  fallidos: number;
  enviadosHoy: number;
}> {
  const inicioDelDia = new Date();
  inicioDelDia.setHours(0, 0, 0, 0);
  const [pendientes, fallidos, enviadosHoy] = await Promise.all([
    db.whatsAppJob.count({ where: { status: "PENDING" } }),
    db.whatsAppJob.count({ where: { status: "FAILED" } }),
    db.whatsAppJob.count({ where: { status: "SENT", sentAt: { gte: inicioDelDia } } }),
  ]);
  return { pendientes, fallidos, enviadosHoy };
}

// ============================================================
// El lazo, que solo corre en el servidor de verdad
// ============================================================

let lazo: NodeJS.Timeout | null = null;

/**
 * Arranca el worker. Lo llama `main.ts`, **nunca los tests**: un temporizador
 * vivo en la suite hace que los tests se pisen entre ellos y que uno falle
 * cuando el que falla es otro.
 */
export function iniciarWorker(cadaMs = 30_000): void {
  if (lazo) return;
  lazo = setInterval(() => {
    procesarPendientes().catch((e) => console.error("[whatsapp] la pasada de la cola falló:", e));
  }, cadaMs);
  lazo.unref?.();
}

export function detenerWorker(): void {
  if (lazo) clearInterval(lazo);
  lazo = null;
}
