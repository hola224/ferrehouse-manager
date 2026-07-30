import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { db } from "./db.js";
import { audit } from "./audit.js";
import { loginSchema, verificarLogin, listarUsuariosParaLogin, type TokenPayload } from "./auth.js";
import { stripForRole, type Role } from "@ferrehouse/shared";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

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

export async function buildApp(opts: { jwtSecret?: string } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });
  await app.register(jwt, { secret: opts.jwtSecret ?? process.env.JWT_SECRET ?? "cambiar" });

  /**
   * Decisión sellada 17 / tarea 0.12. UN SOLO LUGAR decide qué campos salen.
   *
   * Va acá y no en cada ruta porque el modo de fallar de "lo filtro en cada
   * endpoint" es que alguien agregue el endpoint 30 y se olvide; el costo se va
   * en el JSON y se lee en la pestaña de red aunque la pantalla no lo pinte.
   *
   * Sin token se aplica el filtro MÁS restrictivo, no el más laxo.
   */
  app.addHook("preSerialization", async (req, _reply, payload) => {
    const role: Role = req.user?.role ?? "SELLER";
    return stripForRole(payload, role);
  });

  app.get("/api/health", async () => ({ ok: true, servicio: "ferrehouse-manager" }));

  // --- Login: elegir usuario, elegir estación, digitar PIN ---

  app.get("/api/auth/users", async () => ({ usuarios: await listarUsuariosParaLogin() }));

  app.get("/api/auth/stations", async () => ({
    estaciones: await db.station.findMany({
      where: { active: true },
      select: { id: true, name: true, locationId: true },
      orderBy: { name: "asc" },
    }),
  }));

  app.post("/api/auth/login", async (req, reply) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Datos incompletos", detalle: parsed.error.flatten().fieldErrors });
    }
    const r = await verificarLogin(parsed.data);
    if (!r.ok) {
      if (r.motivo === "ESTACION") return reply.code(400).send({ error: "Esa caja no existe o está inactiva" });
      await audit({
        userId: parsed.data.userId,
        action: "LOGIN_FAILED",
        entity: "User",
        entityId: parsed.data.userId,
      }).catch(() => {});
      // No se distingue "usuario inexistente" de "PIN incorrecto", y no se
      // bloquea la cuenta: está fuera de alcance (LAN privada, 2-3 terminales).
      return reply.code(401).send({ error: "PIN incorrecto" });
    }
    await audit({ userId: r.payload.sub, action: "LOGIN", entity: "User", entityId: r.payload.sub });
    return { token: app.jwt.sign(r.payload, { expiresIn: "12h" }), usuario: r.payload };
  });

  app.get("/api/me", { preHandler: requireRole("ADMIN", "SELLER") }, async (req) => ({ usuario: req.user }));

  // --- Dashboard: lo que ve cada rol ---

  app.get("/api/dashboard", { preHandler: requireRole("ADMIN", "SELLER") }, async (req) => {
    const comun = {
      tienda: (await db.setting.findUnique({ where: { key: "store.name" } }))?.value ?? "Ferrehouse",
      estacion: (await db.station.findUnique({ where: { id: req.user.stationId } }))?.name ?? "?",
      productos: await db.product.count({ where: { deletedAt: null } }),
    };
    if (req.user.role !== "ADMIN") return { rol: "SELLER", ...comun };
    return {
      rol: "ADMIN",
      ...comun,
      usuarios: await db.user.count({ where: { active: true } }),
      unidades: await db.unit.count(),
      alertas: await db.alert.count({ where: { resolvedAt: null } }),
    };
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    const code = error.statusCode ?? 500;
    // Los 500 se registran completos; al cliente solo se le dice que falló.
    if (code >= 500) console.error(error);
    reply.code(code).send({ error: code >= 500 ? "Error interno" : error.message });
  });

  return app;
}
