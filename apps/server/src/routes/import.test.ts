import { describe, it, expect, beforeAll } from "vitest";
import type { FastifyInstance } from "fastify";
import ExcelJS from "exceljs";
import { buildApp } from "../app.js";
import { db } from "../db.js";
import { SKU_COUNTER } from "@ferrehouse/shared";
import { PIN_ADMIN, PIN_VENDEDOR } from "../test-setup.js";

let app: FastifyInstance;
let tokenAdmin: string, tokenVendedor: string;

beforeAll(async () => {
  app = await buildApp({ jwtSecret: "test-secret" });
  await app.ready();

  const longitud = await db.unitGroup.create({ data: { name: "LONGITUD", allowsFraction: true } });
  const conteo = await db.unitGroup.create({ data: { name: "CONTEO", allowsFraction: false } });
  const peso = await db.unitGroup.create({ data: { name: "PESO", allowsFraction: true } });
  await db.unit.create({ data: { groupId: longitud.id, name: "Metro", symbol: "m", factorMilli: 1000, isBase: true } });
  await db.unit.create({ data: { groupId: longitud.id, name: "Rollo 100 m", symbol: "rl100", factorMilli: 100_000 } });
  await db.unit.create({ data: { groupId: conteo.id, name: "Unidad", symbol: "un", factorMilli: 1000, isBase: true } });
  await db.unit.create({ data: { groupId: peso.id, name: "Kilogramo", symbol: "kg", factorMilli: 1000, isBase: true } });
  await db.counter.create({ data: { name: SKU_COUNTER, value: 0 } });

  const idCaja = (await db.station.findFirstOrThrow({ where: { name: "CAJA-1" } })).id;
  const entrar = async (role: "ADMIN" | "SELLER", pin: string) => {
    const u = await db.user.findFirstOrThrow({ where: { role, active: true } });
    return JSON.parse(
      (await app.inject({ method: "POST", url: "/api/auth/login", payload: { userId: u.id, pin, stationId: idCaja } })).body,
    ).token as string;
  };
  tokenAdmin = await entrar("ADMIN", PIN_ADMIN);
  tokenVendedor = await entrar("SELLER", PIN_VENDEDOR);
});

const como = (t: string) => ({ authorization: `Bearer ${t}` });

const ENCABEZADO = [
  "Nombre", "Descripción", "Categoría", "Marca", "Proveedor",
  "Unidad de venta", "Unidad de compra", "Precio con IVA", "Costo neto", "Stock mínimo", "Códigos de barra",
];

/** Arma un .xlsx en memoria con las filas dadas. */
async function excel(filas: (string | number)[][], encabezado = ENCABEZADO): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet("Productos");
  hoja.addRow(encabezado);
  for (const f of filas) hoja.addRow(f);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Sube el archivo como multipart, que es como llega desde el navegador. */
async function subir(buffer: Buffer, confirmar: boolean, token = tokenAdmin) {
  const borde = "----ferrehousetest";
  const partes: Buffer[] = [];
  if (confirmar) {
    partes.push(
      Buffer.from(`--${borde}\r\nContent-Disposition: form-data; name="confirmar"\r\n\r\ntrue\r\n`),
    );
  }
  partes.push(
    Buffer.from(
      `--${borde}\r\nContent-Disposition: form-data; name="archivo"; filename="productos.xlsx"\r\n` +
        "Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n",
    ),
    buffer,
    Buffer.from(`\r\n--${borde}--\r\n`),
  );

  return app.inject({
    method: "POST",
    url: "/api/import/products",
    headers: { ...como(token), "content-type": `multipart/form-data; boundary=${borde}` },
    payload: Buffer.concat(partes),
  });
}

const FILA_OK = ["Cable eléctrico 2,5 mm", "", "Eléctrico", "Covisa", "", "m", "rl100", "690", "410", "50", "7801111111111"];
const FILA_OK_2 = ["Perno 5/8 galvanizado", "", "Fijaciones", "", "", "un", "un", "350", "180", "20", ""];

describe("plantilla (tarea 1.6)", () => {
  it("se descarga y trae las unidades reales de la tienda en la segunda hoja", async () => {
    const r = await app.inject({ method: "GET", url: "/api/import/products/template.xlsx", headers: como(tokenAdmin) });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-disposition"]).toContain("plantilla-productos.xlsx");

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer);
    expect(wb.worksheets.map((h) => h.name)).toEqual(["Productos", "Unidades disponibles"]);
    const ayuda = wb.getWorksheet("Unidades disponibles")!;
    const simbolos: string[] = [];
    ayuda.eachRow((fila, n) => {
      if (n > 1) simbolos.push(String(fila.getCell(3).value));
    });
    expect(simbolos).toContain("rl100");
  });

  it("el vendedor no la descarga", async () => {
    const r = await app.inject({ method: "GET", url: "/api/import/products/template.xlsx", headers: como(tokenVendedor) });
    expect(r.statusCode).toBe(403);
  });
});

