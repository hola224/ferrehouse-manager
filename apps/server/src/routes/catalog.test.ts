import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { db } from "../db.js";
import { findForbiddenFields, SKU_COUNTER } from "@ferrehouse/shared";
import { PIN_ADMIN, PIN_VENDEDOR } from "../test-setup.js";

let app: FastifyInstance;
let tokenAdmin: string, tokenVendedor: string;
let idLocal: number;
let uMetro: number, uRollo: number, uKilo: number, uLitro: number, uUnidad: number;

beforeAll(async () => {
  app = await buildApp({ jwtSecret: "test-secret" });
  await app.ready();

  // Lo que el seed real deja y este test necesita: unidades y el contador.
  const longitud = await db.unitGroup.create({ data: { name: "LONGITUD", allowsFraction: true } });
  const peso = await db.unitGroup.create({ data: { name: "PESO", allowsFraction: true } });
  const volumen = await db.unitGroup.create({ data: { name: "VOLUMEN", allowsFraction: true } });
  const conteo = await db.unitGroup.create({ data: { name: "CONTEO", allowsFraction: false } });

  uMetro = (await db.unit.create({ data: { groupId: longitud.id, name: "Metro", symbol: "m", factorMilli: 1000, isBase: true } })).id;
  uRollo = (await db.unit.create({ data: { groupId: longitud.id, name: "Rollo 100 m", symbol: "rl100", factorMilli: 100_000 } })).id;
  uKilo = (await db.unit.create({ data: { groupId: peso.id, name: "Kilogramo", symbol: "kg", factorMilli: 1000, isBase: true } })).id;
  uLitro = (await db.unit.create({ data: { groupId: volumen.id, name: "Litro", symbol: "L", factorMilli: 1000, isBase: true } })).id;
  uUnidad = (await db.unit.create({ data: { groupId: conteo.id, name: "Unidad", symbol: "un", factorMilli: 1000, isBase: true } })).id;

  await db.counter.create({ data: { name: SKU_COUNTER, value: 0 } });
  idLocal = (await db.location.findFirstOrThrow({ where: { isDefault: true } })).id;

  const idAdmin = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
  const idVendedor = (await db.user.findFirstOrThrow({ where: { role: "SELLER", active: true } })).id;
  const idCaja = (await db.station.findFirstOrThrow({ where: { name: "CAJA-1" } })).id;

  const entrar = async (userId: number, pin: string) =>
    JSON.parse((await app.inject({ method: "POST", url: "/api/auth/login", payload: { userId, pin, stationId: idCaja } })).body).token as string;

  tokenAdmin = await entrar(idAdmin, PIN_ADMIN);
  tokenVendedor = await entrar(idVendedor, PIN_VENDEDOR);
});

const como = (token: string) => ({ authorization: `Bearer ${token}` });

const crear = (payload: Record<string, unknown>, token = tokenAdmin) =>
  app.inject({ method: "POST", url: "/api/products", headers: como(token), payload });

