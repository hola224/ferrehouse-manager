import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { db } from "../db.js";
import { SKU_COUNTER, netFromGross } from "@ferrehouse/shared";
import { PIN_ADMIN, PIN_VENDEDOR } from "../test-setup.js";
import { cuadrarFolios, hoyTexto } from "../reports.js";
import { haceCuanto } from "../alerts.js";
import { registrarMovimiento } from "../stock-ledger.js";

let app: FastifyInstance;
let tokenAdmin: string, tokenVendedor: string;
let idCaja1: number, idLocal: number, idProveedor: number, idVendedor: number;
let uMetro: number, uRollo: number, uUnidad: number;
let pCable: number, pPerno: number, pViejo: number;
let catElectrico: number;

const HOY = hoyTexto();
const AYER = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return hoyTexto(d);
})();

beforeAll(async () => {
  app = await buildApp({ jwtSecret: "test-secret" });
  await app.ready();

  idLocal = (await db.location.findFirstOrThrow({ where: { isDefault: true } })).id;
  idCaja1 = (await db.station.findFirstOrThrow({ where: { name: "CAJA-1" } })).id;

  const longitud = await db.unitGroup.create({ data: { name: "LONGITUD", allowsFraction: true } });
  const conteo = await db.unitGroup.create({ data: { name: "CONTEO", allowsFraction: false } });
  uMetro = (await db.unit.create({ data: { groupId: longitud.id, name: "Metro", symbol: "m", factorMilli: 1000, isBase: true } })).id;
  uRollo = (await db.unit.create({ data: { groupId: longitud.id, name: "Rollo 100 m", symbol: "rl100", factorMilli: 100_000 } })).id;
  uUnidad = (await db.unit.create({ data: { groupId: conteo.id, name: "Unidad", symbol: "un", factorMilli: 1000, isBase: true } })).id;
  await db.counter.create({ data: { name: SKU_COUNTER, value: 0 } });

  idProveedor = (await db.supplier.create({ data: { name: "Distribuidora Bío-Bío" } })).id;
  catElectrico = (await db.category.create({ data: { name: "Eléctrico" } })).id;
  const catFierro = (await db.category.create({ data: { name: "Fierretería" } })).id;

  const crearProducto = async (n: {
    name: string; sku: string; unit: number; price: number; costo: number; stock?: number;
    categoryId?: number; minimo?: number; descontinuado?: boolean;
  }) => {
    const p = await db.product.create({
      data: {
        sku: n.sku, name: n.name, saleUnitId: n.unit, purchaseUnitId: n.unit, priceGross: n.price,
        costNetMilliPeso: n.costo, searchKey: n.name.toLowerCase(), categoryId: n.categoryId ?? null,
        reorderLevelBaseMilli: n.minimo ?? 0,
        deletedAt: n.descontinuado ? new Date() : null,
      },
    });
    await db.stockLevel.create({ data: { productId: p.id, locationId: idLocal, qtyBaseMilli: n.stock ?? 0 } });
    return p.id;
  };

  // Cable: se compra por rollo y se vende por metro. Mínimo 20 m.
  pCable = await crearProducto({ name: "Cable 2,5 mm", sku: "FH-00001", unit: uMetro, price: 690, costo: 0, categoryId: catElectrico, minimo: 20_000 });
  pPerno = await crearProducto({ name: "Perno 5/8", sku: "FH-00002", unit: uUnidad, price: 350, costo: 180_000, stock: 100_000, categoryId: catFierro });
  // Nace activo: se vende hoy y se descontinúa en la tarea 5.2, que es el
  // orden real de los hechos y el único que permite probar que sobrevive.
  pViejo = await crearProducto({ name: "Ampolleta incandescente", sku: "FH-00003", unit: uUnidad, price: 990, costo: 400_000, stock: 20_000, categoryId: catElectrico });

  const idAdmin = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  idVendedor = (await db.user.findFirstOrThrow({ where: { role: "SELLER", active: true } })).id;
  const entrar = async (userId: number, pin: string) =>
    JSON.parse((await app.inject({ method: "POST", url: "/api/auth/login", payload: { userId, pin, stationId: idCaja1 } })).body).token as string;
  tokenAdmin = await entrar(idAdmin, PIN_ADMIN);
  tokenVendedor = await entrar(idVendedor, PIN_VENDEDOR);

  await app.inject({ method: "POST", url: "/api/cash/open", headers: { authorization: `Bearer ${tokenVendedor}` }, payload: { openingAmount: 50_000 } });

  // Un rollo de cable comprado AYER: $45.000 = $450 el metro.
  const ayer = new Date();
  ayer.setDate(ayer.getDate() - 1);
  await app.inject({
    method: "POST", url: "/api/purchases", headers: { authorization: `Bearer ${tokenAdmin}` },
    payload: { supplierId: idProveedor, documentNumber: "F-8891", receivedAt: ayer.toISOString(),
      items: [{ productId: pCable, unitId: uRollo, qtyMilli: 1000, unitCostNet: 45_000 }] },
  });
});

