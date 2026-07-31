/**
 * Sprint 6 — WhatsApp, todo lo que se puede probar sin un teléfono.
 *
 * El transporte se inyecta (`transporteFalso`), así que la cola, los
 * reintentos, la baja y el panel se ejercitan enteros sin abrir una sesión de
 * WhatsApp ni mandar un mensaje a nadie. Lo único que NO se prueba acá es el
 * adaptador de whatsapp-web.js, que no existe todavía y por eso mismo está
 * detrás de un puerto.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { db } from "../db.js";
import { SKU_COUNTER, type EstadoSesion } from "@ferrehouse/shared";
import { PIN_ADMIN, PIN_VENDEDOR } from "../test-setup.js";
import type { ResultadoEnvio, TransporteWhatsApp } from "../whatsapp/transporte.js";
import { procesarPendientes } from "../whatsapp/cola.js";
import { procesarMensajeEntrante } from "../whatsapp/entrante.js";

/**
 * El interruptor del test 'una venta cobrada sobrevive a una cola rota'. Va con
 * `vi.hoisted` porque `vi.mock` se iza sobre los imports y una variable normal
 * todavía no existiría cuando el mock se evalúa.
 */
const control = vi.hoisted(() => ({ colaExplota: false }));

vi.mock("../whatsapp/cola.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../whatsapp/cola.js")>();
  return {
    ...real,
    encolarMensajeDeVenta: async (saleId: number) => {
      if (control.colaExplota) throw new Error("la cola explotó");
      return real.encolarMensajeDeVenta(saleId);
    },
  };
});

let app: FastifyInstance;
let tokenAdmin: string, tokenVendedor: string;
let idCaja1: number, idLocal: number;
let pPerno: number;

beforeAll(async () => {
  app = await buildApp({ jwtSecret: "test-secret" });
  await app.ready();

  idLocal = (await db.location.findFirstOrThrow({ where: { isDefault: true } })).id;
  idCaja1 = (await db.station.findFirstOrThrow({ where: { name: "CAJA-1" } })).id;

  const conteo = await db.unitGroup.create({ data: { name: "CONTEO", allowsFraction: false } });
  const uUnidad = await db.unit.create({
    data: { groupId: conteo.id, name: "Unidad", symbol: "un", factorMilli: 1000, isBase: true },
  });
  await db.counter.create({ data: { name: SKU_COUNTER, value: 0 } });

  const p = await db.product.create({
    data: {
      sku: "FH-00001",
      name: "Perno 5/8",
      saleUnitId: uUnidad.id,
      purchaseUnitId: uUnidad.id,
      priceGross: 350,
      costNetMilliPeso: 180_000,
      searchKey: "perno 5/8",
    },
  });
  pPerno = p.id;
  await db.stockLevel.create({ data: { productId: pPerno, locationId: idLocal, qtyBaseMilli: 5_000_000 } });

  const idAdmin = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  const idVendedor = (await db.user.findFirstOrThrow({ where: { role: "SELLER", active: true } })).id;
  const entrar = async (userId: number, pin: string) =>
    JSON.parse(
      (await app.inject({ method: "POST", url: "/api/auth/login", payload: { userId, pin, stationId: idCaja1 } })).body,
    ).token as string;
  tokenAdmin = await entrar(idAdmin, PIN_ADMIN);
  tokenVendedor = await entrar(idVendedor, PIN_VENDEDOR);

  await app.inject({
    method: "POST",
    url: "/api/cash/open",
    headers: { authorization: `Bearer ${tokenVendedor}` },
    payload: { openingAmount: 50_000 },
  });
});

beforeEach(async () => {
  control.colaExplota = false;
  await db.whatsAppJob.deleteMany();
  await db.sale.updateMany({ data: { customerId: null } });
  await db.customer.deleteMany();
});

const como = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (url: string, payload: unknown, t = tokenAdmin) =>
  app.inject({ method: "POST", url, headers: como(t), payload: payload as object });
const put = (url: string, payload: unknown, t = tokenAdmin) =>
  app.inject({ method: "PUT", url, headers: como(t), payload: payload as object });
const get = (url: string, t = tokenAdmin) => app.inject({ method: "GET", url, headers: como(t) });
const cuerpo = (r: { body: string }) => JSON.parse(r.body);