describe("alta de productos (tarea 1.1)", () => {
  it("crea el producto con SKU correlativo y devuelve la conversión en castellano", async () => {
    const r = await crear({
      name: "Cable eléctrico 2,5 mm rojo",
      saleUnitId: uMetro,
      purchaseUnitId: uRollo,
      priceGross: 690,
      costNetMilliPeso: 410_000,
      barcodes: ["7801234567890"],
    });
    expect(r.statusCode).toBe(201);
    const body = JSON.parse(r.body);
    expect(body.producto.sku).toBe("FH-00001");
    expect(body.conversion).toContain("Se compra en Rollo 100 m, se vende en Metro");
  });

  /**
   * El invariante del sprint: sin fila de `StockLevel`, la alerta de quiebre
   * (ALE-02) no ve el producto y la validación de venta consulta un registro
   * que no existe. Por eso se crea DENTRO de la transacción del alta.
   */
  it("el producto nace con su fila de stock en cero, para cada ubicación activa", async () => {
    const r = await crear({ name: "Perno 5/8 galvanizado", saleUnitId: uUnidad, purchaseUnitId: uUnidad, priceGross: 350 });
    const id = JSON.parse(r.body).producto.id as number;

    const niveles = await db.stockLevel.findMany({ where: { productId: id } });
    const activas = await db.location.count({ where: { active: true } });
    expect(niveles).toHaveLength(activas);
    expect(niveles.every((n) => n.qtyBaseMilli === 0)).toBe(true);
    expect(niveles.some((n) => n.locationId === idLocal)).toBe(true);
  });

  /** El caso del diluyente: convertir litros a kilos "funciona" y miente 13%. */
  it("rechaza comprar en litros y vender en kilos", async () => {
    const r = await crear({ name: "Diluyente", saleUnitId: uKilo, purchaseUnitId: uLitro, priceGross: 3990 });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("magnitudes distintas");
  });

  it("un error de Zod llega como 400 con el mensaje en castellano, no como 500", async () => {
    const r = await crear({ name: "X", saleUnitId: uMetro, purchaseUnitId: uMetro, priceGross: 100 });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("al menos 2 caracteres");
  });

  it("el precio con decimales se rechaza: el peso no los tiene", async () => {
    const r = await crear({ name: "Cinta métrica", saleUnitId: uUnidad, purchaseUnitId: uUnidad, priceGross: 4990.5 });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("pesos enteros");
  });

  it("el vendedor no crea productos", async () => {
    const r = await crear({ name: "Lo que sea", saleUnitId: uUnidad, purchaseUnitId: uUnidad, priceGross: 100 }, tokenVendedor);
    expect(r.statusCode).toBe(403);
  });

  it("los SKU no se repiten aunque se creen seguidos", async () => {
    const a = JSON.parse((await crear({ name: "Tarugo 8 mm", saleUnitId: uUnidad, purchaseUnitId: uUnidad, priceGross: 90 })).body);
    const b = JSON.parse((await crear({ name: "Tarugo 10 mm", saleUnitId: uUnidad, purchaseUnitId: uUnidad, priceGross: 120 })).body);
    expect(a.producto.sku).not.toBe(b.producto.sku);
  });
});

describe("códigos de barra (tarea 1.2)", () => {
  it("un producto acepta varios códigos", async () => {
    const id = JSON.parse(
      (await crear({ name: "Perno hexagonal 3/8", saleUnitId: uUnidad, purchaseUnitId: uUnidad, priceGross: 250, barcodes: ["7809000000001"] })).body,
    ).producto.id as number;

    const r = await app.inject({
      method: "POST",
      url: `/api/products/${id}/barcodes`,
      headers: como(tokenAdmin),
      payload: { code: "7809000000002", note: "código proveedor Vulco" },
    });
    expect(r.statusCode).toBe(201);
    expect(JSON.parse(r.body).producto.barcodes).toHaveLength(2);
  });

  it("un código que ya es de otro producto se rechaza diciendo de quién es", async () => {
    const r = await crear({ name: "Copia mal hecha", saleUnitId: uUnidad, purchaseUnitId: uUnidad, priceGross: 100, barcodes: ["7801234567890"] });
    expect(r.statusCode).toBe(400);
    const error = JSON.parse(r.body).error as string;
    expect(error).toContain("7801234567890");
    expect(error).toContain("Cable eléctrico");
  });

  it("el mismo código dos veces en la misma lista se rechaza", async () => {
    const r = await crear({
      name: "Pegado dos veces",
      saleUnitId: uUnidad,
      purchaseUnitId: uUnidad,
      priceGross: 100,
      barcodes: ["7805555555555", "7805555555555"],
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("repetido");
  });
});

describe("la caja única de búsqueda (tarea 1.5, POS-03)", () => {
  beforeAll(async () => {
    await crear({ name: "Cañería PVC 110 mm", saleUnitId: uMetro, purchaseUnitId: uMetro, priceGross: 5990, barcodes: ["7807777777777"] });
  });

  const buscar = (q: string, token = tokenAdmin) =>
    app.inject({ method: "GET", url: `/api/products/search?q=${encodeURIComponent(q)}`, headers: como(token) });

  it("un escaneo devuelve EL producto, no una lista para elegir", async () => {
    const body = JSON.parse((await buscar("7807777777777")).body);
    expect(body.exacto).toBe(true);
    expect(body.motivo).toBe("CODIGO_BARRAS");
    expect(body.productos).toHaveLength(1);
    expect(body.productos[0].name).toBe("Cañería PVC 110 mm");
  });

  it("el SKU exacto también corta la búsqueda", async () => {
    const body = JSON.parse((await buscar("FH-00001")).body);
    expect(body.exacto).toBe(true);
    expect(body.motivo).toBe("SKU");
  });

  /**
   * El motivo de la columna `searchKey`: el LIKE de SQLite ignora mayúsculas
   * solo en ASCII, así que sin normalizar ninguna de estas tres encuentra nada.
   */
  it("encuentra 'Cañería' escribiendo caneria, CAÑERIA o Cañeria", async () => {
    for (const q of ["caneria", "CAÑERIA", "Cañeria", "cañeria"]) {
      const body = JSON.parse((await buscar(q)).body);
      expect(body.productos.map((p: { name: string }) => p.name), `buscando "${q}"`).toContain("Cañería PVC 110 mm");
    }
  });

  it("el nombre parcial encuentra por el medio de la palabra", async () => {
    const body = JSON.parse((await buscar("electrico")).body);
    expect(body.productos.map((p: { name: string }) => p.name)).toContain("Cable eléctrico 2,5 mm rojo");
  });

  it("sin resultados devuelve lista vacía, no un error", async () => {
    const r = await buscar("motosierra");
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).productos).toEqual([]);
  });
});

