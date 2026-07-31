import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { db } from "../db.js";
import { SKU_COUNTER, findForbiddenFields } from "@ferrehouse/shared";
import { PIN_ADMIN, PIN_VENDEDOR } from "../test-setup.js";
import { setSetting } from "../settings.js";

let app: FastifyInstance;
let tokenAdmin: string, tokenVendedor: string;
let idCaja1: number, idLocal: number, idProveedor: number;
let uMetro: number, uRollo: number, uUnidad: number, uKilo: number;
let pCable: number, pPerno: number;

beforeAll(async () => {
  app = await buildApp({ jwtSecret: "test-secret" });
  await app.ready();

  idLocal = (await db.location.findFirstOrThrow({ where: { isDefault: true } })).id;
  idCaja1 = (await db.station.update({ where: { name: "CAJA-1" }, data: { printerTarget: "\\\\SRV\\T1" } })).id;

  const longitud = await db.unitGroup.create({ data: { name: "LONGITUD", allowsFraction: true } });
  const conteo = await db.unitGroup.create({ data: { name: "CONTEO", allowsFraction: false } });
  const peso = await db.unitGroup.create({ data: { name: "PESO", allowsFraction: true } });
  uMetro = (await db.unit.create({ data: { groupId: longitud.id, name: "Metro", symbol: "m", factorMilli: 1000, isBase: true } })).id;
  uRollo = (await db.unit.create({ data: { groupId: longitud.id, name: "Rollo 100 m", symbol: "rl100", factorMilli: 100_000 } })).id;
  uUnidad = (await db.unit.create({ data: { groupId: conteo.id, name: "Unidad", symbol: "un", factorMilli: 1000, isBase: true } })).id;
  uKilo = (await db.unit.create({ data: { groupId: peso.id, name: "Kilogramo", symbol: "kg", factorMilli: 1000, isBase: true } })).id;
  await db.counter.create({ data: { name: SKU_COUNTER, value: 0 } });

  idProveedor = (await db.supplier.create({ data: { name: "Distribuidora Bío-Bío" } })).id;

  const crearProducto = async (name: string, sku: string, unit: number, priceGross: number, costNetMilliPeso: number, stock = 0) => {
    const p = await db.product.create({
      data: { sku, name, saleUnitId: unit, purchaseUnitId: unit, priceGross, costNetMilliPeso, searchKey: name.toLowerCase() },
    });
    await db.stockLevel.create({ data: { productId: p.id, locationId: idLocal, qtyBaseMilli: stock } });
    return p.id;
  };
  pCable = await crearProducto("Cable 2,5 mm", "FH-00001", uMetro, 690, 0);
  pPerno = await crearProducto("Perno 5/8", "FH-00002", uUnidad, 350, 180_000, 100_000);

  const idAdmin = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  const idVendedor = (await db.user.findFirstOrThrow({ where: { role: "SELLER", active: true } })).id;
  const entrar = async (userId: number, pin: string) =>
    JSON.parse((await app.inject({ method: "POST", url: "/api/auth/login", payload: { userId, pin, stationId: idCaja1 } })).body).token as string;
  tokenAdmin = await entrar(idAdmin, PIN_ADMIN);
  tokenVendedor = await entrar(idVendedor, PIN_VENDEDOR);

  await app.inject({ method: "POST", url: "/api/cash/open", headers: { authorization: `Bearer ${tokenVendedor}` }, payload: { openingAmount: 50_000 } });
});

const como = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (url: string, payload: unknown, t = tokenAdmin) =>
  app.inject({ method: "POST", url, headers: como(t), payload: payload as object });
const get = (url: string, t = tokenAdmin) => app.inject({ method: "GET", url, headers: como(t) });
const cuerpo = (r: { body: string }) => JSON.parse(r.body);

const saldo = async (productId: number) =>
  (await db.stockLevel.findUniqueOrThrow({ where: { productId_locationId: { productId, locationId: idLocal } } })).qtyBaseMilli;
const costo = async (productId: number) =>
  (await db.product.findUniqueOrThrow({ where: { id: productId } })).costNetMilliPeso;

// ============================================================
// 4.1 y 4.2 — Compras y costo promedio
// ============================================================

