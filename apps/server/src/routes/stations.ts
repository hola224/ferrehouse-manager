/**
 * Estaciones (tarea 2.7). Solo el admin.
 *
 * Una estación es una caja física: tiene la ubicación de la que sale el stock
 * que vende y el destino al que manda sus impresiones. Existe como tabla desde
 * el día uno porque la sesión de caja cuelga de ella (ADR-004).
 *
 * Una estación NO SE BORRA: se desactiva. Sus sesiones de caja, sus ventas y
 * sus trabajos de impresión la referencian, y esas tablas son historia.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { audit } from "../audit.js";
import { requireRole } from "../roles.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });

const stationSchema = z.object({
  /**
   * `CAJA-<n>` en mayúsculas y sin espacios, como fijó `.agents/SEED.md`. El
   * nombre se imprime en el reporte de cierre y se dice en voz alta ("ciérrame
   * la CAJA-2"): que cada uno lo escriba a su manera hace ambiguo el reporte.
   */
  name: z
    .string()
    .trim()
    .transform((v) => v.toUpperCase().replace(/\s+/g, "-"))
    .pipe(
      z
        .string()
        .regex(/^[A-Z0-9-]{3,20}$/, "El nombre va como CAJA-1: mayúsculas, números y guiones")
        .refine((v) => !v.startsWith("-") && !v.endsWith("-"), "El nombre no puede empezar ni terminar con guion"),
    ),
  locationId: z.number().int().positive("Falta la ubicación"),
  /**
   * Hoy: el nombre del recurso compartido de Windows de la térmica USB del
   * servidor. Cuando llegue una impresora de red, `host:9100`. `null` = terminal
   * de consulta, que no imprime.
   */
  printerTarget: z.string().trim().max(120).nullable().optional(),
  active: z.boolean().default(true),
});

function malaPeticion(mensaje: string): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = 400;
  return e;
}

export async function registerStationRoutes(app: FastifyInstance): Promise<void> {
  const soloAdmin = { preHandler: requireRole("ADMIN") };

  app.get("/api/stations", soloAdmin, async () => ({
    estaciones: await db.station.findMany({
      orderBy: [{ active: "desc" }, { name: "asc" }],
      include: {
        location: { select: { id: true, name: true } },
        // Si tiene sesión abierta, la pantalla lo tiene que decir antes de
        // dejar tocar nada.
        sessions: { where: { openStationId: { not: null } }, select: { id: true, openedAt: true } },
      },
    }),
  }));

  app.post("/api/stations", soloAdmin, async (req, reply) => {
    const datos = stationSchema.parse(req.body);
    if (await db.station.findUnique({ where: { name: datos.name } })) {
      throw malaPeticion(`Ya existe una caja llamada ${datos.name}`);
    }
    if (!(await db.location.findUnique({ where: { id: datos.locationId } }))) {
      throw malaPeticion("Esa ubicación no existe");
    }
    const estacion = await db.station.create({ data: datos });
    await audit({ userId: req.user.sub, action: "STATION_CREATED", entity: "Station", entityId: estacion.id, payload: datos });
    return reply.code(201).send({ estacion });
  });

  app.patch("/api/stations/:id", soloAdmin, async (req) => {
    const { id } = idParam.parse(req.params);
    const datos = stationSchema.partial().parse(req.body);

    const actual = await db.station.findUnique({ where: { id } });
    if (!actual) throw malaPeticion("Esa caja no existe");

    /**
     * Con la caja abierta no se cambia ni la ubicación ni el destino de
     * impresión: la sesión en curso ya descontó stock de una ubicación y
     * mandó trabajos a una impresora. Cambiarlos a mitad de turno parte el
     * reporte de cierre en dos realidades.
     */
    const abierta = await db.cashSession.findUnique({ where: { openStationId: id } });
    if (abierta && (datos.locationId !== undefined || datos.printerTarget !== undefined)) {
      throw malaPeticion(
        `${actual.name} tiene una caja abierta. Ciérrala antes de cambiarle la ubicación o la impresora.`,
      );
    }
    if (abierta && datos.active === false) {
      throw malaPeticion(`${actual.name} tiene una caja abierta. Ciérrala antes de desactivar la estación.`);
    }

    const estacion = await db.station.update({ where: { id }, data: datos });
    await audit({ userId: req.user.sub, action: "STATION_UPDATED", entity: "Station", entityId: id, payload: datos });
    return { estacion };
  });
}