const como = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (url: string, payload: unknown, t = tokenAdmin) =>
  app.inject({ method: "POST", url, headers: como(t), payload: payload as object });
const get = (url: string, t = tokenAdmin) => app.inject({ method: "GET", url, headers: como(t) });
const cuerpo = (r: { body: string }) => JSON.parse(r.body);
const vender = (payload: Record<string, unknown>, t = tokenVendedor) => post("/api/sales", payload, t);

// ============================================================
// 5.4 — Cuadratura de folios (la función, sin base de datos)
// ============================================================

describe("cuadratura de folios (tarea 5.4)", () => {
  it("cada tipo de documento numera aparte", () => {
    // La boleta 120 y la factura 120 conviven: mezclarlas inventaría un
    // duplicado que no existe y escondería los huecos de cada serie.
    const r = cuadrarFolios([
      { fiscalDocType: "BOLETA", fiscalFolio: "120" },
      { fiscalDocType: "FACTURA", fiscalFolio: "120" },
    ]);
    expect(r.series).toHaveLength(2);
    expect(r.series.every((s) => s.duplicados.length === 0)).toBe(true);
  });

  it("acusa el hueco que quedó dentro de la serie", () => {
    const r = cuadrarFolios([
      { fiscalDocType: "BOLETA", fiscalFolio: "100" },
      { fiscalDocType: "BOLETA", fiscalFolio: "101" },
      { fiscalDocType: "BOLETA", fiscalFolio: "103" },
    ]);
    expect(r.series[0]!.huecos).toEqual([102]);
    expect(r.series[0]!.desde).toBe(100);
    expect(r.series[0]!.hasta).toBe(103);
  });

  it("no inventa un hueco entre el último de ayer y el primero de hoy", () => {
    // Solo se buscan huecos DENTRO del mínimo y el máximo observados: entre
    // el folio 100 de ayer y el 340 de hoy no hay hueco, hay noche.
    const r = cuadrarFolios([{ fiscalDocType: "BOLETA", fiscalFolio: "340" }]);
    expect(r.series[0]!.huecos).toEqual([]);
  });

  it("acusa el folio repetido, sin impedir que exista", () => {
    // POS-07: se acusa en el reporte y no con un `unique` en la base, que
    // impediría corregir el tipeo que casi siempre lo causa.
    const r = cuadrarFolios([
      { fiscalDocType: "BOLETA", fiscalFolio: "12" },
      { fiscalDocType: "BOLETA", fiscalFolio: "12" },
    ]);
    expect(r.series[0]!.duplicados).toEqual([{ folio: 12, veces: 2 }]);
  });

  it("una venta sin documento tributario no es un hueco", () => {
    const r = cuadrarFolios([
      { fiscalDocType: "NONE", fiscalFolio: null },
      { fiscalDocType: null, fiscalFolio: null },
      { fiscalDocType: "BOLETA", fiscalFolio: "  " },
    ]);
    expect(r.sinFolio).toBe(3);
    expect(r.series).toEqual([]);
  });

  it("un folio con letras se informa aparte en vez de romper la serie", () => {
    const r = cuadrarFolios([
      { fiscalDocType: "BOLETA", fiscalFolio: "A-77" },
      { fiscalDocType: "BOLETA", fiscalFolio: "78" },
    ]);
    expect(r.series[0]!.noNumericos).toEqual(["A-77"]);
    expect(r.series[0]!.huecos).toEqual([]);
  });
});

