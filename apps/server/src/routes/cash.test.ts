import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { db } from "../db.js";
import { PIN_ADMIN, PIN_VENDEDOR } from "../test-setup.js";

let app: FastifyInstance;
let tokenAdmin: string, tokenVendedor: string, tokenCaja2: string;
let idCaja1: number, idCaja2: number, idLocal: number;

beforeAll(async () => {
  app = await buildApp({ jwtSecret: "test-secret" });
  await app.ready();

  idLocal = (await db.location.findFirstOrThrow({ where: { isDefault: true } })).id;
  idCaja1 = (await db.station.findFirstOrThrow({ where: { name: "CAJA-1" } })).id;
  // El seed de test deja CAJA-2 inactiva; para probar dos cajas a la vez se activa.
  idCaja2 = (await db.station.update({ where: { name: "CAJA-2" }, data: { active: true, printerTarget: "\\\\SRV\\T2" } })).id;
  await db.station.update({ where: { id: idCaja1 }, data: { printerTarget: "\\\\SRV\\T1" } });

  const idAdmin = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  const idVendedor = (await db.user.findFirstOrThrow({ where: { role: "SELLER", active: true } })).id;
  const entrar = async (userId: number, pin: string, stationId: number) =>
    JSON.parse(
      (await app.inject({ method: "POST", url: "/api/auth/login", payload: { userId, pin, stationId } })).body,
    ).token as string;

  tokenAdmin = await entrar(idAdmin, PIN_ADMIN, idCaja1);
  tokenVendedor = await entrar(idVendedor, PIN_VENDEDOR, idCaja1);
  tokenCaja2 = await entrar(idVendedor, PIN_VENDEDOR, idCaja2);
});

const como = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (url: string, payload: unknown, t = tokenVendedor) =>
  app.inject({ method: "POST", url, headers: como(t), payload: payload as object });
const get = (url: string, t = tokenVendedor) => app.inject({ method: "GET", url, headers: como(t) });

/** Deja la caja de este token cerrada, pase lo que pase antes. */
async function cerrarSiEstaAbierta(t: string) {
  const r = await get("/api/cash/current", t);
  if (JSON.parse(r.body).abierta) {
    const esperado = JSON.parse((await get("/api/cash/expected", t)).body).esperado;
    await post("/api/cash/close", { countedAmount: esperado }, t);
  }
}

describe("apertura de caja (tarea 2.1)", () => {
  it("abre con un monto y deja el movimiento de apertura en el libro", async () => {
    const r = await post("/api/cash/open", { openingAmount: 50_000 });
    expect(r.statusCode).toBe(201);
    expect(JSON.parse(r.body).mensaje).toContain("$50.000");

    const actual = JSON.parse((await get("/api/cash/current")).body);
    expect(actual.abierta).toBe(true);
    expect(actual.saldo).toBe(50_000);
    expect(actual.movimientos).toHaveLength(1);
    expect(actual.movimientos[0].type).toBe("OPENING");
    expect(actual.movimientos[0].balanceBefore).toBe(0);
    expect(actual.movimientos[0].balanceAfter).toBe(50_000);
  });

  /**
   * El invariante que la base impone sola (ADR-004). El servidor NO pregunta
   * antes: preguntar deja una ventana entre el SELECT y el INSERT por la que
   * caben dos aperturas simultáneas desde dos terminales.
   */
  it("la segunda apertura en la misma caja se rechaza, y dice quién la abrió", async () => {
    const r = await post("/api/cash/open", { openingAmount: 10_000 });
    expect(r.statusCode).toBe(400);
    const error = JSON.parse(r.body).error as string;
    expect(error).toContain("ya está abierta");
    expect(error).toContain("Vendedor Mesón");
  });

  it("otra estación sí puede tener su propia caja abierta a la vez", async () => {
    const r = await post("/api/cash/open", { openingAmount: 30_000 }, tokenCaja2);
    expect(r.statusCode).toBe(201);
    // Y no se contaminan entre sí.
    expect(JSON.parse((await get("/api/cash/current", tokenCaja2)).body).saldo).toBe(30_000);
    expect(JSON.parse((await get("/api/cash/current")).body).saldo).toBe(50_000);
  });

  it("un monto con decimales se rechaza: el peso no los tiene", async () => {
    await cerrarSiEstaAbierta(tokenCaja2);
    const r = await post("/api/cash/open", { openingAmount: 1000.5 }, tokenCaja2);
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("pesos enteros");
  });
});