/**
 * Decisión sellada 17 / USR-03. En el Sprint 0 esto se probó contra una ruta
 * escrita a propósito para ser atrapada; acá se prueba contra los endpoints
 * REALES, que es donde `costNetMilliPeso` sale por primera vez de verdad.
 */
describe("al vendedor no le llega ningún costo, desde las rutas reales", () => {
  const rutas = ["/api/products", "/api/products/search?q=cable", "/api/products/1"];

  for (const url of rutas) {
    it(`${url} — sin costos para el vendedor`, async () => {
      const r = await app.inject({ method: "GET", url, headers: como(tokenVendedor) });
      expect(r.statusCode).toBe(200);
      expect(findForbiddenFields(JSON.parse(r.body))).toEqual([]);
      // Y que el cuerpo no venga vacío por accidente, que haría pasar el test.
      expect(r.body.length).toBeGreaterThan(50);
    });
  }

  it("al admin sí le llegan: si no, el margen no se puede calcular", async () => {
    const r = await app.inject({ method: "GET", url: "/api/products/1", headers: como(tokenAdmin) });
    expect(findForbiddenFields(JSON.parse(r.body)).length).toBeGreaterThan(0);
  });

  it("los proveedores no se le muestran al vendedor", async () => {
    expect((await app.inject({ method: "GET", url: "/api/catalog/suppliers", headers: como(tokenVendedor) })).statusCode).toBe(403);
  });
});