// ============================================================
// 5.1 — Reporte de ventas
// ============================================================

describe("reporte de ventas del día (tarea 5.1)", () => {
  beforeAll(async () => {
    // 7,5 m de cable en efectivo, con boleta.
    await vender({
      items: [{ productId: pCable, qtyMilli: 7_500 }],
      payments: [{ method: "CASH", receivedAmount: 10_000 }],
      fiscalDocType: "BOLETA", fiscalFolio: "1001",
    });
    // 10 pernos con débito, con boleta.
    await vender({
      items: [{ productId: pPerno, qtyMilli: 10_000 }],
      payments: [{ method: "DEBIT", amount: 3_500 }],
      fiscalDocType: "BOLETA", fiscalFolio: "1002",
    });
    // Una con descuento, pagada mitad y mitad.
    await vender({
      items: [{ productId: pPerno, qtyMilli: 20_000 }, { productId: pCable, qtyMilli: 3_000 }],
      discountAmount: 400, // 4,4% del subtotal: dentro del tope del vendedor
      payments: [{ method: "CASH", receivedAmount: 5_000 }, { method: "DEBIT", amount: 4_640 }],
      fiscalDocType: "BOLETA", fiscalFolio: "1004",
    });
  });

  it("el desglose neto + IVA da exactamente el total", async () => {
    const r = cuerpo(await get(`/api/reports/sales?desde=${HOY}`));
    expect(r.neto + r.iva).toBe(r.total);
    expect(r.documentos).toBe(3);
  });

  it("la suma por medio de pago es el total del día", async () => {
    // Vive de que Σ pagos de una venta sea exactamente su totalGross
    // (decisión sellada 8). Si algún día deja de serlo, esto lo acusa.
    const r = cuerpo(await get(`/api/reports/sales?desde=${HOY}`));
    const suma = r.porMedio.reduce((n: number, m: { monto: number }) => n + m.monto, 0);
    expect(suma).toBe(r.total);
  });

  it("la suma por vendedor es el total del día", async () => {
    const r = cuerpo(await get(`/api/reports/sales?desde=${HOY}`));
    const suma = r.porVendedor.reduce((n: number, v: { monto: number }) => n + v.monto, 0);
    expect(suma).toBe(r.total);
  });

  it("el hueco de folio del día se acusa en el mismo reporte", async () => {
    // Se emitieron 1001, 1002 y 1004: falta el 1003.
    const r = cuerpo(await get(`/api/reports/sales?desde=${HOY}`));
    const boletas = r.folios.series.find((s: { tipo: string }) => s.tipo === "BOLETA");
    expect(boletas.huecos).toEqual([1003]);
  });

  it("al vendedor no le llega el reporte: lleva costo en cada fila", async () => {
    expect((await get(`/api/reports/sales?desde=${HOY}`, tokenVendedor)).statusCode).toBe(403);
    expect((await get(`/api/reports/margins?desde=${HOY}`, tokenVendedor)).statusCode).toBe(403);
    expect((await get(`/api/reports/inventory`, tokenVendedor)).statusCode).toBe(403);
  });

  it("una fecha mal escrita se rechaza con un mensaje entendible", async () => {
    const r = await get("/api/reports/sales?desde=30-07-2026");
    expect(r.statusCode).toBe(400);
    expect(JSON.stringify(cuerpo(r))).toMatch(/2026-07-30/);
  });
});

