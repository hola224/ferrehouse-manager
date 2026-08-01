/**
 * El panel de WhatsApp (tareas 6.2, 6.4, 6.5 y 6.6).
 *
 * TODO ESTE ARCHIVO ES DE ADMINISTRADOR, sin una sola excepción. No es solo por
 * los datos de clientes: el QR de vinculación es una credencial —quien lo
 * escanea se lleva la sesión de la ferretería en su teléfono— y por eso además
 * está en la lista de campos que nunca salen hacia un token de vendedor
 * (decisión sellada 17).
 *
 * El panel existe por el riesgo declarado del sprint: whatsapp-web.js se rompe
 * cuando Meta cambia el DOM de WhatsApp Web. Una integración que falla en
 * silencio deja a la tienda creyendo que le escribe a sus clientes durante
 * semanas. Acá se ve el estado, la cola y el último error, en palabras.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import QRCode from "qrcode";
import { db } from "../db.js";
import { audit } from "../audit.js";
import { requireRole } from "../roles.js";
import { getSetting, setSetting } from "../settings.js";
import { transporte } from "../whatsapp/transporte.js";
import { procesarPendientes, reintentar, cancelar, resumenDeCola } from "../whatsapp/cola.js";
import { darDeBaja } from "../whatsapp/entrante.js";
import { haceCuanto } from "../alerts.js";
import { formatTelefono, renderPlantilla, variablesDesconocidas, VARIABLES_PLANTILLA } from "@ferrehouse/shared";

function malaPeticion(mensaje: string): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = 400;
  return e;
}

function horasDesde(d: Date | null): number {
  return d === null ? 0 : (Date.now() - d.getTime()) / 3_600_000;
}

const idJob = z.object({ id: z.string().uuid() });
const idCliente = z.object({ id: z.coerce.number().int().positive() });

export async function registerWhatsAppRoutes(app: FastifyInstance): Promise<void> {
  const soloAdmin = { preHandler: requireRole("ADMIN") };

  /** 6.6 — el panel entero en una sola llamada. */
  app.get("/api/whatsapp", soloAdmin, async () => {
    const t = transporte();
    const plantilla = await getSetting("whatsapp.template");

    const ultimos = await db.whatsAppJob.findMany({
      orderBy: { scheduledAt: "desc" },
      take: 20,
      include: { customer: { select: { name: true } } },
    });

    return {
      sesion: {
        estado: t.estado(),
        qr: t.qr(),
        desde: t.desde(),
        /**
         * "hace 2 horas" y no "31-07-2026, 5:38:45". Para decidir si esto es
         * urgente lo que importa es cuánto lleva así, no a qué hora empezó, y
         * el cálculo lo hace el servidor con la MISMA función que las alertas
         * — dos implementaciones de "hace cuánto" terminan discrepando.
         *
         * Bajo la hora se manda `null` y la pantalla no escribe nada:
         * `haceCuanto` cuenta horas enteras, así que una sesión recién
         * levantada diría "hace 0 horas", que se lee como un error del sistema.
         */
        hace: horasDesde(t.desde()) >= 1 ? haceCuanto(t.desde()!, new Date()) : null,
        /**
         * El paso que falta, dicho en la respuesta y no solo en un documento.
         * Mientras no exista el adaptador, el panel tiene que explicar por qué
         * no hay QR que escanear en vez de mostrar un cuadro vacío.
         */
        pendienteDeInstalacion: t.estado() === "DESCONECTADA" && t.qr() === null,
        /**
         * Que exista una imagen que pedir. La pantalla no recibe el QR acá: lo
         * pide aparte a `/api/whatsapp/qr.svg`, porque un SVG dentro del JSON
         * del panel se recargaría entero cada vez que cambia un contador de la
         * cola, y el QR parpadearía mientras alguien intenta escanearlo.
         */
        hayImagen: typeof t.qrPayload === "function" && t.qrPayload() !== null,
      },
      cola: await resumenDeCola(),
      plantilla,
      ejemplo: renderPlantilla(plantilla, { nombre: "Ana", total: "$12.500" }),
      variables: VARIABLES_PLANTILLA,
      maxIntentos: await getSetting("whatsapp.maxAttempts"),
      ultimos: ultimos.map((j) => ({
        id: j.id,
        saleId: j.saleId,
        cliente: j.customer.name,
        telefono: formatTelefono(j.phone),
        mensaje: j.message,
        estado: j.status,
        intentos: j.attempts,
        ultimoError: j.lastError,
        agendado: j.scheduledAt,
        enviado: j.sentAt,
      })),
    };
  });

  /** 6.4 — la plantilla, validada CONTRA LAS VARIABLES antes de guardarse. */
  /**
   * El QR como imagen, que es la forma en que de verdad se escanea.
   *
   * SOLO ADMIN, y hay que decir por qué: **este QR es una credencial**. Quien
   * lo escanee se lleva la sesión de WhatsApp de la ferretería — puede leer las
   * conversaciones y escribirle a los clientes en nombre de la tienda. Es la
   * misma razón por la que `qr` está en la lista de campos que nunca salen
   * hacia un vendedor (decisión 17).
   *
   * `no-store` por lo mismo: el QR rota cada veinte segundos y una copia
   * cacheada en el disco del terminal es una credencial olvidada ahí.
   */
  app.get("/api/whatsapp/qr.svg", soloAdmin, async (_req, reply) => {
    const t = transporte();
    const payload = typeof t.qrPayload === "function" ? t.qrPayload() : null;
    if (!payload) throw malaPeticion("No hay ningún QR que mostrar en este momento");

    const svg = await QRCode.toString(payload, {
      type: "svg",
      margin: 2,
      // `errorCorrectionLevel` alto: la pantalla del mesón está sucia y con
      // reflejos, y el teléfono escanea de lejos y en diagonal.
      errorCorrectionLevel: "H",
    });

    return reply
      .header("content-type", "image/svg+xml")
      .header("cache-control", "no-store")
      .send(svg);
  });

  app.put("/api/whatsapp/plantilla", soloAdmin, async (req) => {
    const { plantilla } = z
      .object({ plantilla: z.string().trim().min(1, "La plantilla no puede quedar vacía").max(800) })
      .parse(req.body);

    const malas = variablesDesconocidas(plantilla);
    if (malas.length > 0) {
      const validas = Object.keys(VARIABLES_PLANTILLA)
        .map((v) => `{${v}}`)
        .join(" y ");
      throw malaPeticion(
        `${malas.map((m) => `{${m}}`).join(", ")} no existe. Las variables disponibles son ${validas}.`,
      );
    }

    const antes = await getSetting("whatsapp.template");
    await setSetting("whatsapp.template", plantilla);
    await audit({
      userId: req.user.sub,
      action: "WHATSAPP_TEMPLATE_CHANGED",
      entity: "Setting",
      entityId: "whatsapp.template",
      payload: { antes, ahora: plantilla },
    });

    return { plantilla, ejemplo: renderPlantilla(plantilla, { nombre: "Ana", total: "$12.500" }) };
  });

  /**
   * Fuerza una pasada de la cola. El botón "reintentar ahora" del panel: sin
   * él, el administrador que acaba de arreglar el internet tiene que esperar
   * hasta 30 segundos sin saber si funcionó.
   */
  app.post("/api/whatsapp/pasada", soloAdmin, async () => {
    const r = await procesarPendientes();
    return {
      ...r,
      mensaje:
        r.estado !== "CONECTADA"
          ? "No hay sesión conectada: la cola quedó intacta, esperando."
          : `${r.enviados} enviados, ${r.reagendados} reagendados, ${r.fallidos} fallidos.`,
    };
  });

  app.post("/api/whatsapp/jobs/:id/reintentar", soloAdmin, async (req) => {
    const { id } = idJob.parse(req.params);
    const job = await db.whatsAppJob.findUnique({ where: { id }, include: { customer: true } });
    if (!job) throw malaPeticion("Ese mensaje ya no existe.");
    if (job.status === "SENT") throw malaPeticion("Ese mensaje ya salió: reintentarlo lo mandaría dos veces.");
    if (job.customer.optOutAt) throw malaPeticion("Ese cliente pidió la baja. No se le puede volver a escribir.");

    await reintentar(id);
    return { ok: true, mensaje: "Vuelve a la cola con los intentos en cero." };
  });

  app.post("/api/whatsapp/jobs/:id/cancelar", soloAdmin, async (req) => {
    const { id } = idJob.parse(req.params);
    const job = await db.whatsAppJob.findUnique({ where: { id }, select: { status: true } });
    if (!job) throw malaPeticion("Ese mensaje ya no existe.");
    if (job.status === "SENT") throw malaPeticion("Ese mensaje ya salió: cancelarlo no lo devuelve.");

    await cancelar(id, `Cancelado a mano por el administrador.`);
    return { ok: true, mensaje: "Cancelado. No se va a enviar." };
  });

  // --- 6.5: los clientes y su baja ---

  app.get("/api/whatsapp/clientes", soloAdmin, async (req) => {
    const q = z.object({ buscar: z.string().trim().optional() }).parse(req.query ?? {});
    const clientes = await db.customer.findMany({
      where: q.buscar
        ? { OR: [{ name: { contains: q.buscar } }, { phone: { contains: q.buscar.replace(/\D/g, "") } }] }
        : undefined,
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { _count: { select: { sales: true } } },
    });

    return {
      clientes: clientes.map((c) => ({
        id: c.id,
        nombre: c.name,
        telefono: formatTelefono(c.phone),
        consiente: c.whatsappConsent,
        desde: c.consentAt,
        baja: c.optOutAt,
        compras: c._count.sales,
      })),
    };
  });

  /**
   * La baja registrada a mano: el cliente la pidió por teléfono o en el mesón,
   * no por WhatsApp. Es la misma función que usa el mensaje entrante, así que
   * cancela igual lo que estaba en la cola.
   */
  app.post("/api/whatsapp/clientes/:id/baja", soloAdmin, async (req) => {
    const { id } = idCliente.parse(req.params);
    const { motivo } = z
      .object({ motivo: z.string().trim().max(200).optional() })
      .parse(req.body ?? {});

    const cliente = await db.customer.findUnique({ where: { id } });
    if (!cliente) throw malaPeticion("Ese cliente no existe.");
    if (cliente.optOutAt) return { ok: true, mensaje: "Ese cliente ya estaba dado de baja.", cancelados: 0 };

    const r = await darDeBaja(id, motivo?.trim() || "Baja registrada por el administrador.", req.user.sub);
    return {
      ok: true,
      cancelados: r.cancelados,
      mensaje:
        r.cancelados > 0
          ? `Dado de baja. Se cancelaron ${r.cancelados} mensajes que estaban en la cola.`
          : "Dado de baja. No se le va a escribir nunca más.",
    };
  });
}