describe("el costo se digita hasta el primer movimiento, después lo manda el libro", () => {
  let idProducto: number;

  beforeAll(async () => {
    idProducto = JSON.parse(
      (await crear({ name: "Alambre galvanizado", saleUnitId: uKilo, purchaseUnitId: uKilo, priceGross: 2490, costNetMilliPeso: 1_500_000 })).body,
    ).producto.id;
  });

  it("sin movimientos se puede corregir", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/api/products/${idProducto}`,
      headers: como(tokenAdmin),
      payload: { costNetMilliPeso: 1_600_000 },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).producto.costNetMilliPeso).toBe(1_600_000);
  });

  it("con un movimiento en el libro, editarlo se rechaza y dice qué hacer", async () => {
    const idUsuario = (await db.user.findFirstOrThrow({ where: { role: "ADMIN" } })).id;
    await db.stockMovement.create({
      data: {
        productId: idProducto,
        locationId: idLocal,
        type: "INITIAL",
        qtyBaseMilli: 10_000,
        totalCostNet: 16_000,
        balanceBaseMilli: 10_000,
        balanceCostNetMilliPeso: 1_600_000,
        userId: idUsuario,
      },
    });

    const r = await app.inject({
      method: "PATCH",
      url: `/api/products/${idProducto}`,
      headers: como(tokenAdmin),
      payload: { costNetMilliPeso: 9_999_000 },
    });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("ajuste");
    expect((await db.product.findUniqueOrThrow({ where: { id: idProducto } })).costNetMilliPeso).toBe(1_600_000);
  });

  it("el resto del producto se sigue pudiendo editar", async () => {
    const r = await app.inject({
      method: "PATCH",
      url: `/api/products/${idProducto}`,
      headers: como(tokenAdmin),
      payload: { priceGross: 2690 },
    });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).producto.priceGross).toBe(2690);
  });
});

describe("dar de baja", () => {
  it("descontinuar no borra: marca deletedAt y avisa que el SKU no vuelve", async () => {
    const id = JSON.parse(
      (await crear({ name: "Producto que se va", saleUnitId: uUnidad, purchaseUnitId: uUnidad, priceGross: 100 })).body,
    ).producto.id as number;

    const r = await app.inject({ method: "DELETE", url: `/api/products/${id}`, headers: como(tokenAdmin) });
    expect(r.statusCode).toBe(200);
    expect(JSON.parse(r.body).mensaje).toContain("no se reutiliza");

    const fila = await db.product.findUniqueOrThrow({ where: { id } });
    expect(fila.deletedAt).not.toBeNull();

    const lista = JSON.parse((await app.inject({ method: "GET", url: "/api/products?incluirInactivos=true", headers: como(tokenAdmin) })).body);
    expect(lista.productos.map((p: { id: number }) => p.id)).not.toContain(id);
  });

  it("un producto inactivo sale del POS pero el admin lo sigue viendo", async () => {
    const id = JSON.parse(
      (await crear({ name: "Fuera de temporada", saleUnitId: uUnidad, purchaseUnitId: uUnidad, priceGross: 100 })).body,
    ).producto.id as number;
    await app.inject({ method: "PATCH", url: `/api/products/${id}`, headers: como(tokenAdmin), payload: { active: false } });

    const delVendedor = JSON.parse((await app.inject({ method: "GET", url: "/api/products", headers: como(tokenVendedor) })).body);
    expect(delVendedor.productos.map((p: { id: number }) => p.id)).not.toContain(id);

    const delAdmin = JSON.parse(
      (await app.inject({ method: "GET", url: "/api/products?incluirInactivos=true", headers: como(tokenAdmin) })).body,
    );
    expect(delAdmin.productos.map((p: { id: number }) => p.id)).toContain(id);
  });
});

describe("categorías, marcas y proveedores (tarea 1.4)", () => {
  it("el admin las crea y no se repiten", async () => {
    const primera = await app.inject({ method: "POST", url: "/api/catalog/categories", headers: como(tokenAdmin), payload: { name: "Eléctrico" } });
    expect(primera.statusCode).toBe(201);
    const repetida = await app.inject({ method: "POST", url: "/api/catalog/categories", headers: como(tokenAdmin), payload: { name: "Eléctrico" } });
    expect(repetida.statusCode).toBe(400);
  });

  it("el vendedor las lee pero no las crea", async () => {
    expect((await app.inject({ method: "GET", url: "/api/catalog/categories", headers: como(tokenVendedor) })).statusCode).toBe(200);
    expect(
      (await app.inject({ method: "POST", url: "/api/catalog/brands", headers: como(tokenVendedor), payload: { name: "Bosch" } })).statusCode,
    ).toBe(403);
  });

  it("el RUT del proveedor se guarda normalizado", async () => {
    const r = await app.inject({
      method: "POST",
      url: "/api/catalog/suppliers",
      headers: como(tokenAdmin),
      payload: { name: "Vulco", rut: "76.543.210-k" },
    });
    expect(r.statusCode).toBe(201);
    expect(JSON.parse(r.body).proveedor.rut).toBe("76543210-K");
  });
});

describe("etiquetas (tarea 1.3)", () => {
  it("la vista previa es un SVG con el SKU dentro", async () => {
    const r = await app.inject({ method: "GET", url: "/api/products/1/label.svg", headers: como(tokenVendedor) });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("image/svg+xml");
    expect(r.body).toContain("FH-00001");
  });

  it("imprimir encola un PrintJob en la estación, no escribe al puerto", async () => {
    await db.station.update({ where: { name: "CAJA-1" }, data: { printerTarget: "\\\\SERVIDOR\\TERMICA" } });
    const r = await app.inject({ method: "POST", url: "/api/products/1/label", headers: como(tokenAdmin), payload: { copias: 3 } });
    expect(r.statusCode).toBe(201);

    const trabajo = await db.printJob.findUniqueOrThrow({ where: { id: JSON.parse(r.body).trabajo.id } });
    expect(trabajo.type).toBe("LABEL");
    expect(trabajo.status).toBe("PENDING");
    // Las tres copias van en el mismo trabajo, y el ESC/POS empieza con ESC @.
    const bytes = Buffer.from(trabajo.payload, "base64");
    expect(bytes[0]).toBe(0x1b);
    expect(bytes[1]).toBe(0x40);
    expect(bytes.toString("latin1").split("\x1b@").length - 1).toBe(3);
  });

  it("una caja sin impresora lo dice, no falla en silencio", async () => {
    await db.station.update({ where: { name: "CAJA-1" }, data: { printerTarget: null } });
    const r = await app.inject({ method: "POST", url: "/api/products/1/label", headers: como(tokenAdmin), payload: {} });
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("no tiene impresora");
    await db.station.update({ where: { name: "CAJA-1" }, data: { printerTarget: "\\\\SERVIDOR\\TERMICA" } });
  });
});