// ============================================================
// 5.2 — Margen por producto y por categoría
// ============================================================

describe("margen por producto y por categoría (tarea 5.2)", () => {
  it("el margen por producto suma exactamente el margen del día", async () => {
    // Es lo que hace que los dos reportes se puedan mirar juntos. Calculados
    // por separado darían cifras parecidas y distintas, que es lo peor.
    const ventas = cuerpo(await get(`/api/reports/sales?desde=${HOY}`));
    const margenes = cuerpo(await get(`/api/reports/margins?desde=${HOY}`));
    expect(margenes.margen).toBe(ventas.margen);
    expect(margenes.neto).toBe(ventas.neto);
  });

  it("por categoría suma lo mismo que por producto", async () => {
    const porProducto = cuerpo(await get(`/api/reports/margins?desde=${HOY}&por=producto`));
    const porCategoria = cuerpo(await get(`/api/reports/margins?desde=${HOY}&por=categoria`));
    expect(porCategoria.margen).toBe(porProducto.margen);
    expect(porCategoria.filas.length).toBeLessThan(porProducto.filas.length + 1);
  });

  it("el cable vendido por metro reporta metros, no milésimas sueltas", async () => {
    const r = cuerpo(await get(`/api/reports/margins?desde=${HOY}`));
    const cable = r.filas.find((f: { id: number }) => f.id === pCable);
    expect(cable.cantidad).toBe("10,5 m"); // 7,5 + 3
  });

  it("un producto descontinuado sigue apareciendo en el histórico", async () => {
    // El orden real: se vendió cuando estaba vivo y se descontinuó después.
    // El schema promete que `deletedAt` sobrevive en los reportes; si se
    // filtrara, el margen del mes pasado cambiaría solo cuando alguien limpia
    // el catálogo.
    await vender({
      items: [{ productId: pViejo, qtyMilli: 2_000 }],
      payments: [{ method: "CASH", receivedAmount: 2_000 }],
    });
    await db.product.update({ where: { id: pViejo }, data: { deletedAt: new Date(), active: false } });

    const r = cuerpo(await get(`/api/reports/margins?desde=${HOY}`));
    const fila = r.filas.find((f: { id: number }) => f.id === pViejo);
    expect(fila).toBeDefined();
    expect(fila.detalle).toMatch(/descontinuado/);
  });

  it("el margen en porcentaje va sobre la venta neta", async () => {
    const r = cuerpo(await get(`/api/reports/margins?desde=${HOY}`));
    const fila = r.filas.find((f: { id: number }) => f.id === pPerno);
    expect(fila.margenPct).toBeCloseTo(((fila.neto - fila.costo) / fila.neto) * 100, 1);
  });
});

// ============================================================
// 5.3 — Inventario valorizado a la fecha
// ============================================================

