/**
 * El ticket configurable (encabezado, despedida y nombre) desde el panel.
 *
 * Lo que protege: que el texto del administrador llegue de verdad al ESC/POS
 * de la venta siguiente —el setting que se guarda y no se usa es la clase de
 * defecto que nadie nota hasta que un cliente pide la dirección— y que los
 * límites de papel se impongan en el servidor, no en la buena voluntad de la
 * pantalla.
 */
import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { db } from "../db.js";
import { PIN_ADMIN, PIN_VENDEDOR } from "../test-setup.js";

let app: FastifyInstance;
let tokenAdmin: string, tokenVendedor: string;

beforeAll(async () => {
  app = await buildApp({ jwtSecret: "test-secret" });
  await app.ready();

  const idAdmin = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  const idVendedor = (await db.user.findFirstOrThrow({ where: { role: "SELLER", active: true } })).id;
  const idCaja = (await db.station.findFirstOrThrow({ where: { name: "CAJA-1" } })).id;

  const entrar = async (userId: number, pin: string) =>
    JSON.parse(
      (await app.inject({ method: "POST", url: "/api/auth/login", payload: { userId, pin, stationId: idCaja } })).body,
    ).token as string;

  tokenAdmin = await entrar(idAdmin, PIN_ADMIN);
  tokenVendedor = await entrar(idVendedor, PIN_VENDEDOR);
});

const como = (t: string) => ({ authorization: `Bearer ${t}` });

describe("GET /api/ticket/config", () => {
  it("trae los tres textos, con los defaults del seed", async () => {
    const r = await app.inject({ method: "GET", url: "/api/ticket/config", headers: como(tokenAdmin) });
    expect(r.statusCode).toBe(200);
    const cuerpo = JSON.parse(r.body);
    expect(cuerpo.tienda).toBeTypeOf("string");
    expect(cuerpo.encabezado).toBeTypeOf("string");
    expect(cuerpo.pie).toBeTypeOf("string");
  });

  it("el vendedor no llega: es configuración de la tienda", async () => {
    const r = await app.inject({ method: "GET", url: "/api/ticket/config", headers: como(tokenVendedor) });
    expect(r.statusCode).toBe(403);
  });
});