describe("retiros e ingresos (tareas 2.2 y 2.3)", () => {
  it("un retiro baja el saldo y guarda el antes y el después", async () => {
    const r = await post("/api/cash/movements", {
      type: "WITHDRAWAL",
      amount: 10_000,
      description: "Flete de la mañana",
    });
    expect(r.statusCode).toBe(201);
    const body = JSON.parse(r.body);
    expect(body.saldo).toBe(40_000);
    expect(body.movimiento.amount).toBe(-10_000); // el signo lo pone el servidor
    expect(body.movimiento.balanceBefore).toBe(50_000);
    expect(body.movimiento.balanceAfter).toBe(40_000);
    expect(body.mensaje).toContain("Quedan $40.000");
  });

  it("un ingreso lo sube", async () => {
    const body = JSON.parse(
      (await post("/api/cash/movements", { type: "DEPOSIT", amount: 5_000, description: "Vuelto que sobró" })).body,
    );
    expect(body.saldo).toBe(45_000);
    expect(body.movimiento.amount).toBe(5_000);
  });

  /** Un retiro sin motivo es indistinguible de plata que falta. */
  it("sin motivo no se registra", async () => {
    const r = await post("/api/cash/movements", { type: "WITHDRAWAL", amount: 1_000, description: "" });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("motivo");
  });

  it("no se puede retirar más de lo que hay, y el error dice cuánto hay", async () => {
    const r = await post("/api/cash/movements", {
      type: "WITHDRAWAL",
      amount: 999_000,
      description: "Intento imposible",
    });
    expect(r.statusCode).toBe(400);
    const error = JSON.parse(r.body).error as string;
    expect(error).toContain("$999.000");
    expect(error).toContain("$45.000");
  });

  it("todo movimiento queda en la bitácora con su motivo", async () => {
    const entrada = await db.auditLog.findFirstOrThrow({
      where: { action: "CASH_MOVEMENT" },
      orderBy: { id: "desc" },
    });
    expect(entrada.payload ?? "").toContain("Vuelto que sobró");
  });

  it("con la caja cerrada no se registra nada", async () => {
    const r = await post(
      "/api/cash/movements",
      { type: "DEPOSIT", amount: 100, description: "Devolución de vuelto" },
      tokenCaja2,
    );
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("cerrada");
  });

  /**
   * Gana el error de fondo, no el primero que encuentra la validación: con la
   * caja cerrada Y el motivo en blanco, lo que hay que decir es que la caja
   * está cerrada. Al revés, el vendedor escribe el motivo y recién entonces se
   * entera de lo que pasaba.
   */
  it("con la caja cerrada, ese es el error, aunque el motivo también falte", async () => {
    const r = await post("/api/cash/movements", { type: "DEPOSIT", amount: 100, description: "" }, tokenCaja2);
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("cerrada");
  });
});