describe("inventario valorizado (tarea 5.3)", () => {
  it("a la fecha de ayer entra la compra, no las ventas de hoy", async () => {
    // La compra se fechó con su recepción (ayer) y las ventas son de hoy.
    const ayer = cuerpo(await get(`/api/reports/inventory?fecha=${AYER}`));
    const cable = ayer.filas.find((f: { productId: number }) => f.productId === pCable);
    expect(cable.qtyBaseMilli).toBe(100_000); // el rollo entero
    expect(cable.valorNeto).toBe(45_000);
  });

  it("hoy el mismo cable vale menos: se vendieron 10,5 m", async () => {
    const hoy = cuerpo(await get(`/api/reports/inventory?fecha=${HOY}`));
    const cable = hoy.filas.find((f: { productId: number }) => f.productId === pCable);
    expect(cable.qtyBaseMilli).toBe(100_000 - 10_500);
    // 89,5 m a $450 el metro
    expect(cable.valorNeto).toBe(45_000 - 4_725);
  });

  it("el total es la suma de las filas, sin excepciones", async () => {
    const r = cuerpo(await get(`/api/reports/inventory?fecha=${HOY}`));
    expect(r.filas.reduce((n: number, f: { valorNeto: number }) => n + f.valorNeto, 0)).toBe(r.total);
  });

  it("un producto vendido bajo cero se muestra en negativo, no se esconde", async () => {
    // Esconderlo haría que el valorizado no cuadre contra el libro, que es lo
    // único que este reporte promete.
    const pFantasma = (await db.product.create({
      data: { sku: "FH-09999", name: "Silicona sin cargar", saleUnitId: uUnidad, purchaseUnitId: uUnidad,
        priceGross: 2_990, costNetMilliPeso: 1_500_000, searchKey: "silicona" },
    })).id;
    await db.stockLevel.create({ data: { productId: pFantasma, locationId: idLocal, qtyBaseMilli: 0 } });
    await db.setting.update({ where: { key: "stock.allowNegative" }, data: { value: "true" } }).catch(() => {});
    const { setSetting } = await import("../settings.js");
    await setSetting("stock.allowNegative", true);

    await vender({
      items: [{ productId: pFantasma, qtyMilli: 2_000 }],
      payments: [{ method: "CASH", receivedAmount: 6_000 }],
    });
    await setSetting("stock.allowNegative", false);

    const r = cuerpo(await get(`/api/reports/inventory?fecha=${HOY}`));
    const fila = r.filas.find((f: { productId: number }) => f.productId === pFantasma);
    expect(fila.qtyBaseMilli).toBe(-2_000);
    expect(r.bajoCero).toBeGreaterThan(0);
  });
});

// ============================================================
// 5.5 y 5.6 — Alertas
// ============================================================

describe("alertas de stock (tarea 5.5)", () => {
  it("caer bajo el mínimo levanta la alerta, en el mismo movimiento", async () => {
    // Quedan 89,5 m y el mínimo son 20 m: se venden 75 m para cruzarlo.
    await vender({
      items: [{ productId: pCable, qtyMilli: 75_000 }],
      payments: [{ method: "CASH", receivedAmount: 60_000 }],
    });
    const alertas = cuerpo(await get("/api/alerts")).alertas;
    const baja = alertas.find((a: { type: string; ref: { id: number } | null }) => a.type === "LOW_STOCK" && a.ref?.id === pCable);
    expect(baja).toBeDefined();
    expect(baja.message).toMatch(/bajo el mínimo/);
  });

  it("seguir vendiendo no la duplica", async () => {
    await vender({
      items: [{ productId: pCable, qtyMilli: 1_000 }],
      payments: [{ method: "CASH", receivedAmount: 1_000 }],
    });
    const abiertas = await db.alert.count({ where: { type: "LOW_STOCK", productId: pCable, resolvedAt: null } });
    expect(abiertas).toBe(1);
  });

  it("el quiebre reemplaza a la de stock bajo: nunca las dos a la vez", async () => {
    // Dos alertas abiertas del mismo producto diciendo cosas distintas es
    // exactamente lo que hace que nadie mire el panel.
    await vender({
      items: [{ productId: pCable, qtyMilli: 13_500 }], // deja el saldo en cero
      payments: [{ method: "CASH", receivedAmount: 15_000 }],
    });
    expect(await db.alert.count({ where: { type: "LOW_STOCK", productId: pCable, resolvedAt: null } })).toBe(0);
    expect(await db.alert.count({ where: { type: "OUT_OF_STOCK", productId: pCable, resolvedAt: null } })).toBe(1);
  });

  it("reponer la cierra sola: una alerta vencida es una mentira en pantalla", async () => {
    await post("/api/purchases", {
      supplierId: idProveedor,
      items: [{ productId: pCable, unitId: uRollo, qtyMilli: 1000, unitCostNet: 50_000 }],
    });
    expect(await db.alert.count({ where: { productId: pCable, resolvedAt: null } })).toBe(0);
  });

  it("un producto descontinuado no alerta: no se va a reponer", async () => {
    /**
     * Se escribe el movimiento directo en el libro porque ninguna ruta deja
     * vender ni ajustar un producto descontinuado. Igual es alcanzable: una
     * devolución opera sobre las líneas de la venta original y no vuelve a
     * mirar `deletedAt`, así que un movimiento sí puede llegar acá.
     */
    await db.$transaction(async (tx) =>
      registrarMovimiento(tx, {
        productId: pViejo,
        locationId: idLocal,
        type: "SHRINKAGE",
        qtyBaseMilli: 18_000,
        userId: idVendedor,
        reason: "Se quebraron en la bodega",
      }),
    );
    expect(await db.alert.count({ where: { productId: pViejo, resolvedAt: null } })).toBe(0);
  });

  it("resolver a mano la saca del panel pero no la borra", async () => {
    const alerta = await db.alert.create({
      data: { type: "LOW_STOCK", severity: "WARNING", productId: pPerno, locationId: idLocal, message: "prueba" },
    });
    const r = await post(`/api/alerts/${alerta.id}/resolve`, {});
    expect(r.statusCode).toBe(200);
    expect(cuerpo(r).yaEstaba).toBe(false);

    const guardada = await db.alert.findUniqueOrThrow({ where: { id: alerta.id } });
    expect(guardada.resolvedAt).not.toBeNull();

    const panel = cuerpo(await get("/api/alerts")).alertas;
    expect(panel.find((a: { id: number }) => a.id === alerta.id)).toBeUndefined();
  });

  it("el panel es solo del administrador", async () => {
    expect((await get("/api/alerts", tokenVendedor)).statusCode).toBe(403);
  });
});