describe("informe antes de escribir", () => {
  it("sin confirmar no crea nada, y dice cuántos entrarían", async () => {
    const antes = await db.product.count();
    const r = await subir(await excel([FILA_OK, FILA_OK_2]), false);
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.importado).toBe(false);
    expect(body.validas).toBe(2);
    expect(body.conError).toBe(0);
    expect(await db.product.count()).toBe(antes);
  });

  /** Acá se ven los errores de tipeo ANTES de que existan como filas. */
  it("avisa qué categorías y marcas se crearían", async () => {
    const body = JSON.parse((await subir(await excel([FILA_OK, FILA_OK_2]), false)).body);
    expect(body.seCrearan.categorias).toEqual(expect.arrayContaining(["Eléctrico", "Fijaciones"]));
    expect(body.seCrearan.marcas).toEqual(["Covisa"]);
  });

  it("devuelve TODAS las filas con error, no las primeras", async () => {
    const malas = Array.from({ length: 12 }, (_, i) => [`Producto malo ${i}`, "", "", "", "", "m", "kg", "100", "", "", ""]);
    const body = JSON.parse((await subir(await excel(malas), false)).body);
    expect(body.conError).toBe(12);
    expect(body.errores).toHaveLength(12);
    expect(body.errores[0].errores[0]).toContain("magnitudes distintas");
    expect(body.errores[0].fila).toBe(2); // fila 1 es el encabezado
  });
});

describe("todo o nada", () => {
  it("una sola fila mala impide que entren las buenas", async () => {
    const antes = await db.product.count();
    const mala = ["Sin unidad válida", "", "", "", "", "metro cuadrado", "un", "100", "", "", ""];
    const r = await subir(await excel([FILA_OK, mala, FILA_OK_2]), true);

    expect(r.statusCode).toBe(400);
    const body = JSON.parse(r.body);
    expect(body.importado).toBe(false);
    expect(body.mensaje).toContain("No se importó nada");
    expect(await db.product.count()).toBe(antes);
  });

  it("con todo en orden, carga en lote y reserva un rango de SKU", async () => {
    const antes = await db.product.count();
    const r = await subir(await excel([FILA_OK, FILA_OK_2]), true);
    expect(r.statusCode).toBe(200);

    const body = JSON.parse(r.body);
    expect(body.importado).toBe(true);
    expect(body.creados).toBe(2);
    expect(body.rangoSku.desde).toMatch(/^FH-\d{5}$/);
    expect(await db.product.count()).toBe(antes + 2);

    const cable = await db.product.findFirstOrThrow({ where: { name: "Cable eléctrico 2,5 mm" }, include: { barcodes: true, stockLevels: true, category: true } });
    expect(cable.priceGross).toBe(690);
    // El costo se digita en pesos y se guarda en milésimas de peso.
    expect(cable.costNetMilliPeso).toBe(410_000);
    expect(cable.reorderLevelBaseMilli).toBe(50_000);
    expect(cable.barcodes.map((b) => b.code)).toEqual(["7801111111111"]);
    expect(cable.category?.name).toBe("Eléctrico");
    // Mismo invariante que el alta manual: nace con su fila de stock.
    expect(cable.stockLevels.length).toBe(await db.location.count({ where: { active: true } }));
  });

  it("el producto importado se encuentra desde la caja de búsqueda", async () => {
    const r = await app.inject({ method: "GET", url: "/api/products/search?q=electrico", headers: como(tokenAdmin) });
    expect(JSON.parse(r.body).productos.map((p: { name: string }) => p.name)).toContain("Cable eléctrico 2,5 mm");
  });
});

describe("validación fila por fila, con el mismo esquema que el formulario", () => {
  it("un código que ya existe en la base se rechaza nombrando al dueño", async () => {
    const choque = ["Otro cable", "", "", "", "", "m", "m", "500", "", "", "7801111111111"];
    const body = JSON.parse((await subir(await excel([choque]), false)).body);
    expect(body.errores[0].errores.join(" ")).toContain("ya es del producto");
  });

  /** El caso más común: copiar una fila y olvidar cambiar el código. */
  it("el mismo código dos veces DENTRO del archivo también choca", async () => {
    const a = ["Producto A", "", "", "", "", "un", "un", "100", "", "", "7802222222222"];
    const b = ["Producto B", "", "", "", "", "un", "un", "100", "", "", "7802222222222"];
    const body = JSON.parse((await subir(await excel([a, b]), false)).body);
    expect(body.conError).toBe(1);
    expect(body.errores[0].errores.join(" ")).toContain("fila 2 de este mismo archivo");
  });

  it("un precio ilegible se explica en vez de importarse como cero", async () => {
    const fila = ["Precio raro", "", "", "", "", "un", "un", "como $500", "", "", ""];
    const body = JSON.parse((await subir(await excel([fila]), false)).body);
    expect(body.errores[0].errores.join(" ")).toContain("No entiendo el precio");
  });

  it("lee el precio chileno con punto de miles", async () => {
    const fila = ["Taladro percutor", "", "", "", "", "un", "un", "89.990", "", "", ""];
    const body = JSON.parse((await subir(await excel([fila]), false)).body);
    expect(body.conError).toBe(0);
  });

  it("faltar una columna obligatoria se avisa una vez, no fila por fila", async () => {
    const sinPrecio = ENCABEZADO.filter((c) => c !== "Precio con IVA");
    const r = await subir(await excel([["X", "", "", "", "", "m", "m", "", "", ""]], sinPrecio), false);
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("Precio con IVA");
  });

  it("el archivo vacío se avisa", async () => {
    const r = await subir(await excel([]), false);
    expect(r.statusCode).toBe(400);
    expect(JSON.parse(r.body).error).toContain("ninguna fila");
  });

  it("el vendedor no importa nada", async () => {
    const r = await subir(await excel([FILA_OK_2]), true, tokenVendedor);
    expect(r.statusCode).toBe(403);
  });
});