describe("cierre con arqueo (tareas 2.4 y 2.6)", () => {
  it("el sistema dice lo esperado ANTES de que el vendedor cuente", async () => {
    const body = JSON.parse((await get("/api/cash/expected")).body);
    expect(body.esperado).toBe(45_000); // 50.000 − 10.000 + 5.000
  });

  it("cerrando con lo justo, la caja cuadra y no genera alerta", async () => {
    const r = await post("/api/cash/close", { countedAmount: 45_000 });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.diferencia).toBe(0);
    expect(body.estado.palabra).toBe("cuadrada");
    expect(body.estado.franja).toBe(false);
    expect(body.alerta).toBeNull();
  });

  /**
   * `closedAt` y `openStationId` se escriben en la MISMA sentencia. Los dos
   * `CHECK` de la migración inicial rechazan cualquier estado intermedio, así
   * que el drift entre ambos no es representable.
   */
  it("al cerrar, el marcador queda nulo y la fecha puesta", async () => {
    const s = await db.cashSession.findFirstOrThrow({ where: { stationId: idCaja1 }, orderBy: { id: "desc" } });
    expect(s.openStationId).toBeNull();
    expect(s.closedAt).not.toBeNull();
    expect(s.expectedAmount).toBe(45_000);
    expect(s.countedAmount).toBe(45_000);
    expect(s.differenceAmount).toBe(0);
  });

  it("cerrada, la caja se puede volver a abrir", async () => {
    expect((await post("/api/cash/open", { openingAmount: 20_000 })).statusCode).toBe(201);
  });

  it("cerrar dos veces se rechaza", async () => {
    await post("/api/cash/close", { countedAmount: 20_000 });
    const r = await post("/api/cash/close", { countedAmount: 20_000 });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("ya está cerrada");
  });

  it("una diferencia chica queda registrada pero no alarma", async () => {
    await post("/api/cash/open", { openingAmount: 10_000 });
    // El límite por omisión es $2.000.
    const body = JSON.parse((await post("/api/cash/close", { countedAmount: 9_000 })).body);
    expect(body.diferencia).toBe(-1_000);
    expect(body.estado.tono).toBe("warn");
    expect(body.estado.palabra).toBe("falta poco");
    expect(body.estado.mensaje).toContain("queda registrado");
    expect(body.alerta).toBeNull();
  });

  it("una diferencia grande levanta alerta CRITICAL y pide la franja", async () => {
    await post("/api/cash/open", { openingAmount: 100_000 });
    const body = JSON.parse((await post("/api/cash/close", { countedAmount: 90_000 })).body);
    expect(body.diferencia).toBe(-10_000);
    expect(body.estado.palabra).toBe("descuadrada");
    expect(body.estado.franja).toBe(true);
    expect(body.alerta).not.toBeNull();
    expect(body.alerta.type).toBe("CASH_DIFFERENCE");
    expect(body.alerta.severity).toBe("CRITICAL");
    expect(body.alerta.message).toContain("CAJA-1");
  });

  /** Que sobre plata no es bueno: significa que algo no se registró. */
  it("que sobre también descuadra", async () => {
    await post("/api/cash/open", { openingAmount: 10_000 });
    const body = JSON.parse((await post("/api/cash/close", { countedAmount: 25_000 })).body);
    expect(body.diferencia).toBe(15_000);
    expect(body.estado.palabra).toBe("descuadrada");
    expect(body.estado.mensaje).toContain("venta cobrada y no registrada");
  });

  it("el libro termina en lo que hay de verdad en el cajón, no en lo que el sistema creía", async () => {
    const s = await db.cashSession.findFirstOrThrow({ where: { stationId: idCaja1 }, orderBy: { id: "desc" } });
    const ultimo = await db.cashMovement.findFirstOrThrow({ where: { sessionId: s.id }, orderBy: { id: "desc" } });
    expect(ultimo.type).toBe("CLOSING");
    expect(ultimo.balanceAfter).toBe(25_000);
  });
});

describe("reporte de cierre (tarea 2.5)", () => {
  let idSesion: number;

  beforeAll(async () => {
    await post("/api/cash/open", { openingAmount: 50_000 });
    await post("/api/cash/movements", { type: "WITHDRAWAL", amount: 10_000, description: "Flete" });
    await post("/api/cash/close", { countedAmount: 39_500, notes: "Turno de la tarde" });
    idSesion = (await db.cashSession.findFirstOrThrow({ where: { stationId: idCaja1 }, orderBy: { id: "desc" } })).id;
  });

  it("entra en la cola de impresión, no sale al puerto", async () => {
    const r = await post(`/api/cash/sessions/${idSesion}/report`, {});
    expect(r.statusCode).toBe(201);
    const trabajo = await db.printJob.findUniqueOrThrow({ where: { id: JSON.parse(r.body).trabajo.id } });
    expect(trabajo.type).toBe("CASH_REPORT");
    expect(trabajo.status).toBe("PENDING");
    expect(trabajo.stationId).toBe(idCaja1);
  });

  it("el papel dice lo mismo que la pantalla, y sin tildes para la térmica", async () => {
    const trabajo = await db.printJob.findFirstOrThrow({ where: { type: "CASH_REPORT" }, orderBy: { createdAt: "desc" } });
    const texto = Buffer.from(trabajo.payload, "base64").toString("ascii");

    expect(texto).toContain("CIERRE DE CAJA");
    expect(texto).toContain("CAJA-1");
    expect(texto).toContain("$50.000"); // apertura
    expect(texto).toContain("$39.500"); // contado
    // En papel no hay color: la palabra es la única señal del estado.
    expect(texto).toContain("FALTA POCO");
    expect(texto).toContain("Flete");
    expect(texto).toContain("Turno de la tarde");
    // Ni un byte fuera de ASCII, o la térmica imprime basura.
    expect(Buffer.from(trabajo.payload, "base64").every((b) => b < 0x80)).toBe(true);
  });

  it("una caja abierta no tiene reporte que imprimir", async () => {
    await post("/api/cash/open", { openingAmount: 1_000 });
    const abierta = await db.cashSession.findFirstOrThrow({ where: { openStationId: idCaja1 } });
    const r = await post(`/api/cash/sessions/${abierta.id}/report`, {});
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("todavía está abierta");
    await post("/api/cash/close", { countedAmount: 1_000 });
  });
});