describe("compra a proveedor (tarea 4.1)", () => {
  it("un rollo de 100 m entra como 100 m, y el costo queda por metro", async () => {
    const r = await post("/api/purchases", {
      supplierId: idProveedor,
      documentNumber: "F-8891",
      items: [{ productId: pCable, unitId: uRollo, qtyMilli: 1000, unitCostNet: 45_000 }],
    });
    expect(r.statusCode).toBe(201);

    // 1 rollo = 100 m = 100.000 milésimas de metro
    expect(await saldo(pCable)).toBe(100_000);
    // $45.000 el rollo = $450 el metro = 450.000 milésimas de peso
    expect(await costo(pCable)).toBe(450_000);

    const mov = await db.stockMovement.findFirstOrThrow({ where: { productId: pCable }, orderBy: { id: "desc" } });
    expect(mov.type).toBe("PURCHASE");
    expect(mov.totalCostNet).toBe(45_000);
    expect(mov.balanceCostNetMilliPeso).toBe(450_000);
  });

  it("comprar en una unidad de otro grupo se rechaza", async () => {
    const r = await post("/api/purchases", {
      supplierId: idProveedor,
      items: [{ productId: pCable, unitId: uKilo, qtyMilli: 1000, unitCostNet: 1000 }],
    });
    expect(r.statusCode).toBe(400);
    expect(cuerpo(r).error).toMatch(/magnitudes distintas/);
  });

  it("una compra recibida mañana se rechaza: es un año mal tecleado", async () => {
    const manana = new Date(Date.now() + 86_400_000).toISOString();
    const r = await post("/api/purchases", {
      supplierId: idProveedor,
      receivedAt: manana,
      items: [{ productId: pCable, unitId: uRollo, qtyMilli: 1000, unitCostNet: 45_000 }],
    });
    expect(r.statusCode).toBe(400);
    expect(cuerpo(r).error).toMatch(/no puede ser futura/);
  });

  it("el movimiento se fecha con la recepción, no con el tecleo", async () => {
    const viernes = new Date(Date.now() - 3 * 86_400_000);
    const r = await post("/api/purchases", {
      supplierId: idProveedor,
      receivedAt: viernes.toISOString(),
      items: [{ productId: pPerno, unitId: uUnidad, qtyMilli: 50_000, unitCostNet: 200 }],
    });
    expect(r.statusCode).toBe(201);
    const mov = await db.stockMovement.findFirstOrThrow({ where: { productId: pPerno }, orderBy: { id: "desc" } });
    expect(Math.abs(mov.createdAt.getTime() - viernes.getTime())).toBeLessThan(2000);
  });

  it("el promedio pondera: 100 m a $450 más 100 m a $550 dan $500", async () => {
    await post("/api/purchases", {
      supplierId: idProveedor,
      items: [{ productId: pCable, unitId: uRollo, qtyMilli: 1000, unitCostNet: 55_000 }],
    });
    expect(await saldo(pCable)).toBe(200_000);
    expect(await costo(pCable)).toBe(500_000);
  });

  it("al vendedor no le llega ni un costo de la compra", async () => {
    const r = await get("/api/purchases", tokenVendedor);
    // La compra entera es de administrador: el vendedor ni siquiera la lista.
    expect(r.statusCode).toBe(403);
  });
});

// ============================================================
// 4.3 — Ajustes y mermas
// ============================================================

