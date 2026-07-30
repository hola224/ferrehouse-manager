import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { db } from "../db.js";
import { PIN_ADMIN, PIN_VENDEDOR } from "../test-setup.js";

let app: FastifyInstance;
let tokenAdmin: string, tokenVendedor: string;
let idAdmin: number, idVendedor: number, idSystem: number, idCaja: number;

beforeAll(async () => {
  app = await buildApp({ jwtSecret: "test-secret" });
  await app.ready();

  idAdmin = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  idVendedor = (await db.user.findFirstOrThrow({ where: { role: "SELLER", active: true } })).id;
  idSystem = (await db.user.findFirstOrThrow({ where: { role: "SYSTEM" } })).id;
  idCaja = (await db.station.findFirstOrThrow({ where: { name: "CAJA-1" } })).id;

  const entrar = async (userId: number, pin: string) =>
    JSON.parse(
      (await app.inject({ method: "POST", url: "/api/auth/login", payload: { userId, pin, stationId: idCaja } })).body,
    ).token as string;

  tokenAdmin = await entrar(idAdmin, PIN_ADMIN);
  tokenVendedor = await entrar(idVendedor, PIN_VENDEDOR);
});

const como = (t: string) => ({ authorization: `Bearer ${t}` });

describe("CRUD de usuarios (tarea 1.8)", () => {
  it("el admin agrega un vendedor nuevo, que es lo que esta tarea vino a resolver", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: como(tokenAdmin),
      payload: { name: "Vendedor Tarde", role: "SELLER", pin: "778899" },
    });
    expect(r.statusCode).toBe(201);
    expect(JSON.parse(r.body).usuario.name).toBe("Vendedor Tarde");

    // Y puede entrar de inmediato.
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { userId: JSON.parse(r.body).usuario.id, pin: "778899", stationId: idCaja },
    });
    expect(login.statusCode).toBe(200);
  });

  it("el PIN nunca sale del servidor, ni hacia el admin", async () => {
    const r = await app.inject({ method: "GET", url: "/api/users", headers: como(tokenAdmin) });
    expect(r.body).not.toContain("pinHash");
    expect(r.body).not.toContain("$argon2");
  });

  it("el PIN nuevo tampoco queda escrito en la bitácora", async () => {
    const idNuevo = (await db.user.findFirstOrThrow({ where: { name: "Vendedor Tarde" } })).id;
    await app.inject({ method: "POST", url: `/api/users/${idNuevo}/pin`, headers: como(tokenAdmin), payload: { pin: "123321" } });

    const entrada = await db.auditLog.findFirstOrThrow({
      where: { action: "PIN_CHANGED", entityId: String(idNuevo) },
      orderBy: { id: "desc" },
    });
    expect(entrada.payload ?? "").not.toContain("123321");
  });

  it("no se puede crear otro SYSTEM", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: como(tokenAdmin),
      payload: { name: "Otro sistema", role: "SYSTEM", pin: "111111" },
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("ADMIN o SELLER");
  });

  /**
   * `SYSTEM` firma lo que hacen los jobs. Desactivarlo dejaría al importador y
   * a las alertas sin quién firme sus escrituras en el libro.
   */
  it("a SYSTEM no se le toca nada", async () => {
    for (const url of [`/api/users/${idSystem}/deactivate`, `/api/users/${idSystem}/pin`]) {
      const r = await app.inject({ method: "POST", url, headers: como(tokenAdmin), payload: { pin: "000000" } });
      expect(r.statusCode, url).toBe(400);
      expect(JSON.parse(r.body).error).toContain("Sistema");
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: idSystem } })).active).toBe(false);
  });

  it("un usuario se desactiva, nunca se borra: su historial lo referencia", async () => {
    const idNuevo = (await db.user.findFirstOrThrow({ where: { name: "Vendedor Tarde" } })).id;
    const r = await app.inject({ method: "POST", url: `/api/users/${idNuevo}/deactivate`, headers: como(tokenAdmin) });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).mensaje).toContain("historial queda intacto");

    // Sigue existiendo, pero ya no aparece en la pantalla de login.
    expect(await db.user.findUnique({ where: { id: idNuevo } })).not.toBeNull();
    const login = JSON.parse((await app.inject({ method: "GET", url: "/api/auth/users" })).body);
    expect(login.usuarios.map((u: { id: number }) => u.id)).not.toContain(idNuevo);
  });

  /**
   * Quedarse sin admin activo no tiene vuelta atrás desde la aplicación:
   * nadie podría crear otro, y habría que editar la base a mano — justo lo
   * que esta tarea vino a evitar.
   */
  it("el último administrador no puede desactivarse ni degradarse", async () => {
    const otrosAdmin = await db.user.count({ where: { role: "ADMIN", active: true, id: { not: idAdmin } } });
    expect(otrosAdmin).toBe(0);

    const baja = await app.inject({ method: "POST", url: `/api/users/${idAdmin}/deactivate`, headers: como(tokenAdmin) });
    expect(baja.statusCode).toBe(400);

    const degradar = await app.inject({
      method: "PATCH",
      url: `/api/users/${idAdmin}`,
      headers: como(tokenAdmin),
      payload: { role: "SELLER" },
    });
    expect(degradar.statusCode).toBe(400);
    expect(JSON.parse(degradar.body).error).toContain("único administrador");
  });

  it("con un segundo admin activo, el primero ya puede degradarse", async () => {
    const segundo = JSON.parse(
      (await app.inject({
        method: "POST",
        url: "/api/users",
        headers: como(tokenAdmin),
        payload: { name: "Admin suplente", role: "ADMIN", pin: "246810" },
      })).body,
    ).usuario.id as number;

    const r = await app.inject({ method: "PATCH", url: `/api/users/${idAdmin}`, headers: como(tokenAdmin), payload: { role: "SELLER" } });
    expect(r.statusCode).toBe(200);

    // Se deja como estaba para no arrastrar el cambio a los tests siguientes.
    await db.user.update({ where: { id: idAdmin }, data: { role: "ADMIN" } });
    await db.user.update({ where: { id: segundo }, data: { active: false } });
  });

  it("nadie se desactiva a sí mismo estando dentro", async () => {
    const r = await app.inject({ method: "POST", url: `/api/users/${idAdmin}/deactivate`, headers: como(tokenAdmin) });
    expect(r.statusCode).toBe(400);
  });

  it("el vendedor no administra usuarios", async () => {
    expect((await app.inject({ method: "GET", url: "/api/users", headers: como(tokenVendedor) })).statusCode).toBe(403);
    expect(
      (await app.inject({
        method: "POST",
        url: "/api/users",
        headers: como(tokenVendedor),
        payload: { name: "Yo mismo admin", role: "ADMIN", pin: "999111" },
      })).statusCode,
    ).toBe(403);
  });

  it("el PIN de 3 dígitos se rechaza con el mensaje del esquema", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: como(tokenAdmin),
      payload: { name: "PIN corto", role: "SELLER", pin: "123" },
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("4 a 6 dígitos");
  });
});