describe("historial", () => {
  it("el admin ve las sesiones con su estado ya derivado", async () => {
    const r = await get("/api/cash/sessions", tokenAdmin);
    expect(r.statusCode).toBe(200);
    const s = JSON.parse(r.body).sesiones;
    expect(s.length).toBeGreaterThan(3);
    expect(s[0].estado).not.toBeNull();
    expect(["cuadrada", "falta poco", "sobra poco", "descuadrada"]).toContain(s[0].estado.palabra);
  });

  it("el vendedor no ve el historial de todas las cajas", async () => {
    expect((await get("/api/cash/sessions")).statusCode).toBe(403);
  });
});

describe("estaciones (tarea 2.7)", () => {
  it("el admin crea una caja y el nombre se normaliza", async () => {
    const r = await post("/api/stations", { name: "caja 3", locationId: idLocal }, tokenAdmin);
    expect(r.statusCode).toBe(201);
    expect(JSON.parse(r.body).estacion.name).toBe("CAJA-3");
  });

  it("un nombre que no tiene forma de caja se rechaza", async () => {
    const r = await post("/api/stations", { name: "la de adelante!!", locationId: idLocal }, tokenAdmin);
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("CAJA-1");
  });

  /**
   * Cambiar la ubicación o la impresora a mitad de turno parte el reporte de
   * cierre en dos realidades.
   */
  it("con la caja abierta no se le cambia la ubicación ni la impresora", async () => {
    await post("/api/cash/open", { openingAmount: 5_000 });
    const r = await app.inject({
      method: "PATCH",
      url: `/api/stations/${idCaja1}`,
      headers: como(tokenAdmin),
      payload: { printerTarget: "otra:9100" },
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("caja abierta");
    await post("/api/cash/close", { countedAmount: 5_000 });
  });

  it("cerrada, sí se le puede cambiar", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/api/stations/${idCaja1}`,
      headers: como(tokenAdmin),
      payload: { printerTarget: "\\\\SRV\\T1" },
    });
    expect(r.statusCode).toBe(200);
  });

  it("el vendedor no administra cajas", async () => {
    expect((await get("/api/stations")).statusCode).toBe(403);
  });
});

/**
 * La demo de cierre del sprint, tal como está escrita en SPRINTS.md:
 * abrir con $50.000, retirar $10.000 para el flete, cerrar contando — la
 * diferencia aparece sola — e intentar abrir una segunda caja en la misma
 * estación y ver que el sistema la rechaza.
 */
describe("demo de cierre del Sprint 2", () => {
  it("turno completo de punta a punta", async () => {
    const abrir = await post("/api/cash/open", { openingAmount: 50_000 });
    expect(abrir.statusCode).toBe(201);

    const segunda = await post("/api/cash/open", { openingAmount: 50_000 });
    expect(segunda.statusCode).toBe(400);

    const flete = await post("/api/cash/movements", {
      type: "WITHDRAWAL",
      amount: 10_000,
      description: "Flete",
    });
    expect(JSON.parse(flete.body).saldo).toBe(40_000);

    expect(JSON.parse((await get("/api/cash/expected")).body).esperado).toBe(40_000);

    // El vendedor cuenta y le faltan $500.
    const cierre = JSON.parse((await post("/api/cash/close", { countedAmount: 39_500 })).body);
    expect(cierre.esperado).toBe(40_000);
    expect(cierre.diferencia).toBe(-500);
    expect(cierre.estado.palabra).toBe("falta poco");

    // Y la caja queda lista para el turno siguiente.
    expect(JSON.parse((await get("/api/cash/current")).body).abierta).toBe(false);
  });
});
