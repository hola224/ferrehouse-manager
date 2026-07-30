import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { ZodError } from "zod";
import { db } from "./db.js";
import { audit } from "./audit.js";
import { loginSchema, verificarLogin, listarUsuariosParaLogin, type TokenPayload } from "./auth.js";
import { requireRole } from "./roles.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerImportRoutes } from "./routes/import.js";
import { registerLabelRoutes } from "./routes/labels.js";
import { stripForRole, type Role } from "@ferrehouse/shared";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: TokenPayload;
    user: TokenPayload;
  }
}

export { requireRole };

export async function buildApp(opts: { jwtSecret?: string } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  /**
   * EL ORDEN IMPORTA, y no es evidente: esto va ANTES de cualquier
   * `await app.register(...)`.
   *
   * Al esperar un `register`, Fastify cierra el contexto de arranque; un
   * `setErrorHandler` puesto después NO cubre las rutas ya montadas y ellas
   * siguen con el manejador por omisión. El síntoma es silencioso: la ruta
   * responde 400, así que un test que solo mira el código pasa — pero el
   * cuerpo dice `{"error":"Bad Request"}` en vez del mensaje que uno escribió,
   * y el vendedor lee "Bad Request" donde debía leer qué corregir. Así estuvo
   * todo el Sprint 0, hasta que un test miró el mensaje además del código.
   */
  app.setErrorHandler((error: Error & { statusCode?: number }, _req, reply) => {
    /**
     * Un error de Zod es un 400 con el mensaje que ya está escrito en español
     * dentro del esquema, no un 500. Sin esto, "El precio va en pesos enteros"
     * llegaría como "Error interno" y nadie sabría qué corregir —principio 5
     * del brief: los errores dicen qué hacer—.
     */
    if (error instanceof ZodError) {
      const primero = error.issues[0];
      const campo = primero?.path.join(".");
      return reply.code(400).send({
        error: primero?.message ?? "Datos inválidos",
        campo: campo || undefined,
        detalle: error.flatten().fieldErrors,
      });
    }

    const code = error.statusCode ?? 500;
    // Los 500 se registran completos; al cliente solo se le dice que falló.
    if (code >= 500) console.error(error);
    reply.code(code).send({ error: code >= 500 ? "Error interno" : error.message });
  });

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

  await registerCatalogRoutes(app);
  await registerUserRoutes(app);
  await registerImportRoutes(app);
  await registerLabelRoutes(app);

  return app;
}
