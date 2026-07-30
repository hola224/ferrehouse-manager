/**
 * Guardia de rol. Vive en su propio archivo, y no dentro de `app.ts`, porque
 * los módulos de rutas la necesitan: si la importaran desde `app.ts`, que a su
 * vez los importa a ellos, quedaría un ciclo.
 */
import type { FastifyRequest } from "fastify";
import type { Role } from "@ferrehouse/shared";

export function requireRole(...roles: Role[]) {
  return async (req: FastifyRequest) => {
    await req.jwtVerify();
    if (!roles.includes(req.user.role)) {
      const err = new Error("No autorizado para esta operación") as Error & { statusCode?: number };
      err.statusCode = 403;
      throw err;
    }
  };
}