describe("ajustes y mermas (tarea 4.3)", () => {
  it("sin motivo no se registra", async () => {
    const r = await post("/api/stock/adjustments", { productId: pCable, type: "ADJUSTMENT", qtyMilli: -1000, reason: "" });
    expect(r.statusCode).toBe(400);
    expect(cuerpo(r).error).toMatch(/motivo/i);
  });

  it("un ajuste negativo baja el saldo y NO toca el costo promedio", async () => {
    const costoAntes = await costo(pCable);
    const r = await post("/api/stock/adjustments", {
      productId: pCable,
      type: "ADJUSTMENT",
      qtyMilli: -5000,
      reason: "Conteo físico: había 5 m menos",
    });
    expect(r.statusCode).toBe(201);
    expect(await saldo(pCable)).toBe(195_000);
    // Sacar mercadería no cambia lo que costó la que queda.
    expect(await costo(pCable)).toBe(costoAntes);
  });

  it("una merma siempre resta, aunque venga en positivo", async () => {
    const antes = await saldo(pCable);
    await post("/api/stock/adjustments", {
      productId: pCable,
      type: "SHRINKAGE",
      qtyMilli: 2000,
      reason: "Se mojó un tramo en la bodega",
    });
    expect(await saldo(pCable)).toBe(antes - 2000);
  });

  it("un producto que no se fracciona no admite medio ajuste", async () => {
    const r = await post("/api/stock/adjustments", {
      productId: pPerno,
      type: "ADJUSTMENT",
      qtyMilli: 500,
      reason: "Medio perno",
    });
    expect(r.statusCode).toBe(400);
    expect(cuerpo(r).error).toMatch(/fraccionado/);
  });

  it("el vendedor no puede ajustar inventario", async () => {
    const r = await post(
      "/api/stock/adjustments",
      { productId: pCable, type: "ADJUSTMENT", qtyMilli: 1000, reason: "Aparecieron" },
      tokenVendedor,
    );
    expect(r.statusCode).toBe(403);
  });
});

// ============================================================
// 4.8 — Kardex
// ============================================================