describe("venta en espera añeja (tarea 5.6)", () => {
  it("se deriva al leer: no se guarda ninguna fila", async () => {
    /**
     * No hay evento que dispararla —que pase el tiempo no es un evento—, así
     * que persistirla obligaría a un barrido periódico que escribiría la
     * misma alerta veinte veces mientras la espera sigue ahí.
     */
    const vieja = new Date(Date.now() - 72 * 3_600_000);
    await db.suspendedSale.create({
      data: { locationId: idLocal, userId: idVendedor, label: "Sr. camioneta azul", createdAt: vieja, touchedAt: vieja },
    });

    const panel = cuerpo(await get("/api/alerts")).alertas;
    const aneja = panel.find((a: { type: string }) => a.type === "SUSPENDED_SALE_STALE");
    expect(aneja).toBeDefined();
    expect(aneja.id).toBeNull(); // no vive en la base
    expect(aneja.message).toMatch(/3 días/);
    expect(await db.alert.count({ where: { type: "SUSPENDED_SALE_STALE" } })).toBe(0);
  });

  it("una espera de hoy no alerta", async () => {
    await db.suspendedSale.create({ data: { locationId: idLocal, userId: idVendedor, label: "Don Luis" } });
    const panel = cuerpo(await get("/api/alerts")).alertas;
    const cuantas = panel.filter((a: { type: string }) => a.type === "SUSPENDED_SALE_STALE").length;
    expect(cuantas).toBe(1); // solo la de camioneta azul
  });

  it("cuenta en horas hasta los dos días, y después en días", () => {
    const ahora = new Date(2026, 6, 30, 12, 0);
    expect(haceCuanto(new Date(2026, 6, 29, 12, 0), ahora)).toBe("24 horas");
    expect(haceCuanto(new Date(2026, 6, 27, 12, 0), ahora)).toBe("3 días");
  });
});

// ============================================================
// 5.7 — Dashboard
// ============================================================

