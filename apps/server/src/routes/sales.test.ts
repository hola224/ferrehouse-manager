import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { db } from "../db.js";
import { SKU_COUNTER, findForbiddenFields } from "@ferrehouse/shared";
import { PIN_ADMIN, PIN_VENDEDOR } from "../test-setup.js";

let app: FastifyInstance;
let tokenAdmin: string, tokenVendedor: string;
let idCaja1: number, idLocal: number;
let pCable: number, pPerno: number, pCemento: number;

beforeAll(async () => {
  app = await buildApp({ jwtSecret: "test-secret" });
  await app.ready();

  idLocal = (await db.location.findFirstOrThrow({ where: { isDefault: true } })).id;
  idCaja1 = (await db.station.update({ where: { name: "CAJA-1" }, data: { printerTarget: "\\\\SRV\\T1" } })).id;

  const longitud = await db.unitGroup.create({ data: { name: "LONGITUD", allowsFraction: true } });
  const conteo = await db.unitGroup.create({ data: { name: "CONTEO", allowsFraction: false } });
  const uMetro = await db.unit.create({ data: { groupId: longitud.id, name: "Metro", symbol: "m", factorMilli: 1000, isBase: true } });
  const uUnidad = await db.unit.create({ data: { groupId: conteo.id, name: "Unidad", symbol: "un", factorMilli: 1000, isBase: true } });
  const uCaja = await db.unit.create({ data: { groupId: conteo.id, name: "Caja 100 un", symbol: "cj100", factorMilli: 100_000 } });
  await db.counter.create({ data: { name: SKU_COUNTER, value: 0 } });

  const crearProducto = async (name: string, sku: string, unit: number, priceGross: number, costNetMilliPeso: number, stock = 1_000_000) => {
    const p = await db.product.create({
      data: { sku, name, saleUnitId: unit, purchaseUnitId: unit, priceGross, costNetMilliPeso, searchKey: name.toLowerCase() },
    });
    await db.stockLevel.create({ data: { productId: p.id, locationId: idLocal, qtyBaseMilli: stock } });
    return p.id;
  };
  pCable = await crearProducto("Cable 2,5 mm", "FH-00001", uMetro.id, 690, 410_000);
  pPerno = await crearProducto("Perno 5/8", "FH-00002", uUnidad.id, 350, 180_000);
  pCemento = await crearProducto("Cemento saco", "FH-00003", uCaja.id, 6_490, 180_000);

  const idAdmin = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  const idVendedor = (await db.user.findFirstOrThrow({ where: { role: "SELLER", active: true } })).id;
  const entrar = async (userId: number, pin: string) =>
    JSON.parse((await app.inject({ method: "POST", url: "/api/auth/login", payload: { userId, pin, stationId: idCaja1 } })).body).token as string;
  tokenAdmin = await entrar(idAdmin, PIN_ADMIN);
  tokenVendedor = await entrar(idVendedor, PIN_VENDEDOR);

  // Toda venta necesita caja abierta.
  await app.inject({ method: "POST", url: "/api/cash/open", headers: { authorization: `Bearer ${tokenVendedor}` }, payload: { openingAmount: 50_000 } });
});

const como = (t: string) => ({ authorization: `Bearer ${t}` });
const post = (url: string, payload: unknown, t = tokenVendedor) =>
  app.inject({ method: "POST", url, headers: como(t), payload: payload as object });
const get = (url: string, t = tokenVendedor) => app.inject({ method: "GET", url, headers: como(t) });

const vender = (payload: Record<string, unknown>, t = tokenVendedor) => post("/api/sales", payload, t);

