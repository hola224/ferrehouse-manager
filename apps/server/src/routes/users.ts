/**
 * Usuarios (tarea 1.8). Solo el admin.
 *
 * Un usuario NO SE BORRA NUNCA: se desactiva. Sus ventas, sus movimientos de
 * stock y su bitácora lo referencian, y esas tablas son inmutables — borrar la
 * fila dejaría el libro apuntando al vacío.
 *
 * `SYSTEM` no se toca desde acá bajo ninguna circunstancia: no se crea, no se
 * edita, no se desactiva y no se le cambia el PIN. Es el autor de lo que hacen
 * los jobs; si alguien lo desactivara, el importador y las alertas se quedarían
 * sin quién firme sus escrituras.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hash } from "@node-rs/argon2";
import { db } from "../db.js";
import { audit } from "../audit.js";
import { requireRole } from "../roles.js";
import { pinSchema } from "../auth.js";

const idParam = z.object({ id: z.coerce.number().int().positive() });

const userInputSchema = z.object({
  name: z.string().trim().min(2, "El nombre necesita al menos 2 caracteres").max(60),
  // SYSTEM no está en la lista a propósito: no se crea uno nuevo jamás.
  role: z.enum(["ADMIN", "SELLER"], { errorMap: () => ({ message: "El rol es ADMIN o SELLER" }) }),
  pin: pinSchema,
});

function malaPeticion(mensaje: string): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = 400;
  return e;
}

/** Trae el usuario y se niega si es SYSTEM o no existe. */
async function usuarioEditable(id: number) {
  const u = await db.user.findUnique({ where: { id } });
  if (!u) {
    const e = new Error("Ese usuario no existe") as Error & { statusCode: number };
    e.statusCode = 404;
    throw e;
  }
  if (u.role === "SYSTEM") {
    throw malaPeticion("El usuario Sistema no se edita: es quien firma lo que hacen los procesos automáticos");
  }
  return u;
}

export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  const soloAdmin = { preHandler: requireRole("ADMIN") };

  app.get("/api/users", soloAdmin, async () => ({
    // `pinHash` no sale nunca, ni siquiera hacia un admin.
    usuarios: await db.user.findMany({
      select: { id: true, name: true, role: true, active: true, createdAt: true },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
  }));

  app.post("/api/users", soloAdmin, async (req, reply) => {
    const datos = userInputSchema.parse(req.body);
    const creado = await db.user.create({
      data: { name: datos.name, role: datos.role, pinHash: await hash(datos.pin), active: true },
      select: { id: true, name: true, role: true, active: true, createdAt: true },
    });
    await audit({
      userId: req.user.sub,
      action: "USER_CREATED",
      entity: "User",
      entityId: creado.id,
      // El PIN no entra en la bitácora ni hasheado.
      payload: { name: creado.name, role: creado.role },
    });
    return reply.code(201).send({ usuario: creado });
  });

  app.patch("/api/users/:id", soloAdmin, async (req) => {
    const { id } = idParam.parse(req.params);
    const datos = userInputSchema.omit({ pin: true }).partial().parse(req.body);
    const actual = await usuarioEditable(id);

    // Degradarse a uno mismo deja la tienda sin admin si es el único. Se
    // comprueba contra los admin ACTIVOS, no contra todos.
    if (datos.role === "SELLER" && actual.role === "ADMIN") await exigirOtroAdmin(id);

    const usuario = await db.user.update({
      where: { id },
      data: datos,
      select: { id: true, name: true, role: true, active: true, createdAt: true },
    });
    await audit({ userId: req.user.sub, action: "USER_UPDATED", entity: "User", entityId: id, payload: datos });
    return { usuario };
  });

  app.post("/api/users/:id/pin", soloAdmin, async (req) => {
    const { id } = idParam.parse(req.params);
    const { pin } = z.object({ pin: pinSchema }).parse(req.body);
    await usuarioEditable(id);

    await db.user.update({ where: { id }, data: { pinHash: await hash(pin) } });
    // El PIN nuevo no se registra: la bitácora deja constancia de QUIÉN lo
    // cambió y CUÁNDO, que es lo que sirve para auditar. Guardar el valor
    // convertiría la bitácora en una lista de claves.
    await audit({ userId: req.user.sub, action: "PIN_CHANGED", entity: "User", entityId: id });
    return { ok: true, mensaje: "PIN cambiado" };
  });

  /**
   * Desactivar, nunca borrar. Un usuario inactivo desaparece de la pantalla de
   * login pero sigue siendo el autor de todo lo que hizo.
   */
  app.post("/api/users/:id/deactivate", soloAdmin, async (req) => {
    const { id } = idParam.parse(req.params);
    const actual = await usuarioEditable(id);
    if (id === req.user.sub) throw malaPeticion("No puedes desactivarte a ti mismo estando dentro del sistema");
    if (actual.role === "ADMIN") await exigirOtroAdmin(id);

    const usuario = await db.user.update({
      where: { id },
      data: { active: false },
      select: { id: true, name: true, role: true, active: true, createdAt: true },
    });
    await audit({ userId: req.user.sub, action: "USER_DEACTIVATED", entity: "User", entityId: id });
    return { usuario, mensaje: `${usuario.name} ya no puede entrar. Su historial queda intacto.` };
  });

  app.post("/api/users/:id/activate", soloAdmin, async (req) => {
    const { id } = idParam.parse(req.params);
    await usuarioEditable(id);
    const usuario = await db.user.update({
      where: { id },
      data: { active: true },
      select: { id: true, name: true, role: true, active: true, createdAt: true },
    });
    await audit({ userId: req.user.sub, action: "USER_UPDATED", entity: "User", entityId: id, payload: { active: true } });
    return { usuario };
  });
}

/**
 * Quedarse sin ningún admin activo es irreversible desde la aplicación: nadie
 * podría volver a crear uno, y habría que editar la base a mano — exactamente
 * lo que esta tarea vino a evitar.
 */
async function exigirOtroAdmin(exceptoId: number): Promise<void> {
  const otros = await db.user.count({ where: { role: "ADMIN", active: true, id: { not: exceptoId } } });
  if (otros === 0) {
    throw malaPeticion(
      "Es el único administrador activo. Crea o activa otro administrador antes de dejar la tienda sin ninguno.",
    );
  }
}