/** Una venta de un perno pagada al contado, con el cliente que se le pase. */
const vender = (cliente?: { nombre?: string | null; telefono: string; consentimiento: boolean }) =>
  post(
    "/api/sales",
    {
      items: [{ productId: pPerno, qtyMilli: 1000 }],
      payments: [{ method: "CASH", receivedAmount: 500 }],
      cliente,
    },
    tokenVendedor,
  );

// ============================================================
// El transporte falso
// ============================================================

type Falso = TransporteWhatsApp & { enviados: Array<{ a: string; mensaje: string }> };

function transporteFalso(opts: {
  estado?: EstadoSesion;
  responder?: (e164: string, mensaje: string) => ResultadoEnvio;
} = {}): Falso {
  const enviados: Array<{ a: string; mensaje: string }> = [];
  return {
    enviados,
    estado: () => opts.estado ?? "CONECTADA",
    qr: () => null,
    desde: () => null,
    enviar: async (a, mensaje) => {
      enviados.push({ a, mensaje });
      return opts.responder?.(a, mensaje) ?? { ok: true };
    },
  };
}

/** Sin jitter real: el test fija el azar y mide las esperas en vez de sufrirlas. */
const sinAzar = { aleatorio: () => 0.5, esperar: async () => {} };

// ============================================================
// 6.1 — La captura en el mesón
// ============================================================

describe("captura del cliente (6.1)", () => {
  it("guarda el teléfono normalizado, no como lo escribieron", async () => {
    const r = await vender({ nombre: "Ana Soto", telefono: "9 1234 5678", consentimiento: true });
    expect(r.statusCode).toBe(201);
    const c = await db.customer.findFirstOrThrow();
    expect(c.phone).toBe("+56912345678");
    expect(c.name).toBe("Ana Soto");
    expect(c.whatsappConsent).toBe(true);
    expect(c.consentAt).not.toBeNull();
  });

  /** `Customer.phone` es único: si esto falla, la baja de uno no cubre al otro. */
  it("dos ventas con el mismo número escrito distinto son UN cliente", async () => {
    await vender({ telefono: "912345678", consentimiento: true });
    await vender({ nombre: "Ana", telefono: "+56 9 1234 5678", consentimiento: true });
    expect(await db.customer.count()).toBe(1);
    // Y el nombre que faltaba se completó en la segunda pasada.
    expect((await db.customer.findFirstOrThrow()).name).toBe("Ana");
  });

  it("el nombre que ya estaba no se pisa con un vacío", async () => {
    await vender({ nombre: "Ana", telefono: "912345678", consentimiento: true });
    await vender({ telefono: "912345678", consentimiento: true });
    expect((await db.customer.findFirstOrThrow()).name).toBe("Ana");
  });

  /** Invariante del sprint: un número inválido NO bloquea la venta. */
  it("un teléfono mal digitado no tumba la venta: la registra y avisa", async () => {
    const r = await vender({ telefono: "9123", consentimiento: true });
    expect(r.statusCode).toBe(201);
    const b = cuerpo(r);
    expect(b.venta.customerId).toBeNull();
    expect(b.avisoCliente).toMatch(/9 dígitos/);
    expect(b.avisoCliente).toMatch(/sin cliente/);
    expect(await db.customer.count()).toBe(0);
    expect(await db.whatsAppJob.count()).toBe(0);
  });

  it("sin bloque de cliente la venta sigue funcionando igual que antes", async () => {
    const r = await vender();
    expect(r.statusCode).toBe(201);
    expect(cuerpo(r).whatsapp).toEqual({ encolado: false, motivo: "SIN_CLIENTE" });
  });
});

// ============================================================
// 6.3 — La cola: encolar sin poner en riesgo la venta
// ============================================================