describe("PUT /api/ticket/config", () => {
  it("guarda, y el GET siguiente lo devuelve", async () => {
    const r = await app.inject({
      method: "PUT",
      url: "/api/ticket/config",
      headers: como(tokenAdmin),
      payload: {
        tienda: "Ferrehouse",
        encabezado: "Av. Los Carrera 1234\n+56 9 1234 5678",
        pie: "Cambios hasta 30 dias con boleta",
      },
    });
    expect(r.statusCode).toBe(200);

    const leido = JSON.parse(
      (await app.inject({ method: "GET", url: "/api/ticket/config", headers: como(tokenAdmin) })).body,
    );
    expect(leido.encabezado).toBe("Av. Los Carrera 1234\n+56 9 1234 5678");
    expect(leido.pie).toBe("Cambios hasta 30 dias con boleta");
  });

  it("los saltos de línea de Windows (\\r\\n) se normalizan al guardar", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/ticket/config",
      headers: como(tokenAdmin),
      payload: { tienda: "Ferrehouse", encabezado: "Linea 1\r\nLinea 2", pie: "" },
    });
    const leido = JSON.parse(
      (await app.inject({ method: "GET", url: "/api/ticket/config", headers: como(tokenAdmin) })).body,
    );
    expect(leido.encabezado).toBe("Linea 1\nLinea 2");
  });

  it("rechaza una línea más ancha que el papel más ancho", async () => {
    const r = await app.inject({
      method: "PUT",
      url: "/api/ticket/config",
      headers: como(tokenAdmin),
      payload: { tienda: "F", encabezado: "x".repeat(49), pie: "" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("rechaza un encabezado de seis líneas: el rollo se paga", async () => {
    const r = await app.inject({
      method: "PUT",
      url: "/api/ticket/config",
      headers: como(tokenAdmin),
      payload: { tienda: "F", encabezado: "a\nb\nc\nd\ne\nf", pie: "" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("rechaza la tienda sin nombre", async () => {
    const r = await app.inject({
      method: "PUT",
      url: "/api/ticket/config",
      headers: como(tokenAdmin),
      payload: { tienda: "  ", encabezado: "", pie: "" },
    });
    expect(r.statusCode).toBe(400);
  });

  it("el vendedor tampoco escribe", async () => {
    const r = await app.inject({
      method: "PUT",
      url: "/api/ticket/config",
      headers: como(tokenVendedor),
      payload: { tienda: "Otra", encabezado: "", pie: "" },
    });
    expect(r.statusCode).toBe(403);
  });

  it("queda en la bitácora, con el antes y el después", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/ticket/config",
      headers: como(tokenAdmin),
      payload: { tienda: "Ferrehouse", encabezado: "", pie: "Gracias por su compra" },
    });
    const registro = await db.auditLog.findFirstOrThrow({
      where: { action: "SETTING_CHANGED", entityId: "ticket" },
      orderBy: { id: "desc" },
    });
    const payload = JSON.parse(registro.payload!);
    expect(payload.antes).toBeDefined();
    expect(payload.ahora.pie).toBe("Gracias por su compra");
  });
});

describe("el texto guardado llega al papel", () => {
  /**
   * La prueba que une las dos mitades: se configura el ticket, se hace una
   * venta de verdad, y el ESC/POS encolado lleva el encabezado y la despedida.
   * Sin esto, guardar y usar podrían discrepar para siempre sin que ningún
   * otro test lo note.
   */
  it("una venta después de configurar imprime el encabezado y la despedida nuevos", async () => {
    await app.inject({
      method: "PUT",
      url: "/api/ticket/config",
      headers: como(tokenAdmin),
      payload: {
        tienda: "Ferrehouse",
        encabezado: "Av. Los Carrera 1234",
        pie: "Vuelva pronto",
      },
    });

    // La estación necesita impresora para que la venta encole el ticket.
    await db.station.update({ where: { name: "CAJA-1" }, data: { printerTarget: "\\\\SRV\\TERMICA" } });

    // Un producto vendible con stock, directo a la base: el catálogo no es lo
    // que se prueba acá.
    const idLocal = (await db.location.findFirstOrThrow({ where: { isDefault: true } })).id;
    const grupo = await db.unitGroup.create({ data: { name: "CONTEO-TICKET", allowsFraction: false } });
    const unidad = await db.unit.create({
      data: { groupId: grupo.id, name: "Unidad TK", symbol: "un", factorMilli: 1000, isBase: true },
    });
    const producto = await db.product.create({
      data: {
        sku: "TK-00001",
        name: "Producto del ticket",
        searchKey: "producto del ticket",
        priceGross: 1000,
        costNetMilliPeso: 500_000,
        saleUnitId: unidad.id,
        purchaseUnitId: unidad.id,
      },
    });
    await db.stockLevel.create({ data: { productId: producto.id, locationId: idLocal, qtyBaseMilli: 10_000 } });

    // Caja abierta, si no la venta no pasa.
    const abrir = await app.inject({
      method: "POST",
      url: "/api/cash/open",
      headers: como(tokenAdmin),
      payload: { openingAmount: 10_000 },
    });
    expect([200, 201, 400]).toContain(abrir.statusCode); // 400 = ya estaba abierta

    const venta = await app.inject({
      method: "POST",
      url: "/api/sales",
      headers: como(tokenAdmin),
      payload: {
        items: [{ productId: producto.id, qtyMilli: 1000 }],
        payments: [{ method: "CASH", receivedAmount: 1000 }],
      },
    });
    expect(venta.statusCode).toBe(201);

    const trabajo = await db.printJob.findFirstOrThrow({
      where: { saleId: JSON.parse(venta.body).venta.id },
    });
    const papel = Buffer.from(trabajo.payload, "base64").toString("ascii");
    expect(papel).toContain("Av. Los Carrera 1234");
    expect(papel).toContain("Vuelva pronto");
    expect(papel).not.toContain("Gracias por su compra");
  });
});
