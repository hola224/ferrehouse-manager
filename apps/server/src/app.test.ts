import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, requireRole } from "./app.js";
import { db } from "./db.js";
import { findForbiddenFields } from "@ferrehouse/shared";
import { PIN_ADMIN, PIN_VENDEDOR } from "./test-setup.js";

let app: FastifyInstance;
let idAdmin: number, idVendedor: number, idSystem: number, idInactivo: number;
let idCaja1: number, idCaja2: number;

beforeAll(async () => {
  app = await buildApp({ jwtSecret: "test-secret" });

  // Ruta de prueba que DEVUELVE costos a propósito: es la forma de comprobar
  // que el hook global los borra sin depender de que exista un endpoint real.
  app.get("/api/_prueba/costos", { preHandler: requireRole("ADMIN", "SELLER") }, async () => ({
    producto: { sku: "FH-00001", costNetMilliPeso: 3_500_000, nombre: "Cable" },
    venta: { items: [{ qtyMilli: 1000, lineCostNet: 8000, lineTotalGross: 12990 }] },
    movimiento: { totalCostNet: 50_000, balanceCostNetMilliPeso: 1_000_000 },
  }));
  await app.ready();

  idAdmin = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  idVendedor = (await db.user.findFirstOrThrow({ where: { role: "SELLER", active: true } })).id;
  idSystem = (await db.user.findFirstOrThrow({ where: { role: "SYSTEM" } })).id;
  idInactivo = (await db.user.findFirstOrThrow({ where: { active: false, role: "SELLER" } })).id;
  idCaja1 = (await db.station.findFirstOrThrow({ where: { name: "CAJA-1" } })).id;
  idCaja2 = (await db.station.findFirstOrThrow({ where: { name: "CAJA-2" } })).id;
});

const login = (userId: number, pin: string, stationId = idCaja1) =>
  app.inject({ method: "POST", url: "/api/auth/login", payload: { userId, pin, stationId } });

const token = async (userId: number, pin: string) => JSON.parse((await login(userId, pin)).body).token as string;

describe("salud", () => {
  it("responde", async () => {
    const r = await app.inject({ method: "GET", url: "/api/health" });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).ok).toBe(true);
  });
});

describe("login", () => {
  it("la lista de usuarios no incluye a SYSTEM ni a los inactivos", async () => {
    const r = await app.inject({ method: "GET", url: "/api/auth/users" });
    const nombres = JSON.parse(r.body).usuarios.map((u: { name: string }) => u.name);
    expect(nombres).toContain("Cristian");
    expect(nombres).toContain("Vendedor Mesón");
    expect(nombres).not.toContain("Sistema");
    expect(nombres).not.toContain("Ex empleado");
  });

  it("admin entra con su PIN", async () => {
    const r = await login(idAdmin, PIN_ADMIN);
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.token).toBeTruthy();
    expect(body.usuario.role).toBe("ADMIN");
    expect(body.usuario.stationId).toBe(idCaja1);
    expect(body.usuario.locationId).toBeGreaterThan(0);
  });

  it("vendedor entra con el suyo", async () => {
    expect((await login(idVendedor, PIN_VENDEDOR)).statusCode).toBe(200);
  });

  it("el PIN de uno no sirve para el otro", async () => {
    // Con login solo-por-PIN esto entraría y la auditoría culparía al equivocado.
    expect((await login(idAdmin, PIN_VENDEDOR)).statusCode).toBe(401);
  });

  it("PIN incorrecto: 401", async () => {
    expect((await login(idAdmin, "000000")).statusCode).toBe(401);
  });

  it("SYSTEM no entra nunca", async () => {
    expect((await login(idSystem, "112233")).statusCode).toBe(401);
    expect((await login(idSystem, "*sin-login*" as never)).statusCode).toBe(400);
  });

  it("usuario inactivo no entra", async () => {
    expect((await login(idInactivo, "999999")).statusCode).toBe(401);
  });

  it("estación inactiva: 400 y lo dice", async () => {
    const r = await login(idAdmin, PIN_ADMIN, idCaja2);
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toMatch(/caja/i);
  });

  it("un PIN que no son 4-6 dígitos se rechaza antes de tocar la base", async () => {
    expect((await login(idAdmin, "12")).statusCode).toBe(400);
    expect((await login(idAdmin, "abcdef")).statusCode).toBe(400);
  });

  it("el login queda en la bitácora", async () => {
    await login(idAdmin, PIN_ADMIN);
    expect(await db.auditLog.count({ where: { action: "LOGIN", userId: idAdmin } })).toBeGreaterThan(0);
    await login(idAdmin, "000000");
    expect(await db.auditLog.count({ where: { action: "LOGIN_FAILED" } })).toBeGreaterThan(0);
  });
});

describe("guard por rol", () => {
  it("sin token no se pasa", async () => {
    expect((await app.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
  });

  it("con token se pasa", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/me",
      headers: { authorization: `Bearer ${await token(idAdmin, PIN_ADMIN)}` },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).usuario.role).toBe("ADMIN");
  });

  it("cada rol ve un dashboard distinto", async () => {
    const pedir = async (t: string) =>
      JSON.parse((await app.inject({ method: "GET", url: "/api/dashboard", headers: { authorization: `Bearer ${t}` } })).body);
    const admin = await pedir(await token(idAdmin, PIN_ADMIN));
    const vendedor = await pedir(await token(idVendedor, PIN_VENDEDOR));
    expect(admin.rol).toBe("ADMIN");
    expect(admin.dia.total).toBeTypeOf("number");
    expect(admin.alertas.total).toBeTypeOf("number");
    expect(vendedor.rol).toBe("SELLER");

    /**
     * No basta con que venga en cero o en null: la clave NO EXISTE (decisión
     * sellada 17). Y no es solo el margen — tampoco la venta del día, porque
     * el arqueo es a ciegas y casi toda la venta del día es efectivo:
     * decirle cuánto se vendió es decirle cuánto debería tener el cajón.
     */
    for (const clave of ["dia", "margen", "alertas"]) {
      expect(Object.keys(vendedor)).not.toContain(clave);
    }
    expect(JSON.stringify(vendedor)).not.toContain("margen");
    expect(vendedor.misDocumentos).toBeTypeOf("number");
  });
});

describe("decisión sellada 17: los costos no salen del servidor", () => {
  it("al vendedor no le llega ningún campo de costo", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/_prueba/costos",
      headers: { authorization: `Bearer ${await token(idVendedor, PIN_VENDEDOR)}` },
    });
    expect(r.statusCode).toBe(200);
    // No basta con que la pantalla no lo pinte: no puede estar en el cuerpo.
    expect(findForbiddenFields(JSON.parse(r.body))).toEqual([]);
    expect(r.body).not.toContain("3500000");
    expect(r.body).not.toContain("lineCostNet");
  });

  it("al admin sí", async () => {
    const r = await app.inject({
      method: "GET",
      url: "/api/_prueba/costos",
      headers: { authorization: `Bearer ${await token(idAdmin, PIN_ADMIN)}` },
    });
    expect(JSON.parse(r.body).producto.costNetMilliPeso).toBe(3_500_000);
  });

  it("sin token se aplica el filtro más restrictivo, no el más laxo", async () => {
    const r = await app.inject({ method: "GET", url: "/api/health" });
    expect(findForbiddenFields(JSON.parse(r.body))).toEqual([]);
  });
});