describe("encolado (6.3, decisión sellada 15)", () => {
  it("con consentimiento se agenda el mensaje ya redactado", async () => {
    const r = await vender({ nombre: "Ana", telefono: "912345678", consentimiento: true });
    expect(cuerpo(r).whatsapp).toEqual({ encolado: true });
    const job = await db.whatsAppJob.findFirstOrThrow();
    expect(job.status).toBe("PENDING");
    expect(job.phone).toBe("+56912345678");
    expect(job.message).toBe("Hola Ana, gracias por tu compra en Ferrehouse por $350.");
  });

  it("sin nombre el mensaje no queda con una coma huérfana", async () => {
    await vender({ telefono: "912345678", consentimiento: true });
    const job = await db.whatsAppJob.findFirstOrThrow();
    expect(job.message).toBe("Hola, gracias por tu compra en Ferrehouse por $350.");
  });

  it("sin consentimiento no se agenda nada", async () => {
    const r = await vender({ nombre: "Ana", telefono: "912345678", consentimiento: false });
    expect(cuerpo(r).whatsapp).toEqual({ encolado: false, motivo: "SIN_CONSENTIMIENTO" });
    expect(await db.whatsAppJob.count()).toBe(0);
    // Pero el cliente sí queda atribuido a la venta.
    expect(cuerpo(r).venta.customerId).not.toBeNull();
  });

  /**
   * EL TEST QUE PROTEGE LA PLATA. Si esto falla, un fallo de la cola devuelve
   * 500 sobre una venta ya cobrada: el vendedor lee "error", vuelve a cobrar,
   * y la ferretería cobra dos veces.
   */
  it("una venta cobrada sobrevive a una cola rota", async () => {
    control.colaExplota = true;
    const antes = await db.sale.count();
    const r = await vender({ nombre: "Ana", telefono: "912345678", consentimiento: true });
    expect(r.statusCode).toBe(201);
    expect(cuerpo(r).whatsapp).toEqual({ encolado: false, motivo: "ERROR" });
    expect(await db.sale.count()).toBe(antes + 1);
    // Y el movimiento de caja de esa venta también quedó.
    const venta = cuerpo(r).venta;
    expect(await db.cashMovement.count({ where: { saleId: venta.id } })).toBe(1);
  });
});

// ============================================================
// 6.3 — El worker
// ============================================================