describe("kardex (tarea 4.8)", () => {
  it("cuenta la historia en orden, con etiqueta y referencia", async () => {
    const r = await get(`/api/stock/${pCable}/kardex`);
    expect(r.statusCode).toBe(200);
    const k = cuerpo(r);
    expect(k.movimientos.length).toBeGreaterThan(2);
    // Orden de inserción descendente: lo último arriba.
    const ids = k.movimientos.map((m: { id: number }) => m.id);
    expect([...ids].sort((a: number, b: number) => b - a)).toEqual(ids);
    const compra = k.movimientos.find((m: { type: string }) => m.type === "PURCHASE");
    expect(compra.etiqueta).toBe("Compra");
    expect(compra.referencia).toMatch(/Compra #\d+ — Distribuidora Bío-Bío/);
    // La cantidad se muestra en unidad de venta: 1 rollo son 100 m.
    expect(compra.qtyMilli).toBe(100_000);
  });

  it("al vendedor no le llega ningún costo del kardex", async () => {
    const r = await get(`/api/stock/${pCable}/kardex`, tokenVendedor);
    expect(r.statusCode).toBe(200);
    expect(findForbiddenFields(cuerpo(r))).toEqual([]);
    // Pero sí ve los saldos: es la pantalla que contesta "¿por qué dice esto?"
    expect(cuerpo(r).movimientos[0].balanceMilli).toBeDefined();
  });
});

// ============================================================
// 4.5 — Validación de stock en la venta
// ============================================================

describe("validación de stock al vender (tarea 4.5)", () => {
  it("el vendedor no puede vender lo que no hay, y se le dice cuánto queda", async () => {
    const r = await post(
      "/api/sales",
      {
        items: [{ productId: pCable, qtyMilli: 999_000 }],
        payments: [{ method: "DEBIT", amount: 689_310 }],
      },
      tokenVendedor,
    );
    expect(r.statusCode).toBe(400);
    const msg = cuerpo(r).error as string;
    expect(msg).toMatch(/No hay stock suficiente/);
    expect(msg).toMatch(/Cable 2,5 mm: quedan/);
    expect(msg).toMatch(/administrador puede autorizar/);
  });

  it("con el PIN del administrador pasa, y queda registrado como STOCK_OVERRIDE", async () => {
    const antes = await db.auditLog.count({ where: { action: "STOCK_OVERRIDE" } });
    const r = await post(
      "/api/sales",
      {
        items: [{ productId: pCable, qtyMilli: 500_000 }],
        payments: [{ method: "DEBIT", amount: 345_000 }],
        adminPin: PIN_ADMIN,
      },
      tokenVendedor,
    );
    expect(r.statusCode).toBe(201);
    expect(await db.auditLog.count({ where: { action: "STOCK_OVERRIDE" } })).toBe(antes + 1);
    // Y el saldo quedó negativo, que es justamente lo que se autorizó.
    expect(await saldo(pCable)).toBeLessThan(0);
  });

  it("con el PIN equivocado no pasa", async () => {
    const r = await post(
      "/api/sales",
      {
        items: [{ productId: pCable, qtyMilli: 10_000 }],
        payments: [{ method: "DEBIT", amount: 6_900 }],
        adminPin: "000000",
      },
      tokenVendedor,
    );
    expect(r.statusCode).toBe(400);
    expect(cuerpo(r).error).toMatch(/PIN de administrador no es correcto/);
  });

  it("con stock.allowNegative en true no molesta a nadie", async () => {
    // Por `setSetting`, no escribiendo la fila a mano: el lector cachea, y
    // tocar la base por debajo dejaría el caché con el valor viejo.
    await setSetting("stock.allowNegative", true);
    const r = await post(
      "/api/sales",
      { items: [{ productId: pCable, qtyMilli: 1000 }], payments: [{ method: "DEBIT", amount: 690 }] },
      tokenVendedor,
    );
    expect(r.statusCode).toBe(201);
    await setSetting("stock.allowNegative", false);
  });

  it("el saldo negativo hace que la próxima compra fije el costo, no que lo promedie", async () => {
    // El saldo quedó bajo cero arriba. Promediar contra una deuda daría un
    // costo por debajo de lo que se acaba de pagar.
    expect(await saldo(pCable)).toBeLessThan(0);
    await post("/api/purchases", {
      supplierId: idProveedor,
      items: [{ productId: pCable, unitId: uRollo, qtyMilli: 10_000, unitCostNet: 60_000 }],
    });
    expect(await costo(pCable)).toBe(600_000);
  });
});

// ============================================================
// 4.7 — Reconciliación
// ============================================================

describe("reconciliación (tarea 4.7)", () => {
  it("detecta el descuadre, deja alerta y recién después corrige", async () => {
    await db.stockLevel.update({
      where: { productId_locationId: { productId: pPerno, locationId: idLocal } },
      data: { qtyBaseMilli: 7 },
    });

    const r = await post("/api/stock/reconcile", {});
    expect(r.statusCode).toBe(200);
    expect(cuerpo(r).divergencias).toBe(1);

    const alerta = await db.alert.findFirstOrThrow({ where: { type: "STOCK_RECONCILE_DIFF" }, orderBy: { id: "desc" } });
    expect(alerta.productId).toBe(pPerno);
    expect(alerta.severity).toBe("CRITICAL");
    expect(alerta.message).toMatch(/el caché decía/);

    // El libro manda: el saldo quedó recalculado desde los movimientos.
    const suma = await db.stockMovement.aggregate({
      where: { productId: pPerno, locationId: idLocal },
      _sum: { qtyBaseMilli: true },
    });
    expect(await saldo(pPerno)).toBe(suma._sum.qtyBaseMilli);
  });

  it("la segunda pasada no encuentra nada", async () => {
    const r = await post("/api/stock/reconcile", {});
    expect(cuerpo(r).divergencias).toBe(0);
    expect(cuerpo(r).mensaje).toMatch(/coincide con el libro/);
  });
});

// ============================================================
// 4.6 — Devoluciones y anulaciones
// ============================================================

describe("devolución y anulación (tarea 4.6)", () => {
  let idVenta: number, idLinea: number;

  beforeAll(async () => {
    // Una venta limpia: 10 pernos en efectivo.
    const r = await post(
      "/api/sales",
      {
        items: [{ productId: pPerno, qtyMilli: 10_000 }],
        payments: [{ method: "CASH", amount: 3_500, receivedAmount: 5_000 }],
      },
      tokenVendedor,
    );
    expect(r.statusCode).toBe(201);
    idVenta = cuerpo(r).venta.id;
    idLinea = cuerpo(r).venta.items[0].id;
  });

  it("el vendedor solo no puede: la devolución la autoriza un administrador", async () => {
    const r = await post(
      `/api/sales/${idVenta}/return`,
      { reason: "Le sobraron", items: [{ itemId: idLinea, qtyMilli: 1000 }] },
      tokenVendedor,
    );
    expect(r.statusCode).toBe(400);
    expect(cuerpo(r).error).toMatch(/autoriza un administrador/);
  });

  it("devolver 2 de 10 reingresa 2 al stock y saca la plata de la caja", async () => {
    const stockAntes = await saldo(pPerno);
    const cajaAntes = (await db.cashMovement.findFirstOrThrow({ orderBy: { id: "desc" } })).balanceAfter;

    const r = await post(`/api/sales/${idVenta}/return`, {
      reason: "Le sobraron dos",
      items: [{ itemId: idLinea, qtyMilli: 2000 }],
    });
    expect(r.statusCode).toBe(201);
    const dev = cuerpo(r).venta;

    expect(dev.reversalKind).toBe("RETURN");
    expect(dev.reversesId).toBe(idVenta);
    expect(dev.fiscalDocType).toBe("NOTA_CREDITO");
    expect(dev.totalGross).toBeLessThan(0);
    expect(await saldo(pPerno)).toBe(stockAntes + 2000);

    const caja = await db.cashMovement.findFirstOrThrow({ orderBy: { id: "desc" } });
    expect(caja.type).toBe("REFUND");
    expect(caja.balanceAfter).toBe(cajaAntes + caja.amount);
    expect(caja.amount).toBeLessThan(0);

    // La identidad de la que vive el arqueo: recibido − vuelto = amount.
    const pago = await db.salePayment.findFirstOrThrow({ where: { saleId: dev.id } });
    expect(pago.receivedAmount).not.toBeNull();
    expect(pago.changeAmount).not.toBeNull();
    expect(pago.receivedAmount! - pago.changeAmount!).toBe(pago.amount);

    // Reingresa como RETURN_IN, no como un ajuste sin explicación.
    const mov = await db.stockMovement.findFirstOrThrow({ where: { productId: pPerno }, orderBy: { id: "desc" } });
    expect(mov.type).toBe("RETURN_IN");
  });

  it("la segunda devolución parcial funciona, y la venta queda «con devoluciones»", async () => {
    const r = await post(`/api/sales/${idVenta}/return`, {
      reason: "Le sobró uno más",
      items: [{ itemId: idLinea, qtyMilli: 1000 }],
    });
    expect(r.statusCode).toBe(201);

    const detalle = cuerpo(await get(`/api/sales/${idVenta}`));
    expect(detalle.etiqueta).toBe("CON_DEVOLUCIONES");
    expect(detalle.lineas[0].returnedQtyMilli).toBe(3000);
    expect(detalle.lineas[0].vivoQtyMilli).toBe(7000);
  });

  it("no se devuelve más de lo que queda vivo", async () => {
    const r = await post(`/api/sales/${idVenta}/return`, {
      reason: "Todo y un poco más",
      items: [{ itemId: idLinea, qtyMilli: 8000 }],
    });
    expect(r.statusCode).toBe(400);
    expect(cuerpo(r).error).toMatch(/solo quedan 7/);
  });

  it("anular después de las parciales revierte solo lo que queda, y el par suma cero", async () => {
    const r = await post(`/api/sales/${idVenta}/void`, { reason: "El cliente se arrepintió del resto" });
    expect(r.statusCode).toBe(201);

    const original = await db.sale.findUniqueOrThrow({ where: { id: idVenta } });
    expect(original.status).toBe("REVERSED");

    // La suma de la venta y TODAS sus reversas es exactamente cero: de eso
    // vive la regla de que los reportes de plata no filtran por estado.
    const reversas = await db.sale.findMany({ where: { reversesId: idVenta } });
    expect(original.totalGross + reversas.reduce((t, v) => t + v.totalGross, 0)).toBe(0);

    // Y el costo también cuadra exacto contra el libro.
    const lineasOriginales = await db.saleItem.findMany({ where: { saleId: idVenta } });
    const lineasReversa = await db.saleItem.findMany({ where: { saleId: { in: reversas.map((v) => v.id) } } });
    expect(
      lineasOriginales.reduce((t, l) => t + l.lineCostNet, 0) + lineasReversa.reduce((t, l) => t + l.lineCostNet, 0),
    ).toBe(0);

    const detalle = cuerpo(await get(`/api/sales/${idVenta}`));
    expect(detalle.etiqueta).toBe("ANULADA");
  });

  it("una venta ya anulada no admite otra devolución", async () => {
    const r = await post(`/api/sales/${idVenta}/return`, {
      reason: "Otra vez",
      items: [{ itemId: idLinea, qtyMilli: 1000 }],
    });
    expect(r.statusCode).toBe(400);
    expect(cuerpo(r).error).toMatch(/ya está anulada/);
  });

  it("una devolución no se devuelve", async () => {
    const reversa = await db.sale.findFirstOrThrow({ where: { reversesId: idVenta } });
    const r = await post(`/api/sales/${reversa.id}/void`, { reason: "Nada" });
    expect(r.statusCode).toBe(400);
    expect(cuerpo(r).error).toMatch(/ya es una devolución/);
  });

  it("la fila de reversa se etiqueta como documento propio", async () => {
    const reversa = await db.sale.findFirstOrThrow({ where: { reversesId: idVenta } });
    const detalle = cuerpo(await get(`/api/sales/${reversa.id}`));
    expect(detalle.etiqueta).toBe("DEVOLUCION");
    expect(detalle.etiquetaTexto).toBe("Devolución");
  });

  it("no se puede devolver en efectivo más de lo que hay en el cajón", async () => {
    const venta = cuerpo(
      await post(
        "/api/sales",
        {
          items: [{ productId: pPerno, qtyMilli: 1000 }],
          payments: [{ method: "DEBIT", amount: 350 }],
        },
        tokenVendedor,
      ),
    ).venta;

    // Se vacía la caja por la puerta legítima: un retiro.
    const enCaja = (await db.cashMovement.findFirstOrThrow({ orderBy: { id: "desc" } })).balanceAfter;
    await post("/api/cash/movements", { type: "WITHDRAWAL", amount: enCaja, description: "Depósito al banco" });

    const r = await post(`/api/sales/${venta.id}/void`, { reason: "Anulada sin plata en caja" });
    expect(r.statusCode).toBe(400);
    expect(cuerpo(r).error).toMatch(/Registra un ingreso de efectivo/);

    // Por otro medio sí se puede: la plata no sale del cajón.
    const r2 = await post(`/api/sales/${venta.id}/void`, { reason: "Se devuelve por transferencia", refundMethod: "TRANSFER" });
    expect(r2.statusCode).toBe(201);
  });
});

// ============================================================
// Decisión sellada 18 — hasta cuándo se teclea el costo
// ============================================================

describe("el costo se teclea solo hasta que el libro lo fija (decisión 18)", () => {
  it("haber vendido no bloquea el costo: una venta no fija ningún costo", async () => {
    const p = await db.product.create({
      data: { sku: "FH-09001", name: "Silicona", saleUnitId: uUnidad, purchaseUnitId: uUnidad, priceGross: 3_000, costNetMilliPeso: 1_500_000, searchKey: "silicona" },
    });
    await db.stockLevel.create({ data: { productId: p.id, locationId: idLocal, qtyBaseMilli: 10_000 } });
    await post("/api/sales", { items: [{ productId: p.id, qtyMilli: 1000 }], payments: [{ method: "DEBIT", amount: 3_000 }] }, tokenVendedor);

    const r = await app.inject({
      method: "PATCH",
      url: `/api/products/${p.id}`,
      headers: como(tokenAdmin),
      payload: { costNetMilliPeso: 1_600_000 },
    });
    expect(r.statusCode).toBe(200);
  });

  it("haber comprado sí lo bloquea", async () => {
    const p = await db.product.findFirstOrThrow({ where: { sku: "FH-09001" } });
    await post("/api/purchases", {
      supplierId: idProveedor,
      items: [{ productId: p.id, unitId: uUnidad, qtyMilli: 5_000, unitCostNet: 1_700 }],
    });
    const r = await app.inject({
      method: "PATCH",
      url: `/api/products/${p.id}`,
      headers: como(tokenAdmin),
      payload: { costNetMilliPeso: 1 },
    });
    expect(r.statusCode).toBe(400);
    expect(cuerpo(r).error).toMatch(/ya lo manda el libro/);
  });
});

// ============================================================
// Demo de cierre del Sprint 4
// ============================================================

describe("demo de cierre del Sprint 4", () => {
  it("comprar un rollo, vender 7,5 m, devolver 2 y después 1 más", async () => {
    const p = await db.product.create({
      data: {
        sku: "FH-09100",
        name: "Cable demo",
        saleUnitId: uMetro,
        purchaseUnitId: uRollo,
        priceGross: 990,
        costNetMilliPeso: 0,
        searchKey: "cable demo",
      },
    });
    await db.stockLevel.create({ data: { productId: p.id, locationId: idLocal, qtyBaseMilli: 0 } });

    // 1. Un rollo de 100 m a $45.000 netos.
    expect((await post("/api/purchases", {
      supplierId: idProveedor,
      documentNumber: "F-9001",
      items: [{ productId: p.id, unitId: uRollo, qtyMilli: 1000, unitCostNet: 45_000 }],
    })).statusCode).toBe(201);
    expect(await saldo(p.id)).toBe(100_000);
    expect(await costo(p.id)).toBe(450_000); // $450 el metro

    // 2. Se venden 7,5 m.
    const venta = cuerpo(
      await post(
        "/api/sales",
        { items: [{ productId: p.id, qtyMilli: 7_500 }], payments: [{ method: "DEBIT", amount: 7_425 }] },
        tokenVendedor,
      ),
    ).venta;
    expect(await saldo(p.id)).toBe(92_500);

    // 3. El kardex lo cuenta: 92,5 m y el costo intacto.
    const k = cuerpo(await get(`/api/stock/${p.id}/kardex`));
    expect(k.saldoTexto).toBe("92,5 m");
    expect(k.movimientos[0].type).toBe("SALE");
    expect(k.movimientos[0].qtyMilli).toBe(-7_500);
    expect(k.movimientos[0].balanceCostNetMilliPeso).toBe(450_000);

    // 4. Devuelve 2 m.
    const linea = venta.items[0].id;
    expect((await post(`/api/sales/${venta.id}/return`, {
      reason: "Le sobraron dos metros",
      refundMethod: "TRANSFER",
      items: [{ itemId: linea, qtyMilli: 2_000 }],
    })).statusCode).toBe(201);
    expect(await saldo(p.id)).toBe(94_500);

    // 5. Y otro metro después: la segunda parcial también funciona.
    expect((await post(`/api/sales/${venta.id}/return`, {
      reason: "Y uno más",
      refundMethod: "TRANSFER",
      items: [{ itemId: linea, qtyMilli: 1_000 }],
    })).statusCode).toBe(201);
    expect(await saldo(p.id)).toBe(95_500);

    // 6. Devolver los 4,5 que quedan agota la venta: pasa a DEVUELTA sin que
    //    nadie la anule, y anularla después se rechaza porque ya no queda nada.
    expect((await post(`/api/sales/${venta.id}/return`, {
      reason: "Devolvió el resto",
      refundMethod: "TRANSFER",
      items: [{ itemId: linea, qtyMilli: 4_500 }],
    })).statusCode).toBe(201);
    expect(await saldo(p.id)).toBe(100_000);

    const detalle = cuerpo(await get(`/api/sales/${venta.id}`));
    expect(detalle.etiqueta).toBe("DEVUELTA");
    expect(detalle.venta.status).toBe("COMPLETED"); // sigue siendo una venta real por su monto

    const anular = await post(`/api/sales/${venta.id}/void`, { reason: "Ya no queda nada" });
    expect(anular.statusCode).toBe(400);
    expect(cuerpo(anular).error).toMatch(/ya se devolvió completa/);

    // 7. Las tres devoluciones suman exactamente la venta: ni un peso de más.
    const reversas = await db.sale.findMany({ where: { reversesId: venta.id } });
    expect(reversas.length).toBe(3);
    expect(venta.totalGross + reversas.reduce((t, v) => t + v.totalGross, 0)).toBe(0);

    // 8. Y el libro cierra el círculo: entró 100, salió 7,5, volvieron 7,5.
    const suma = await db.stockMovement.aggregate({ where: { productId: p.id }, _sum: { qtyBaseMilli: true } });
    expect(suma._sum.qtyBaseMilli).toBe(100_000);
  });
});
