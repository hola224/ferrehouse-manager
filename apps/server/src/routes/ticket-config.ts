/**
 * El ticket configurable: nombre de la tienda, encabezado y despedida.
 *
 * Tres settings (`store.name`, `ticket.header`, `ticket.footer`) que el
 * administrador edita desde «Cajas y terminales» — la misma pantalla donde
 * configura la impresora, porque es la otra mitad de la misma pregunta: a
 * dónde sale el ticket y qué dice.
 *
 * Los textos se imprimen pasando por la misma tabla ASCII del ticket (tildes
 * transliteradas, lo raro sale como `?`), así que acá no se rechazan acentos:
 * se aceptan y el generador los aplana, igual que hace con el catálogo.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { audit } from "../audit.js";
import { getSetting, setSetting } from "../settings.js";
import { requireRole } from "../roles.js";

/**
 * Los límites son de papel, no de base de datos: 48 columnas es el papel más
 * ancho que existe (80 mm) — una línea más larga saldría cortada. Las líneas
 * son pocas porque el rollo se paga: un encabezado de diez renglones convierte
 * cada venta en un gasto.
 */
const lineas = (maximas: number, que: string) =>
  z
    .string()
    .max(maximas * 50, `${que} es demasiado largo`)
    .transform((v) => v.replace(/\r\n/g, "\n"))
    .refine((v) => v.split("\n").length <= maximas, `${que} lleva como mucho ${maximas} líneas`)
    .refine(
      (v) => v.split("\n").every((l) => l.trim().length <= 48),
      `${que}: ninguna línea puede pasar de 48 caracteres, que es el papel más ancho`,
    );

const configSchema = z.object({
  tienda: z.string().trim().min(1, "La tienda necesita un nombre").max(24, "El nombre sale en doble ancho: 24 como mucho"),
  encabezado: lineas(5, "El encabezado"),
  pie: lineas(4, "La despedida"),
});

export async function registerTicketConfigRoutes(app: FastifyInstance): Promise<void> {
  const soloAdmin = { preHandler: requireRole("ADMIN") };

  app.get("/api/ticket/config", soloAdmin, async () => ({
    tienda: await getSetting("store.name"),
    encabezado: await getSetting("ticket.header"),
    pie: await getSetting("ticket.footer"),
  }));

  app.put("/api/ticket/config", soloAdmin, async (req) => {
    const datos = configSchema.parse(req.body);

    const antes = {
      tienda: await getSetting("store.name"),
      encabezado: await getSetting("ticket.header"),
      pie: await getSetting("ticket.footer"),
    };
    await setSetting("store.name", datos.tienda);
    await setSetting("ticket.header", datos.encabezado);
    await setSetting("ticket.footer", datos.pie);
    await audit({
      userId: req.user.sub,
      action: "SETTING_CHANGED",
      entity: "Setting",
      entityId: "ticket",
      payload: { antes, ahora: datos },
    });

    return { ...datos, mensaje: "Guardado. Sale así desde el próximo ticket." };
  });
}
