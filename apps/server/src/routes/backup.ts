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
import { z } from "zod";
import { join } from "node:path";
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { audit } from "../audit.js";
import { requireRole } from "../roles.js";
import { fechaDeRespaldo } from "@ferrehouse/shared";
import { carpetaDeRespaldos, estadoDeRespaldo, respaldar } from "../backup.js";
import { readdirSync } from "node:fs";
import { esRespaldo } from "@ferrehouse/shared";
import { getSetting, setSetting } from "../settings.js";

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

function malaPeticion(mensaje: string): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = 400;
  return e;
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

  /**
   * Dónde se copia el respaldo (tarea 7.2).
   *
   * **Existe porque sin esto la copia externa no se configura nunca.** El valor
   * vive en `Setting` y hasta acá solo se podía cambiar editando la base a mano,
   * o sea que en la práctica el respaldo se iba a quedar para siempre en el
   * mismo disco que la base — protegiendo del "borré algo sin querer" y de nada
   * más. Una función que nadie puede activar es una función que no está.
   *
   * **Se valida escribiendo, no mirando.** Que la carpeta exista no dice nada:
   * un pendrive protegido contra escritura, una carpeta de red sin permiso o
   * una unidad que Windows ya no monta se ven igual de bien desde afuera. Se
   * crea la carpeta, se escribe un archivo de prueba y se borra; si eso falla,
   * la configuración se rechaza en el acto en vez de fallar dentro de doce
   * horas, de noche, sin nadie mirando.
   */
  app.put("/api/backup/copia", soloAdmin, async (req) => {
    const { carpeta } = z
      .object({ carpeta: z.string().trim().max(400) })
      .parse(req.body ?? {});

    if (carpeta !== "") {
      const prueba = join(carpeta, ".ferrehouse-prueba");
      try {
        mkdirSync(carpeta, { recursive: true });
        writeFileSync(prueba, "prueba de escritura");
        rmSync(prueba, { force: true });
      } catch (e) {
        console.error("[respaldo] carpeta de copia inservible:", carpeta, e);
        throw malaPeticion(
          `No se puede escribir en ${carpeta}. Revisa que el pendrive esté conectado y que sea esa la letra.`,
        );
      }
    }

    const antes = await getSetting("backup.copyTo");
    await setSetting("backup.copyTo", carpeta);
    await audit({
      userId: req.user.sub,
      action: "BACKUP_COPY_SET",
      entity: "Setting",
      entityId: "backup.copyTo",
      payload: { antes, ahora: carpeta },
    });

    return {
      ok: true,
      carpeta,
      mensaje:
        carpeta === ""
          ? "Listo: el respaldo queda solo en este PC."
          : `Listo. El próximo respaldo se va a copiar a ${carpeta}. Conviene respaldar ahora para dejar uno allá de una vez.`,
    };
  });
}