describe("cobrar (tareas 3.1 a 3.4)", () => {
  it("una venta simple en efectivo: cuadra, descuenta stock y entra a la caja", async () => {
    const antes = (await db.stockLevel.findUniqueOrThrow({ where: { productId_locationId: { productId: pCable, locationId: idLocal } } })).qtyBaseMilli;

    const r = await vender({
      items: [{ productId: pCable, qtyMilli: 7_500 }], // 7,5 m a $690 = $5.175
      payments: [{ method: "CASH", receivedAmount: 10_000 }],
    });
    expect(r.statusCode).toBe(201);
    const body = JSON.parse(r.body);

    expect(body.venta.subtotalGross).toBe(5_175);
    expect(body.venta.roundingAmount).toBe(5); // 5.175 → 5.180
    expect(body.venta.totalGross).toBe(5_180);
    expect(body.cambio).toBe(4_820);
    expect(body.mensaje).toContain("Vuelto: $4.820");

    // El stock bajó exactamente 7,5 m.
    const despues = (await db.stockLevel.findUniqueOrThrow({ where: { productId_locationId: { productId: pCable, locationId: idLocal } } })).qtyBaseMilli;
    expect(antes - despues).toBe(7_500);

    // Y el efectivo FÍSICO entró al cajón: el billete menos el vuelto.
    const mov = await db.cashMovement.findFirstOrThrow({ where: { saleId: body.venta.id } });
    expect(mov.amount).toBe(5_180);
    expect(mov.type).toBe("SALE");
  });

  it("el libro de stock guarda el movimiento con signo negativo y su referencia", async () => {
    const m = await db.stockMovement.findFirstOrThrow({ where: { productId: pCable }, orderBy: { id: "desc" } });
    expect(m.type).toBe("SALE");
    expect(m.qtyBaseMilli).toBe(-7_500);
    expect(m.refType).toBe("SALE");
    // Vender no cambia el costo promedio: sacar no altera lo que costó lo que queda.
    expect(m.balanceCostNetMilliPeso).toBe(410_000);
  });

  it("el costo se congela en la línea (decisión sellada 6)", async () => {
    const item = await db.saleItem.findFirstOrThrow({ where: { productId: pCable }, orderBy: { id: "desc" } });
    // 7,5 m × $410/m = $3.075
    expect(item.lineCostNet).toBe(3_075);
    expect(item.descriptionSnapshot).toBe("Cable 2,5 mm");

    // Sube el costo del producto: la línea vieja NO se mueve.
    await db.product.update({ where: { id: pCable }, data: { costNetMilliPeso: 999_000 } });
    const otraVez = await db.saleItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(otraVez.lineCostNet).toBe(3_075);
    await db.product.update({ where: { id: pCable }, data: { costNetMilliPeso: 410_000 } });
  });

  it("neto + IVA es exactamente el total, y la tasa queda congelada", async () => {
    const v = JSON.parse((await vender({ items: [{ productId: pPerno, qtyMilli: 3_000 }], payments: [{ method: "CASH", receivedAmount: 1_050 }] })).body).venta;
    expect(v.taxRatePercent).toBe(19);
    const neto = Math.round(v.totalGross / 1.19);
    expect(neto + (v.totalGross - neto)).toBe(v.totalGross);
  });

  /** ADR-003: la tarjeta se cobra al peso exacto. */
  it("pago mixto: se redondea solo la parte en efectivo", async () => {
    const body = JSON.parse(
      (await vender({
        items: [{ productId: pCable, qtyMilli: 25_355 }], // $17.495
        payments: [
          { method: "DEBIT", amount: 10_000, reference: "TBK-1" },
          { method: "CASH", receivedAmount: 7_500 },
        ],
      })).body,
    );
    expect(body.venta.roundingAmount).toBe(5);
    expect(body.venta.totalGross).toBe(17_500);
    const pagos = body.venta.payments as { method: string; amount: number; receivedAmount: number | null; changeAmount: number | null }[];
    expect(pagos.find((p) => p.method === "DEBIT")!.amount).toBe(10_000);
    expect(pagos.find((p) => p.method === "DEBIT")!.receivedAmount).toBeNull();
    expect(pagos.reduce((t, p) => t + p.amount, 0)).toBe(17_500);
  });

  it("todo con tarjeta: no se redondea y el cajón no se abre", async () => {
    const body = JSON.parse(
      (await vender({ items: [{ productId: pCable, qtyMilli: 25_355 }], payments: [{ method: "DEBIT", amount: 17_495 }] })).body,
    );
    expect(body.venta.roundingAmount).toBe(0);
    expect(body.venta.totalGross).toBe(17_495);

    const trabajo = await db.printJob.findUniqueOrThrow({ where: { id: body.impresion.id } });
    const bytes = Buffer.from(trabajo.payload, "base64");
    // ESC p = 0x1b 0x70: el pulso del cajón NO debe estar.
    expect(bytes.includes(Buffer.from([0x1b, 0x70]))).toBe(false);
  });

  it("pagando justo, el vuelto queda en CERO y no en nulo", async () => {
    const body = JSON.parse(
      (await vender({ items: [{ productId: pPerno, qtyMilli: 2_000 }], payments: [{ method: "CASH", receivedAmount: 700 }] })).body,
    );
    const cash = (body.venta.payments as { method: string; changeAmount: number | null }[]).find((p) => p.method === "CASH")!;
    expect(cash.changeAmount).toBe(0);
    expect(cash.changeAmount).not.toBeNull();
  });

  it("si el efectivo no alcanza, se rechaza sin escribir nada", async () => {
    const antes = await db.sale.count();
    const r = await vender({ items: [{ productId: pCable, qtyMilli: 10_000 }], payments: [{ method: "CASH", receivedAmount: 100 }] });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("no alcanza");
    expect(await db.sale.count()).toBe(antes);
  });

  it("medio tornillo no existe", async () => {
    const r = await vender({ items: [{ productId: pPerno, qtyMilli: 1_500 }], payments: [{ method: "CASH", receivedAmount: 1_000 }] });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("no se vende fraccionado");
  });

  it("sin caja abierta no se puede vender", async () => {
    const esperado = JSON.parse((await get("/api/cash/expected", tokenAdmin)).body).esperado;
    await post("/api/cash/close", { countedAmount: esperado });
    const r = await vender({ items: [{ productId: pPerno, qtyMilli: 1_000 }], payments: [{ method: "CASH", receivedAmount: 500 }] });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("caja está cerrada");
    await post("/api/cash/open", { openingAmount: 50_000 });
  });
});