describe("worker de la cola (6.3)", () => {
  async function unPendiente() {
    await vender({ nombre: "Ana", telefono: "912345678", consentimiento: true });
    return db.whatsAppJob.findFirstOrThrow();
  }

  /**
   * La demo de cierre del sprint: se cae internet, la venta cierra igual y el
   * mensaje sale cuando vuelve la conexión. Si la pasada gastara un intento con
   * la sesión caída, dos horas sin internet dejarían la cola entera en FALLIDO.
   */
  it("sin sesión conectada NO se gasta ningún intento", async () => {
    const job = await unPendiente();
    for (const estado of ["DESCONECTADA", "CAIDA", "ESPERANDO_QR"] as EstadoSesion[]) {
      const r = await procesarPendientes({ ...sinAzar, transporte: transporteFalso({ estado }) });
      expect(r.revisados).toBe(0);
      expect(r.estado).toBe(estado);
    }
    const despues = await db.whatsAppJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(despues.status).toBe("PENDING");
    expect(despues.attempts).toBe(0);
  });

  it("conectada, manda y marca enviado", async () => {
    const job = await unPendiente();
    const t = transporteFalso();
    const r = await procesarPendientes({ ...sinAzar, transporte: t });
    expect(r.enviados).toBe(1);
    expect(t.enviados).toEqual([{ a: "+56912345678", mensaje: job.message }]);
    const despues = await db.whatsAppJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(despues.status).toBe("SENT");
    expect(despues.sentAt).not.toBeNull();
  });

  it("un fallo pasajero reagenda con espera, no falla", async () => {
    const job = await unPendiente();
    const ahora = new Date("2026-07-31T10:00:00");
    const t = transporteFalso({ responder: () => ({ ok: false, error: "sin internet", permanente: false }) });
    const r = await procesarPendientes({ ...sinAzar, ahora: () => ahora, transporte: t });

    expect(r.reagendados).toBe(1);
    const despues = await db.whatsAppJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(despues.status).toBe("PENDING");
    expect(despues.attempts).toBe(1);
    expect(despues.lastError).toBe("sin internet");
    // Primer reintento: un minuto (con el azar fijado en el centro).
    expect(despues.scheduledAt.getTime() - ahora.getTime()).toBe(60_000);
  });

  it("un fallo permanente no quema los cinco intentos", async () => {
    const job = await unPendiente();
    const t = transporteFalso({
      responder: () => ({ ok: false, error: "ese número no tiene WhatsApp", permanente: true }),
    });
    const r = await procesarPendientes({ ...sinAzar, transporte: t });
    expect(r.fallidos).toBe(1);
    const despues = await db.whatsAppJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(despues.status).toBe("FAILED");
    expect(despues.attempts).toBe(1);
  });

  it("al quinto intento se da por perdido", async () => {
    const job = await unPendiente();
    await db.whatsAppJob.update({ where: { id: job.id }, data: { attempts: 4 } });
    const t = transporteFalso({ responder: () => ({ ok: false, error: "sin internet", permanente: false }) });
    await procesarPendientes({ ...sinAzar, transporte: t });
    const despues = await db.whatsAppJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(despues.status).toBe("FAILED");
    expect(despues.attempts).toBe(5);
  });

  it("no toca lo que todavía no vence", async () => {
    const job = await unPendiente();
    await db.whatsAppJob.update({
      where: { id: job.id },
      data: { scheduledAt: new Date(Date.now() + 600_000) },
    });
    const r = await procesarPendientes({ ...sinAzar, transporte: transporteFalso() });
    expect(r.revisados).toBe(0);
  });

  /**
   * El jitter anti-bot: entre dos envíos hay pausa, antes del primero no. Sin
   * él, la cola se vacía de un viaje y ese patrón es el que hace que Meta mire
   * el número.
   */
  it("pausa entre envíos, pero no antes del primero", async () => {
    await vender({ telefono: "912345678", consentimiento: true });
    await vender({ telefono: "987654321", consentimiento: true });
    await vender({ telefono: "911111111", consentimiento: true });

    const pausas: number[] = [];
    const r = await procesarPendientes({
      aleatorio: () => 0.5,
      esperar: async (ms) => void pausas.push(ms),
      transporte: transporteFalso(),
    });

    expect(r.enviados).toBe(3);
    expect(pausas).toEqual([9500, 9500]); // dos pausas para tres envíos
  });

  it("respeta el límite por pasada", async () => {
    await vender({ telefono: "912345678", consentimiento: true });
    await vender({ telefono: "987654321", consentimiento: true });
    const r = await procesarPendientes({ ...sinAzar, transporte: transporteFalso() }, 1);
    expect(r.enviados).toBe(1);
    expect(await db.whatsAppJob.count({ where: { status: "PENDING" } })).toBe(1);
  });
});

// ============================================================
// 6.5 — La baja
// ============================================================

