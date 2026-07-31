/**
 * Panel de alertas (tarea 5.5).
 *
 * Lo que se lista sale de `alertasVigentes`, que junta lo guardado con lo
 * derivado. Acá solo viven el HTTP y la resolución a mano.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { requireRole } from "../roles.js";
import { audit } from "../audit.js";
import { alertasVigentes } from "../alerts.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });

export async function registerAlertRoutes(app: FastifyInstance): Promise<void> {
  const soloAdmin = { preHandler: requireRole("ADMIN") };

  app.get("/api/alerts", soloAdmin, async (req) => {
    const alertas = await alertasVigentes(req.user.locationId);
    return {
      alertas,
      criticas: alertas.filter((a) => a.severity === "CRITICAL").length,
    };
  });

  /**
   * Resolver es un acto, no un borrado: la fila queda con `resolvedAt` y sale
   * del panel. Nunca se elimina, porque la historia de qué faltó y cuándo es
   * la mitad del valor de tener alertas.
   *
   * Una alerta derivada (la de venta en espera añeja) no llega acá: no tiene
   * id, y no se resuelve marcándola sino cobrando o descartando la espera.
   */
  app.post("/api/alerts/:id/resolve", soloAdmin, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const alerta = await db.alert.findUnique({ where: { id } });
    if (!alerta) return reply.code(404).send({ error: "Esa alerta no existe" });
    if (alerta.resolvedAt) return { alerta, yaEstaba: true };

    const resuelta = await db.alert.update({ where: { id }, data: { resolvedAt: new Date() } });
    await audit({
      userId: req.user.sub,
      action: "ALERT_RESOLVED",
      entity: "Alert",
      entityId: id,
      payload: { type: alerta.type, message: alerta.message },
    });
    return { alerta: resuelta, yaEstaba: false };
  });
}
