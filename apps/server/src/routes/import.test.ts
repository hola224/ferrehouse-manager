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
  // El saco es el caso donde precio y costo NO están en la misma unidad.
  await db.unit.create({ data: { groupId: peso.id, name: "Saco 25 kg", symbol: "sc25", factorMilli: 25_000 } });
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
  "Unidad de venta", "Unidad de compra", "Precio con IVA (por unidad de venta)",
  "Costo neto (por unidad base)", "Stock mínimo (en unidad base)", "Códigos de barra",
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
    const sinPrecio = ENCABEZADO.filter((c) => !c.startsWith("Precio"));
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

describe("el informe dice cómo entendió cada fila", () => {
  /**
   * El error más caro de esta plantilla no es de formato: es cargar el precio
   * del saco donde el sistema espera el del kilo. El número es perfectamente
   * válido, así que ninguna validación lo puede atrapar — solo se ve si el
   * informe muestra la interpretación con la unidad escrita.
   */
  it("escribe la unidad de cada monto, que es lo que ninguna validación puede atrapar", async () => {
    const cemento = ["Cemento Polpaico", "", "", "", "", "kg", "kg", "260", "180", "200", ""];
    const body = JSON.parse((await subir(await excel([cemento]), false)).body);
    expect(body.conError).toBe(0);
    expect(body.interpretadas).toHaveLength(1);
    expect(body.interpretadas[0].dice).toContain("$260 por kg");
    expect(body.interpretadas[0].dice).toContain("costo $180 por kg");
    expect(body.interpretadas[0].dice).toContain("mínimo 200 kg");
  });

  it("dice cuando la unidad de compra es distinta de la de venta", async () => {
    const cable = ["Cable rollo", "", "", "", "", "m", "rl100", "690", "410", "", ""];
    const body = JSON.parse((await subir(await excel([cable]), false)).body);
    expect(body.interpretadas[0].dice).toContain("se compra en rl100");
  });

  /**
   * El error caro, y el único que ninguna validación de formato puede atrapar:
   * el cemento se vende por saco a $6.490, y el admin teclea "4900" de costo
   * creyendo que es por saco. El sistema lo guarda por KILO, así que ese saco
   * pasa a costar $122.500 y a valer $6.490. Los números crudos —4900 contra
   * 6490— se ven perfectamente sanos; solo al llevarlos a la misma unidad se
   * nota. Por eso el aviso compara convertido.
   */
  it("detecta el costo cargado en la unidad equivocada", async () => {
    const cemento = ["Cemento Polpaico saco", "", "", "", "", "sc25", "sc25", "6.490", "4.900", "", ""];
    const body = JSON.parse((await subir(await excel([cemento]), false)).body);
    expect(body.conError).toBe(0); // no es un error de formato: es válido
    expect(body.avisos).toHaveLength(1);

    const texto = body.avisos[0].avisos.join(" ");
    expect(texto).toContain("$122.500 por sc25"); // 4.900 × 25 kg
    expect(texto).toContain("$6.490 por sc25");
    expect(texto).toContain("se lee por kg");
    expect(texto).toContain("Son unidades distintas");
  });

  it("no avisa cuando el costo convertido sí es menor", async () => {
    const bien = ["Cemento bien cargado", "", "", "", "", "sc25", "sc25", "6.490", "180", "", ""];
    const body = JSON.parse((await subir(await excel([bien]), false)).body);
    expect(body.conError).toBe(0);
    expect(body.avisos).toEqual([]); // 180 × 25 = $4.500 < $6.490
  });

  it("una fila normal no genera avisos", async () => {
    const body = JSON.parse((await subir(await excel([FILA_OK_2]), false)).body);
    expect(body.avisos).toEqual([]);
  });

  it("todavía acepta un encabezado con los títulos cortos de antes", async () => {
    const corto = ENCABEZADO.map((c) => (c.startsWith("Precio") ? "Precio con IVA" : c.startsWith("Costo") ? "Costo neto" : c.startsWith("Stock") ? "Stock mínimo" : c));
    const body = JSON.parse((await subir(await excel([FILA_OK_2], corto), false)).body);
    expect(body.conError).toBe(0);
    expect(body.validas).toBe(1);
  });
});