describe("baja del cliente (6.5, WA-03)", () => {
  it("un 'BAJA' entrante marca la baja y cancela lo que estaba en cola", async () => {
    await vender({ nombre: "Ana", telefono: "912345678", consentimiento: true });
    expect(await db.whatsAppJob.count({ where: { status: "PENDING" } })).toBe(1);

    const r = await procesarMensajeEntrante("56912345678@c.us", "BAJA");
    expect(r.accion).toBe("BAJA");

    const c = await db.customer.findFirstOrThrow();
    expect(c.optOutAt).not.toBeNull();
    expect(c.whatsappConsent).toBe(false);
    expect(await db.whatsAppJob.count({ where: { status: "CANCELLED" } })).toBe(1);
  });

  it("la baja queda en la bitácora aunque no la haya pedido nadie del mesón", async () => {
    await vender({ telefono: "912345678", consentimiento: true });
    await procesarMensajeEntrante("56912345678@c.us", "no molestar");
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "WHATSAPP_OPT_OUT" } });
    const autor = await db.user.findUniqueOrThrow({ where: { id: log.userId } });
    expect(autor.role).toBe("SYSTEM");
  });

  it("un mensaje cualquiera no da de baja a nadie", async () => {
    await vender({ telefono: "912345678", consentimiento: true });
    const r = await procesarMensajeEntrante("56912345678@c.us", "tienen tarugos de 8?");
    expect(r).toEqual({ accion: "IGNORADO", motivo: "NO_ES_BAJA" });
    expect((await db.customer.findFirstOrThrow()).optOutAt).toBeNull();
  });

  it("un 'BAJA' de un número desconocido no revienta", async () => {
    const r = await procesarMensajeEntrante("56955555555@c.us", "BAJA");
    expect(r).toEqual({ accion: "IGNORADO", motivo: "CLIENTE_DESCONOCIDO" });
  });

  it("una venta posterior no le vuelve a agendar mensajes", async () => {
    await vender({ telefono: "912345678", consentimiento: true });
    await procesarMensajeEntrante("56912345678@c.us", "BAJA");
    await db.whatsAppJob.deleteMany();

    const r = await vender({ telefono: "912345678", consentimiento: true });
    expect(r.statusCode).toBe(201);
    expect(cuerpo(r).avisoCliente).toMatch(/pidió no recibir mensajes/);
    expect(await db.whatsAppJob.count()).toBe(0);
    // El checkbox del vendedor NO deshace la baja.
    expect((await db.customer.findFirstOrThrow()).optOutAt).not.toBeNull();
  });

  /**
   * La baja pedida mientras el mensaje ya estaba agendado. Escribirle igual
   * "porque ya estaba en la cola" es exactamente lo que la baja prohíbe.
   */
  it("si la baja llega después de encolar, el mensaje no sale", async () => {
    await vender({ telefono: "912345678", consentimiento: true });
    await db.customer.updateMany({ data: { optOutAt: new Date() } });

    const t = transporteFalso();
    const r = await procesarPendientes({ ...sinAzar, transporte: t });
    expect(r.cancelados).toBe(1);
    expect(r.enviados).toBe(0);
    expect(t.enviados).toEqual([]);
  });

  it("el admin puede registrar la baja que le pidieron por teléfono", async () => {
    await vender({ telefono: "912345678", consentimiento: true });
    const id = (await db.customer.findFirstOrThrow()).id;
    const r = await post(`/api/whatsapp/clientes/${id}/baja`, { motivo: "Lo pidió en el mesón" });
    expect(r.statusCode).toBe(200);
    expect(cuerpo(r).cancelados).toBe(1);
    expect(cuerpo(r).mensaje).toMatch(/1 mensajes/);
    expect((await db.customer.findFirstOrThrow()).optOutAt).not.toBeNull();
  });

  it("dar de baja dos veces no es un error", async () => {
    await vender({ telefono: "912345678", consentimiento: true });
    const id = (await db.customer.findFirstOrThrow()).id;
    await post(`/api/whatsapp/clientes/${id}/baja`, {});
    const r = await post(`/api/whatsapp/clientes/${id}/baja`, {});
    expect(r.statusCode).toBe(200);
    expect(cuerpo(r).mensaje).toMatch(/ya estaba/);
  });
});

// ============================================================
// 6.4 — La plantilla
// ============================================================

describe("plantilla editable (6.4)", () => {
  it("una variable inventada se rechaza al guardar, con su nombre", async () => {
    const r = await put("/api/whatsapp/plantilla", { plantilla: "Hola {nombre}, tu folio {folio}" });
    expect(r.statusCode).toBe(400);
    expect(cuerpo(r).error).toMatch(/\{folio\} no existe/);
    expect(cuerpo(r).error).toMatch(/\{nombre\}/); // dice cuáles sí valen
  });

  it("la plantilla vacía se rechaza", async () => {
    expect((await put("/api/whatsapp/plantilla", { plantilla: "   " })).statusCode).toBe(400);
  });

  it("guardada, la usa el próximo mensaje", async () => {
    const r = await put("/api/whatsapp/plantilla", { plantilla: "{nombre}: tu boleta es {total}. Gracias!" });
    expect(r.statusCode).toBe(200);
    expect(cuerpo(r).ejemplo).toBe("Ana: tu boleta es $12.500. Gracias!");

    await vender({ nombre: "Ana", telefono: "912345678", consentimiento: true });
    expect((await db.whatsAppJob.findFirstOrThrow()).message).toBe("Ana: tu boleta es $350. Gracias!");

    // Se deja como estaba para no arrastrar el cambio a los otros tests.
    await put("/api/whatsapp/plantilla", {
      plantilla: "Hola {nombre}, gracias por tu compra en Ferrehouse por {total}.",
    });
  });

  it("el cambio de plantilla queda en la bitácora con el texto anterior", async () => {
    await put("/api/whatsapp/plantilla", { plantilla: "Gracias por tu compra de {total}." });
    const log = await db.auditLog.findFirstOrThrow({
      where: { action: "WHATSAPP_TEMPLATE_CHANGED" },
      orderBy: { id: "desc" },
    });
    expect(JSON.parse(log.payload ?? "{}").antes).toContain("{nombre}");
    await put("/api/whatsapp/plantilla", {
      plantilla: "Hola {nombre}, gracias por tu compra en Ferrehouse por {total}.",
    });
  });
});

