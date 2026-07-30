/**
 * Autenticación (tarea 0.5).
 *
 * Se ELIGE el usuario de una lista y después se digita el PIN. Entrar solo con
 * PIN parece más rápido, pero con dos vendedores atribuye la auditoría al
 * primero que calce con ese número — y la auditoría es justamente para saber
 * quién hizo qué.
 *
 * La estación se elige al iniciar sesión y viaja en el token: de ahí sale a qué
 * caja pertenece la sesión y a qué impresora va el ticket.
 */
import { z } from "zod";
import { verify } from "@node-rs/argon2";
import { db } from "./db.js";
import type { Role } from "@ferrehouse/shared";

export const pinSchema = z
  .string()
  .regex(/^\d{4,6}$/, "El PIN son 4 a 6 dígitos");

export const loginSchema = z.object({
  userId: z.number().int().positive(),
  pin: pinSchema,
  stationId: z.number().int().positive(),
});

export type TokenPayload = {
  sub: number;
  name: string;
  role: Role;
  stationId: number;
  locationId: number;
};

export type LoginResult =
  | { ok: true; payload: TokenPayload }
  | { ok: false; motivo: "CREDENCIALES" | "ESTACION" };

export async function verificarLogin(input: z.infer<typeof loginSchema>): Promise<LoginResult> {
  const user = await db.user.findUnique({ where: { id: input.userId } });

  // SYSTEM se rechaza ANTES de comparar el hash: es el autor de lo que hacen
  // los jobs, no una cuenta con la que alguien entra.
  if (!user || !user.active || user.role === "SYSTEM") return { ok: false, motivo: "CREDENCIALES" };

  let coincide = false;
  try {
    coincide = await verify(user.pinHash, input.pin);
  } catch {
    coincide = false; // hash imposible (SYSTEM) o corrupto
  }
  if (!coincide) return { ok: false, motivo: "CREDENCIALES" };

  const station = await db.station.findUnique({ where: { id: input.stationId } });
  if (!station || !station.active) return { ok: false, motivo: "ESTACION" };

  return {
    ok: true,
    payload: {
      sub: user.id,
      name: user.name,
      role: user.role as Role,
      stationId: station.id,
      locationId: station.locationId,
    },
  };
}

/** Usuarios que se muestran en la pantalla de login. Nunca incluye SYSTEM. */
export async function listarUsuariosParaLogin() {
  return db.user.findMany({
    where: { active: true, role: { in: ["ADMIN", "SELLER"] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
}