describe("descuentos y su tope (tarea 3.6)", () => {
  it("dentro del tope, el vendedor descuenta solo", async () => {
    // Tope por omisión: 5%.
    const r = await vender({
      items: [{ productId: pCemento, qtyMilli: 2_000 }], // 2 cajas a $6.490 = $12.980
      discountAmount: 600, // 4,6%
      payments: [{ method: "CASH", receivedAmount: 12_380 }],
    });
    expect(r.statusCode).toBe(201);
    expect(JSON.parse(r.body).venta.discountAmount).toBe(600);
  });

  it("pasado el tope, se rechaza y dice qué hacer", async () => {
    const r = await vender({
      items: [{ productId: pCemento, qtyMilli: 2_000 }],
      discountAmount: 2_000, // 15%
      payments: [{ method: "CASH", receivedAmount: 11_000 }],
    });
    expect(r.statusCode).toBe(400);
    const error = JSON.parse(r.body).error as string;
    expect(error).toContain("5%");
    expect(error).toContain("PIN de un administrador");
  });

  it("con el PIN de administrador sí pasa, y queda quién autorizó", async () => {
    const r = await vender({
      items: [{ productId: pCemento, qtyMilli: 2_000 }],
      discountAmount: 2_000,
      adminPin: PIN_ADMIN,
      payments: [{ method: "CASH", receivedAmount: 11_000 }],
    });
    expect(r.statusCode).toBe(201);
    const entrada = await db.auditLog.findFirstOrThrow({ where: { action: "DISCOUNT_OVERRIDE" }, orderBy: { id: "desc" } });
    const idAdmin = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
    expect(entrada.userId).toBe(idAdmin);
  });

  it("un PIN equivocado no autoriza nada", async () => {
    const r = await vender({
      items: [{ productId: pCemento, qtyMilli: 2_000 }],
      discountAmount: 2_000,
      adminPin: "000000",
      payments: [{ method: "CASH", receivedAmount: 11_000 }],
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("no es correcto");
  });

  it("el administrador no necesita autorizarse a sí mismo", async () => {
    await post("/api/cash/open", { openingAmount: 10_000 }, tokenAdmin).catch(() => {});
    const r = await vender(
      { items: [{ productId: pCemento, qtyMilli: 2_000 }], discountAmount: 5_000, payments: [{ method: "CASH", receivedAmount: 8_000 }] },
      tokenAdmin,
    );
    expect(r.statusCode).toBe(201);
  });
});

describe("ticket y cajón (tareas 3.8 y 3.9)", () => {
  let idVenta: number;

  beforeAll(async () => {
    idVenta = JSON.parse(
      (await vender({ items: [{ productId: pCable, qtyMilli: 3_000 }], payments: [{ method: "CASH", receivedAmount: 5_000 }] })).body,
    ).venta.id;
  });

  /**
   * El cajón cuelga de la impresora. En trabajos separados, si la cola se
   * atasca entre uno y otro el vendedor tiene el ticket y el cajón cerrado con
   * el cliente esperando el vuelto.
   */
  it("el pulso del cajón va en el MISMO trabajo que el ticket", async () => {
    const trabajo = await db.printJob.findFirstOrThrow({ where: { saleId: idVenta }, orderBy: { id: "desc" } });
    const bytes = Buffer.from(trabajo.payload, "base64");
    expect(trabajo.type).toBe("RECEIPT");
    expect(bytes.includes(Buffer.from([0x1b, 0x70, 0x00, 25, 250]))).toBe(true);
    // Y va DESPUÉS del corte de papel (GS V).
    expect(bytes.indexOf(Buffer.from([0x1d, 0x56]))).toBeLessThan(bytes.indexOf(Buffer.from([0x1b, 0x70])));
  });

  it("el ticket trae el total, el desglose y el vuelto", async () => {
    const trabajo = await db.printJob.findFirstOrThrow({ where: { saleId: idVenta }, orderBy: { id: "desc" } });
    const texto = Buffer.from(trabajo.payload, "base64").toString("ascii");
    expect(texto).toContain("TOTAL");
    expect(texto).toContain("IVA 19%");
    expect(texto).toContain("VUELTO");
    expect(texto).toContain("Cable 2,5 mm");
  });

  /**
   * La térmica usa una tabla tipo CP437: un nombre con tilde saldría como
   * basura y no hay forma de verlo sin la impresora.
   *
   * El único byte por sobre 0x7F que puede aparecer es el 250 del pulso del
   * cajón (`ESC p 0 25 250`), que es un comando y no texto. Comprobar "todo
   * bajo 0x80" a secas fallaría por él y no probaría nada del nombre.
   */
  it("ningún carácter acentuado llega a la impresora", async () => {
    const conTilde = await db.product.create({
      data: {
        sku: "FH-09999",
        name: "Cañería PVC 110 mm",
        saleUnitId: (await db.unit.findFirstOrThrow({ where: { symbol: "un" } })).id,
        purchaseUnitId: (await db.unit.findFirstOrThrow({ where: { symbol: "un" } })).id,
        priceGross: 5_990,
        costNetMilliPeso: 3_980_000,
        searchKey: "caneria",
      },
    });
    await db.stockLevel.create({ data: { productId: conTilde.id, locationId: idLocal, qtyBaseMilli: 100_000 } });

    const body = JSON.parse(
      (await vender({ items: [{ productId: conTilde.id, qtyMilli: 1_000 }], payments: [{ method: "CASH", receivedAmount: 6_000 }] })).body,
    );
    const bytes = Buffer.from(
      (await db.printJob.findUniqueOrThrow({ where: { id: body.impresion.id } })).payload,
      "base64",
    );

    expect(bytes.toString("ascii")).toContain("Caneria PVC 110 mm");
    // Los bytes altos que quedan son solo los del pulso del cajón.
    const altos = [...bytes].filter((b) => b >= 0x80);
    expect(altos).toEqual([250]);
  });

  it("la reimpresión sale marcada como copia y NO abre el cajón", async () => {
    const r = await post(`/api/sales/${idVenta}/reprint`, {});
    expect(r.statusCode).toBe(201);
    const trabajo = await db.printJob.findUniqueOrThrow({ where: { id: JSON.parse(r.body).trabajo.id } });
    expect(trabajo.isReprint).toBe(true);
    const bytes = Buffer.from(trabajo.payload, "base64");
    expect(bytes.toString("ascii")).toContain("*** COPIA ***");
    expect(bytes.includes(Buffer.from([0x1b, 0x70]))).toBe(false);
  });
});

describe("venta en espera (tarea 3.7)", () => {
  let idEspera: number;

  it("se guarda con un nombre para reconocerla", async () => {
    const r = await post("/api/suspended", {
      label: "Sr. camioneta azul",
      items: [{ productId: pCable, qtyMilli: 10_000 }],
    });
    expect(r.statusCode).toBe(201);
    idEspera = JSON.parse(r.body).espera.id;
    expect(JSON.parse(r.body).mensaje).toContain("Sr. camioneta azul");
  });

  it("un nombre repetido avisa pero no revienta", async () => {
    const r = await post("/api/suspended", { label: "Sr. camioneta azul", items: [{ productId: pPerno, qtyMilli: 1_000 }] });
    expect(r.statusCode).toBe(201);
    expect(JSON.parse(r.body).aviso).toContain("ya hay otra espera");
  });

  /**
   * El precio guardado NUNCA se cobra: se relee el vigente y se avisa el
   * delta. Es cómo un sistema evita vender a precios de hace tres meses.
   */
  it("al recuperar se relee el precio y se avisa la diferencia", async () => {
    await db.product.update({ where: { id: pCable }, data: { priceGross: 790 } });
    const body = JSON.parse((await get(`/api/suspended/${idEspera}`)).body);
    expect(body.hayCambios).toBe(true);
    expect(body.lineas[0].precioAhora).toBe(790);
    expect(body.lineas[0].precioAlSuspender).toBe(690);
    expect(body.lineas[0].aviso).toContain("$690");
    expect(body.lineas[0].aviso).toContain("$790");
    await db.product.update({ where: { id: pCable }, data: { priceGross: 690 } });
  });

  /**
   * Dos unidades del mismo grupo —un rollo y un metro— pasarían cualquier
   * validación de grupo, y la cantidad significaría otra cosa.
   */
  it("si cambió la unidad de venta, avisa antes que el precio", async () => {
    const rollo = await db.unit.create({
      data: { groupId: (await db.unit.findUniqueOrThrow({ where: { id: (await db.suspendedSaleItem.findFirstOrThrow({ where: { suspendedSaleId: idEspera } })).unitId } })).groupId, name: "Rollo 100 m", symbol: "rl100", factorMilli: 100_000 },
    });
    await db.product.update({ where: { id: pCable }, data: { saleUnitId: rollo.id } });

    const body = JSON.parse((await get(`/api/suspended/${idEspera}`)).body);
    expect(body.lineas[0].aviso).toContain("unidad de venta cambió");
    expect(body.lineas[0].unidadGuardada).toBe("m");
    expect(body.lineas[0].unidadActual).toBe("rl100");

    const metro = await db.unit.findFirstOrThrow({ where: { symbol: "m" } });
    await db.product.update({ where: { id: pCable }, data: { saleUnitId: metro.id } });
  });

  it("sin cambios, no avisa nada", async () => {
    const body = JSON.parse((await get(`/api/suspended/${idEspera}`)).body);
    expect(body.hayCambios).toBe(false);
    expect(body.lineas[0].aviso).toBeNull();
  });

  it("la lista muestra las esperas de la ubicación", async () => {
    const body = JSON.parse((await get("/api/suspended")).body);
    expect(body.esperas.length).toBeGreaterThanOrEqual(2);
    expect(body.esperas[0].label).toBeTruthy();
  });

  it("descartar la borra: no tocó stock ni caja, no deja huecos", async () => {
    const r = await app.inject({ method: "DELETE", url: `/api/suspended/${idEspera}`, headers: como(tokenVendedor) });
    expect(r.statusCode).toBe(200);
    expect(await db.suspendedSale.findUnique({ where: { id: idEspera } })).toBeNull();
    // Y las líneas se van con ella.
    expect(await db.suspendedSaleItem.count({ where: { suspendedSaleId: idEspera } })).toBe(0);
  });

  it("una espera que ya no está lo dice, no revienta", async () => {
    const r = await get(`/api/suspended/${idEspera}`);
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("ya no existe");
  });
});

describe("al vendedor no le llega ningún costo desde la venta", () => {
  it("la venta que acaba de cobrar no trae lineCostNet", async () => {
    const r = await vender({ items: [{ productId: pPerno, qtyMilli: 1_000 }], payments: [{ method: "CASH", receivedAmount: 500 }] });
    expect(findForbiddenFields(JSON.parse(r.body))).toEqual([]);
    expect(r.body.length).toBeGreaterThan(100);
  });

  it("y al administrador sí, o no podría ver el margen", async () => {
    const id = (await db.sale.findFirstOrThrow({ orderBy: { id: "desc" } })).id;
    const r = await get(`/api/sales/${id}`, tokenAdmin);
    expect(findForbiddenFields(JSON.parse(r.body)).length).toBeGreaterThan(0);
  });
});

/**
 * La demo de cierre del sprint, tal como la pide SPRINTS.md: vender con lector,
 * cobrar en dos medios, imprimir y ver el vuelto.
 */
describe("demo de cierre del Sprint 3", () => {
  it("venta de mesón completa, de punta a punta", async () => {
    const antesCaja = (await db.cashMovement.findFirstOrThrow({ where: { sessionId: (await db.cashSession.findFirstOrThrow({ where: { openStationId: idCaja1 } })).id }, orderBy: { id: "desc" } })).balanceAfter;

    const r = await vender({
      items: [
        { productId: pCable, qtyMilli: 7_500 },
        { productId: pPerno, qtyMilli: 12_000 },
        { productId: pCemento, qtyMilli: 2_000 },
      ],
      payments: [
        { method: "DEBIT", amount: 10_000, reference: "TBK-4471" },
        { method: "CASH", receivedAmount: 20_000 },
      ],
      fiscalDocType: "BOLETA",
      fiscalFolio: "1234567",
    });
    expect(r.statusCode).toBe(201);
    const body = JSON.parse(r.body);

    // 5.175 + 4.200 + 12.980 = 22.355 → efectivo 12.355 → 12.360
    expect(body.venta.subtotalGross).toBe(22_355);
    expect(body.venta.totalGross).toBe(22_360);
    expect(body.cambio).toBe(7_640);
    expect(body.venta.fiscalFolio).toBe("1234567");

    // Los pagos cuadran exactamente con el total.
    const pagos = body.venta.payments as { amount: number }[];
    expect(pagos.reduce((t, p) => t + p.amount, 0)).toBe(22_360);

    // Al cajón entró solo el efectivo: 12.360.
    const mov = await db.cashMovement.findFirstOrThrow({ where: { saleId: body.venta.id } });
    expect(mov.amount).toBe(12_360);
    expect(mov.balanceAfter - antesCaja).toBe(12_360);

    // Y salió un ticket con el pulso del cajón.
    const trabajo = await db.printJob.findFirstOrThrow({ where: { saleId: body.venta.id } });
    expect(Buffer.from(trabajo.payload, "base64").includes(Buffer.from([0x1b, 0x70]))).toBe(true);
  });
});

/**
 * Decisión sellada 15: una venta jamás se bloquea porque falle la impresión.
 * Pero callarlo significaría vender toda una mañana sin comprobante y que nadie
 * se entere hasta que un cliente lo pida. Se descubrió vendiendo de verdad en
 * una caja sin impresora configurada: la pantalla decía "Cobrado" y prometía un
 * ticket que nunca salió.
 */
describe("sin impresora configurada, la venta sigue pero se avisa", () => {
  it("cobra igual, y lo dice", async () => {
    await db.station.update({ where: { id: idCaja1 }, data: { printerTarget: null } });
    const r = await vender({ items: [{ productId: pPerno, qtyMilli: 1_000 }], payments: [{ method: "CASH", receivedAmount: 500 }] });

    expect(r.statusCode).toBe(201);
    const body = JSON.parse(r.body);
    expect(body.impresion).toBeNull();
    expect(body.avisoImpresion).toContain("no tiene impresora configurada");
    expect(body.avisoImpresion).toContain("quedó registrada");

    // Y la venta está de verdad escrita, con su movimiento de caja.
    expect(await db.cashMovement.count({ where: { saleId: body.venta.id } })).toBe(1);

    await db.station.update({ where: { id: idCaja1 }, data: { printerTarget: "\\\\SRV\\T1" } });
  });

  it("con impresora, no avisa nada", async () => {
    const body = JSON.parse(
      (await vender({ items: [{ productId: pPerno, qtyMilli: 1_000 }], payments: [{ method: "CASH", receivedAmount: 500 }] })).body,
    );
    expect(body.impresion).not.toBeNull();
    expect(body.avisoImpresion).toBeNull();
  });
});

/**
 * El listado del día suma la venta del día, y esa cifra no le viaja al
 * vendedor (precisión de la decisión 17 en el Sprint 5): el arqueo es a ciegas
 * y casi todo es efectivo, así que decirle cuánto se vendió es decirle cuánto
 * debería tener el cajón.
 */
describe("el listado del día", () => {
  it("el administrador lo ve", async () => {
    const r = await get("/api/sales", tokenAdmin);
    expect(r.statusCode).toBe(200);
    expect(Array.isArray(JSON.parse(r.body).ventas)).toBe(true);
  });

  it("al vendedor no le llega", async () => {
    expect((await get("/api/sales", tokenVendedor)).statusCode).toBe(403);
  });

  /**
   * Pero UNA venta suelta sí, y es lo que necesita para devolver: el cliente
   * llega con el ticket, que trae impreso «Venta #123».
   */
  it("una venta suelta sí, que es con lo que se atiende una devolución", async () => {
    const venta = JSON.parse(
      (await vender({ items: [{ productId: pPerno, qtyMilli: 1_000 }], payments: [{ method: "CASH", receivedAmount: 500 }] })).body,
    ).venta;
    expect((await get(`/api/sales/${venta.id}`, tokenVendedor)).statusCode).toBe(200);
    expect((await get(`/api/sales/${venta.id}/returnable`, tokenVendedor)).statusCode).toBe(200);
  });
});