// ============================================================
// 6.6 — El panel
// ============================================================

describe("panel (6.6) y permisos", () => {
  it("el vendedor no entra a ninguna ruta del panel", async () => {
    expect((await get("/api/whatsapp", tokenVendedor)).statusCode).toBe(403);
    expect((await get("/api/whatsapp/clientes", tokenVendedor)).statusCode).toBe(403);
    expect((await put("/api/whatsapp/plantilla", { plantilla: "x" }, tokenVendedor)).statusCode).toBe(403);
    expect((await post("/api/whatsapp/pasada", {}, tokenVendedor)).statusCode).toBe(403);
  });

  it("dice el estado real: sin vincular, y por qué no hay QR", async () => {
    const b = cuerpo(await get("/api/whatsapp"));
    expect(b.sesion.estado).toBe("DESCONECTADA");
    expect(b.sesion.qr).toBeNull();
    expect(b.sesion.pendienteDeInstalacion).toBe(true);
  });

  it("muestra la cola y los últimos mensajes con su teléfono legible", async () => {
    await vender({ nombre: "Ana", telefono: "912345678", consentimiento: true });
    const b = cuerpo(await get("/api/whatsapp"));
    expect(b.cola.pendientes).toBe(1);
    expect(b.ultimos[0].telefono).toBe("+56 9 1234 5678");
    expect(b.ultimos[0].estado).toBe("PENDING");
  });

  it("una pasada sin sesión lo dice en palabras, no calla", async () => {
    const b = cuerpo(await post("/api/whatsapp/pasada", {}));
    expect(b.mensaje).toMatch(/No hay sesión conectada/);
    expect(b.revisados).toBe(0);
  });

  it("no se puede reintentar algo que ya salió", async () => {
    await vender({ telefono: "912345678", consentimiento: true });
    const job = await db.whatsAppJob.findFirstOrThrow();
    await db.whatsAppJob.update({ where: { id: job.id }, data: { status: "SENT", sentAt: new Date() } });
    const r = await post(`/api/whatsapp/jobs/${job.id}/reintentar`, {});
    expect(r.statusCode).toBe(400);
    expect(cuerpo(r).error).toMatch(/dos veces/);
  });

  it("no se puede reintentar hacia un cliente dado de baja", async () => {
    await vender({ telefono: "912345678", consentimiento: true });
    const job = await db.whatsAppJob.findFirstOrThrow();
    await db.whatsAppJob.update({ where: { id: job.id }, data: { status: "FAILED" } });
    await db.customer.updateMany({ data: { optOutAt: new Date() } });
    const r = await post(`/api/whatsapp/jobs/${job.id}/reintentar`, {});
    expect(r.statusCode).toBe(400);
    expect(cuerpo(r).error).toMatch(/baja/);
  });

  it("reintentar devuelve los intentos a cero", async () => {
    await vender({ telefono: "912345678", consentimiento: true });
    const job = await db.whatsAppJob.findFirstOrThrow();
    await db.whatsAppJob.update({ where: { id: job.id }, data: { status: "FAILED", attempts: 5 } });
    expect((await post(`/api/whatsapp/jobs/${job.id}/reintentar`, {})).statusCode).toBe(200);
    const despues = await db.whatsAppJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(despues.status).toBe("PENDING");
    expect(despues.attempts).toBe(0);
  });

  it("el listado de clientes muestra consentimiento y baja", async () => {
    await vender({ nombre: "Ana", telefono: "912345678", consentimiento: true });
    const b = cuerpo(await get("/api/whatsapp/clientes"));
    expect(b.clientes).toHaveLength(1);
    expect(b.clientes[0]).toMatchObject({ nombre: "Ana", telefono: "+56 9 1234 5678", consiente: true, baja: null });
    expect(b.clientes[0].compras).toBe(1);
  });
});
