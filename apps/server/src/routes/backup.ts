/**
 * Respaldo, visto desde el panel (tarea 7.2).
 *
 * **No hay ruta de restauración, y es a propósito.** Restaurar sobrescribe el
 * archivo que SQLite tiene abierto: hacerlo desde el servidor que está
 * corriendo corrompe la base y la copia de una sola vez. La restauración es un
 * programa aparte (`pnpm db:restore`, o el acceso directo del escritorio) que
 * primero se asegura de que el servidor esté detenido. Un botón acá sería un
 * botón que no puede funcionar.
 */
import type { FastifyInstance } from "fastify";
import { join } from "node:path";
import { statSync } from "node:fs";
import { audit } from "../audit.js";
import { requireRole } from "../roles.js";
import { fechaDeRespaldo } from "@ferrehouse/shared";
import { carpetaDeRespaldos, estadoDeRespaldo, respaldar } from "../backup.js";
import { readdirSync } from "node:fs";
import { esRespaldo } from "@ferrehouse/shared";

function listar(dir: string): Array<{ archivo: string; fecha: Date; bytes: number }> {
  let nombres: string[];
  try {
    nombres = readdirSync(dir).filter(esRespaldo).sort().reverse();
  } catch {
    return [];
  }
  return nombres.slice(0, 30).map((n) => ({
    archivo: n,
    fecha: fechaDeRespaldo(n)!,
    bytes: (() => {
      try {
        return statSync(join(dir, n)).size;
      } catch {
        return 0;
      }
    })(),
  }));
}

export async function registerBackupRoutes(app: FastifyInstance): Promise<void> {
  const soloAdmin = { preHandler: requireRole("ADMIN") };

  app.get("/api/backup", soloAdmin, async () => {
    const estado = await estadoDeRespaldo();
    return { ...estado, respaldos: listar(estado.carpeta) };
  });

  /**
   * "Respaldar ahora": antes de actualizar, antes de irse el viernes, o cuando
   * el panel dice que el último es de anteayer y uno quiere ver si el problema
   * se arregló. Queda auditado porque es la única forma de saber después que
   * alguien lo pidió a mano.
   */
  app.post("/api/backup", soloAdmin, async (req) => {
    const r = await respaldar();
    await audit({
      userId: req.user.sub,
      action: "BACKUP_CREATED",
      entity: "Backup",
      entityId: r.archivo ?? "—",
      payload: { ok: r.ok, bytes: r.bytes, ms: r.ms, error: r.error, copia: r.copia.ok, borrados: r.borrados.length },
    });

    if (!r.ok) {
      const e = new Error(r.error ?? "No se pudo respaldar.") as Error & { statusCode: number };
      e.statusCode = 500;
      throw e;
    }

    return {
      ok: true,
      archivo: r.archivo?.split(/[\\/]/).pop() ?? null,
      bytes: r.bytes,
      ms: r.ms,
      mensaje: r.copia.ok
        ? `Respaldo listo y copiado a ${r.copia.destino}.`
        : `Respaldo listo en el PC. ${r.copia.problema ?? ""}`.trim(),
      borrados: r.borrados.length,
    };
  });
}