describe("dashboard (tarea 5.7)", () => {
  it("el administrador ve los cuatro datos y no cuarenta", async () => {
    const d = cuerpo(await get("/api/dashboard"));
    expect(d.dia.total).toBeTypeOf("number");
    expect(d.dia.margen).toBeTypeOf("number");
    expect(d.caja.abierta).toBe(true);
    expect(d.alertas.total).toBeTypeOf("number");
    expect(d.alertas.primeras.length).toBeLessThanOrEqual(5);
  });

  it("el margen del dashboard es el mismo del reporte", async () => {
    const d = cuerpo(await get("/api/dashboard"));
    const r = cuerpo(await get(`/api/reports/sales?desde=${HOY}`));
    expect(d.dia.margen).toBe(r.margen);
    expect(d.dia.total).toBe(r.total);
  });

  it("al vendedor no le viaja la venta del día: el arqueo es a ciegas", async () => {
    const d = cuerpo(await get("/api/dashboard", tokenVendedor));
    expect(d.rol).toBe("SELLER");
    expect(JSON.stringify(d)).not.toMatch(/margen|total/i);
    expect(d.misDocumentos).toBeTypeOf("number");
  });
});

// ============================================================
// Demo de cierre del Sprint 5
// ============================================================

describe("demo de cierre del Sprint 5", () => {
  it("anular una venta del día baja el total solo, sin tocar nada más", async () => {
    const antes = cuerpo(await get(`/api/reports/sales?desde=${HOY}`));

    const venta = cuerpo(await vender({
      items: [{ productId: pPerno, qtyMilli: 4_000 }],
      payments: [{ method: "CASH", receivedAmount: 1_400 }],
      fiscalDocType: "BOLETA", fiscalFolio: "1010",
    }));
    const conVenta = cuerpo(await get(`/api/reports/sales?desde=${HOY}`));
    expect(conVenta.total).toBeGreaterThan(antes.total);

    const anulacion = await post(`/api/sales/${venta.venta.id}/void`, { reason: "El cliente se arrepintió" });
    expect(anulacion.statusCode).toBe(201);

    /**
     * El total vuelve EXACTO al de antes, sin filtrar por estado: la
     * anulación es una fila más, de signo contrario (ADR-002). Y el neto y el
     * margen vuelven igual, que es lo que prueba que el desglose es simétrico
     * hasta el peso.
     */
    const despues = cuerpo(await get(`/api/reports/sales?desde=${HOY}`));
    expect(despues.total).toBe(antes.total);
    expect(despues.neto).toBe(antes.neto);
    expect(despues.iva).toBe(antes.iva);
    expect(despues.margen).toBe(antes.margen);
    expect(despues.documentos).toBe(antes.documentos + 2); // la venta y su anulación
    expect(despues.neto + despues.iva).toBe(despues.total);
  });

  it("el margen por producto también vuelve a su lugar", async () => {
    const r = cuerpo(await get(`/api/reports/margins?desde=${HOY}`));
    const ventas = cuerpo(await get(`/api/reports/sales?desde=${HOY}`));
    expect(r.margen).toBe(ventas.margen);
    expect(r.filas.reduce((n: number, f: { neto: number }) => n + f.neto, 0)).toBe(ventas.neto);
  });

  it("el neto del día es el que declara el documento, no una suma de líneas", async () => {
    // El IVA es por residuo sobre el total de CADA venta (decisión sellada
    // 1). El del día es la suma de esos netos, no el neto de la suma: es lo
    // que el SII espera, porque suma documentos.
    const ventas = await db.sale.findMany({ where: { locationId: idLocal }, select: { totalGross: true } });
    const esperado = ventas.reduce((n, v) => n + netFromGross(v.totalGross, 19), 0);
    const r = cuerpo(await get(`/api/reports/sales?desde=${HOY}`));
    expect(r.neto).toBe(esperado);
  });
});
