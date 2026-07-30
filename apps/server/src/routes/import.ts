/**
 * Importador de productos desde Excel (tarea 1.6, CAT-11).
 * Es cómo se carga el inventario inicial: 500 filas de una vez.
 *
 * Dos decisiones que vale la pena entender antes de tocar esto:
 *
 * 1. **Valida con el MISMO esquema que el formulario** (`@ferrehouse/shared`).
 *    Si validara por su cuenta, este archivo sería la puerta por donde entra lo
 *    que el formulario rechaza, y nadie se enteraría hasta que el kardex
 *    mintiera meses después.
 *
 * 2. **Todo o nada.** Si una fila falla, no entra ninguna. Cargar 497 de 500 es
 *    peor que no cargar nada: el admin no sabe cuáles entraron, y la corrección
 *    es revisar 500 filas a mano. El informe dice fila por fila qué está mal,
 *    se arregla el Excel y se sube de nuevo.
 *
 * El flujo es: subir → informe (no escribe nada) → confirmar. El informe
 * también muestra qué categorías, marcas y proveedores NUEVOS se crearían, que
 * es donde se ven los errores de tipeo antes de que existan.
 */
import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import ExcelJS from "exceljs";
import { db } from "../db.js";
import { audit } from "../audit.js";
import { requireRole } from "../roles.js";
import { reserveSkuRange } from "../sku.js";
import {
  productInputSchema,
  validarUnidades,
  normalizeSearch,
  normalizeBarcode,
  buildSearchKey,
  parsePesos,
  parseCantidadMilli,
  type UnitLike,
} from "@ferrehouse/shared";

/**
 * Las columnas de la plantilla. El orden es el que ve el admin; el match se
 * hace por NOMBRE normalizado, así que mover una columna no rompe la carga.
 */
const COLUMNAS = [
  { clave: "nombre", titulo: "Nombre", obligatoria: true, ancho: 38 },
  { clave: "descripcion", titulo: "Descripción", obligatoria: false, ancho: 30 },
  { clave: "categoria", titulo: "Categoría", obligatoria: false, ancho: 18 },
  { clave: "marca", titulo: "Marca", obligatoria: false, ancho: 16 },
  { clave: "proveedor", titulo: "Proveedor", obligatoria: false, ancho: 20 },
  { clave: "unidadVenta", titulo: "Unidad de venta", obligatoria: true, ancho: 18 },
  { clave: "unidadCompra", titulo: "Unidad de compra", obligatoria: true, ancho: 18 },
  { clave: "precio", titulo: "Precio con IVA", obligatoria: true, ancho: 15 },
  { clave: "costo", titulo: "Costo neto", obligatoria: false, ancho: 14 },
  { clave: "stockMinimo", titulo: "Stock mínimo", obligatoria: false, ancho: 14 },
  { clave: "codigos", titulo: "Códigos de barra", obligatoria: false, ancho: 26 },
] as const;

type Clave = (typeof COLUMNAS)[number]["clave"];
type Fila = Partial<Record<Clave, string>>;

type FilaRevisada = {
  fila: number;
  nombre: string;
  errores: string[];
  datos?: {
    name: string;
    description: string | null;
    categoria: string | null;
    marca: string | null;
    proveedor: string | null;
    saleUnitId: number;
    purchaseUnitId: number;
    priceGross: number;
    costNetMilliPeso: number;
    reorderLevelBaseMilli: number;
    barcodes: string[];
  };
};

function error(mensaje: string, code = 400): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = code;
  return e;
}

/** Texto de una celda, venga como venga: número, fórmula, fecha o texto. */
function celda(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text.trim();
    if ("result" in v) return celda(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((r) => r.text).join("").trim();
    return "";
  }
  return String(v).trim();
}

/** Busca una unidad por símbolo o por nombre, sin importar tildes ni mayúsculas. */
function buscarUnidad(texto: string, unidades: UnitLike[]): UnitLike | undefined {
  const t = normalizeSearch(texto);
  return (
    unidades.find((u) => normalizeSearch(u.symbol) === t) ?? unidades.find((u) => normalizeSearch(u.name) === t)
  );
}

/** Lee el archivo y devuelve una fila por producto, con las claves de COLUMNAS. */
async function leerExcel(buffer: Buffer): Promise<Fila[]> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw error("No se pudo leer el archivo. Tiene que ser un Excel .xlsx, no un .xls ni un PDF");
  }
  const hoja = wb.worksheets[0];
  if (!hoja) throw error("El archivo no tiene ninguna hoja");

  const encabezado = hoja.getRow(1);
  const posicion = new Map<number, Clave>();
  encabezado.eachCell((c, col) => {
    const titulo = normalizeSearch(celda(c.value));
    const columna = COLUMNAS.find((x) => normalizeSearch(x.titulo) === titulo);
    if (columna) posicion.set(col, columna.clave);
  });

  const faltantes = COLUMNAS.filter((c) => c.obligatoria && ![...posicion.values()].includes(c.clave));
  if (faltantes.length > 0) {
    throw error(
      `Al Excel le faltan columnas obligatorias: ${faltantes.map((f) => f.titulo).join(", ")}. ` +
        "Descarga la plantilla desde el mismo botón y vuelve a intentar.",
    );
  }

  const filas: Fila[] = [];
  for (let n = 2; n <= hoja.rowCount; n++) {
    const r = hoja.getRow(n);
    const fila: Fila = {};
    let tieneAlgo = false;
    for (const [col, clave] of posicion) {
      const v = celda(r.getCell(col).value);
      if (v) tieneAlgo = true;
      fila[clave] = v;
    }
    if (tieneAlgo) filas.push(fila);
  }
  return filas;
}

/**
 * Valida cada fila con el esquema compartido. No escribe nada: devuelve el
 * informe completo para que el admin lo mire antes de confirmar.
 */
async function revisar(filas: Fila[]): Promise<FilaRevisada[]> {
  const unidades: UnitLike[] = await db.unit.findMany({
    select: { id: true, groupId: true, name: true, symbol: true, factorMilli: true },
  });
  const codigosUsados = new Map<string, string>(
    (await db.productBarcode.findMany({ select: { code: true, product: { select: { sku: true } } } })).map((b) => [
      b.code,
      b.product.sku,
    ]),
  );
  // Los códigos repetidos DENTRO del mismo Excel también son un choque, y son
  // el caso más común: copiar y pegar una fila y olvidar cambiar el código.
  const vistosEnElArchivo = new Map<string, number>();

  return filas.map((f, i) => {
    const numeroDeFila = i + 2; // +1 por el encabezado, +1 porque Excel cuenta desde 1
    const errores: string[] = [];
    const nombre = f.nombre ?? "";

    const uVenta = f.unidadVenta ? buscarUnidad(f.unidadVenta, unidades) : undefined;
    const uCompra = f.unidadCompra ? buscarUnidad(f.unidadCompra, unidades) : undefined;
    if (f.unidadVenta && !uVenta) errores.push(`La unidad de venta "${f.unidadVenta}" no existe`);
    if (f.unidadCompra && !uCompra) errores.push(`La unidad de compra "${f.unidadCompra}" no existe`);
    if (uVenta && uCompra) {
      const problema = validarUnidades(uVenta, uCompra);
      if (problema) errores.push(problema);
    }

    const precio = parsePesos(f.precio ?? "");
    if (f.precio && precio === null) errores.push(`No entiendo el precio "${f.precio}"`);
    const costo = parsePesos(f.costo ?? "");
    if (f.costo && costo === null) errores.push(`No entiendo el costo "${f.costo}"`);
    const minimo = parseCantidadMilli(f.stockMinimo ?? "");
    if (f.stockMinimo && minimo === null) errores.push(`No entiendo el stock mínimo "${f.stockMinimo}"`);

    const codigos = (f.codigos ?? "")
      .split(/[,;|]/)
      .map((c) => normalizeBarcode(c))
      .filter(Boolean);
    for (const c of codigos) {
      const duenoPrevio = codigosUsados.get(c);
      if (duenoPrevio) errores.push(`El código ${c} ya es del producto ${duenoPrevio}`);
      const filaPrevia = vistosEnElArchivo.get(c);
      if (filaPrevia) errores.push(`El código ${c} ya aparece en la fila ${filaPrevia} de este mismo archivo`);
      else vistosEnElArchivo.set(c, numeroDeFila);
    }

    // El esquema compartido dice la última palabra sobre nombre, precio y todo
    // lo demás: los mensajes salen de ahí, no se reescriben acá.
    const parsed = productInputSchema.safeParse({
      name: nombre,
      description: f.descripcion || null,
      saleUnitId: uVenta?.id ?? 0,
      purchaseUnitId: uCompra?.id ?? 0,
      priceGross: precio ?? -1,
      // El costo se digita en PESOS por unidad base y se guarda en milésimas.
      costNetMilliPeso: (costo ?? 0) * 1000,
      reorderLevelBaseMilli: minimo ?? 0,
      barcodes: codigos,
      active: true,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        // Los ids de unidad ya tienen su propio mensaje, más útil que "falta".
        if (issue.path[0] === "saleUnitId" || issue.path[0] === "purchaseUnitId") continue;
        errores.push(issue.message);
      }
    }

    if (errores.length > 0 || !parsed.success || !uVenta || !uCompra) {
      return { fila: numeroDeFila, nombre, errores: errores.length ? errores : ["Fila inválida"] };
    }

    return {
      fila: numeroDeFila,
      nombre,
      errores: [],
      datos: {
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        categoria: f.categoria || null,
        marca: f.marca || null,
        proveedor: f.proveedor || null,
        saleUnitId: uVenta.id,
        purchaseUnitId: uCompra.id,
        priceGross: parsed.data.priceGross,
        costNetMilliPeso: parsed.data.costNetMilliPeso ?? 0,
        reorderLevelBaseMilli: parsed.data.reorderLevelBaseMilli,
        barcodes: parsed.data.barcodes,
      },
    };
  });
}

/** Qué categorías, marcas y proveedores NO existen todavía. Acá se ven los typos. */
async function nuevosPorCrear(revisadas: FilaRevisada[]) {
  const junta = (f: (d: NonNullable<FilaRevisada["datos"]>) => string | null) =>
    [...new Set(revisadas.map((r) => (r.datos ? f(r.datos) : null)).filter((x): x is string => !!x))];

  const categorias = junta((d) => d.categoria);
  const marcas = junta((d) => d.marca);
  const proveedores = junta((d) => d.proveedor);

  const existentes = async (nombres: string[], tabla: "category" | "brand" | "supplier") => {
    if (nombres.length === 0) return new Set<string>();
    const filas = await (db[tabla] as { findMany: (a: unknown) => Promise<{ name: string }[]> }).findMany({
      where: { name: { in: nombres } },
      select: { name: true },
    });
    return new Set(filas.map((f) => f.name));
  };

  const [hayCat, hayMar, hayProv] = await Promise.all([
    existentes(categorias, "category"),
    existentes(marcas, "brand"),
    existentes(proveedores, "supplier"),
  ]);

  return {
    categorias: categorias.filter((n) => !hayCat.has(n)),
    marcas: marcas.filter((n) => !hayMar.has(n)),
    proveedores: proveedores.filter((n) => !hayProv.has(n)),
  };
}

export async function registerImportRoutes(app: FastifyInstance): Promise<void> {
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
  const soloAdmin = { preHandler: requireRole("ADMIN") };

  /** La plantilla. Lleva las unidades reales de la tienda en una segunda hoja. */
  app.get("/api/import/products/template.xlsx", soloAdmin, async (_req, reply) => {
    const wb = new ExcelJS.Workbook();
    wb.creator = "Ferrehouse Manager";

    const hoja = wb.addWorksheet("Productos");
    hoja.columns = COLUMNAS.map((c) => ({ header: c.titulo, key: c.clave, width: c.ancho }));
    hoja.getRow(1).font = { bold: true };
    hoja.getRow(1).eachCell((c, i) => {
      const col = COLUMNAS[i - 1]!;
      if (col.obligatoria) c.note = "Obligatoria";
    });

    // Una fila de ejemplo, para que se vea el formato de los códigos múltiples.
    hoja.addRow({
      nombre: "Cable eléctrico 2,5 mm rojo",
      descripcion: "Ejemplo: borra esta fila antes de subir",
      categoria: "Eléctrico",
      marca: "Covisa",
      proveedor: "",
      unidadVenta: "m",
      unidadCompra: "rl100",
      precio: "690",
      costo: "410",
      stockMinimo: "50",
      codigos: "7801234567890, 7809999999999",
    });

    const ayuda = wb.addWorksheet("Unidades disponibles");
    ayuda.columns = [
      { header: "Grupo", key: "grupo", width: 14 },
      { header: "Unidad", key: "nombre", width: 20 },
      { header: "Escribe esto", key: "simbolo", width: 16 },
    ];
    ayuda.getRow(1).font = { bold: true };
    const grupos = await db.unitGroup.findMany({
      orderBy: { name: "asc" },
      include: { units: { orderBy: [{ isBase: "desc" }, { factorMilli: "asc" }] } },
    });
    for (const g of grupos) {
      for (const u of g.units) ayuda.addRow({ grupo: g.name, nombre: u.name, simbolo: u.symbol });
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    return reply
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", 'attachment; filename="plantilla-productos.xlsx"')
      .send(buffer);
  });

  /**
   * Subir. Por omisión solo informa; con `confirmar=true` escribe, y solo si
   * NO hay ni una fila con error.
   */
  app.post("/api/import/products", soloAdmin, async (req, reply) => {
    const archivo = await req.file();
    if (!archivo) throw error("No llegó ningún archivo");
    const confirmar = String((archivo.fields as Record<string, { value?: unknown }>)?.confirmar?.value ?? "") === "true";

    const filas = await leerExcel(await archivo.toBuffer());
    if (filas.length === 0) throw error("El Excel no tiene ninguna fila con datos");

    const revisadas = await revisar(filas);
    const conError = revisadas.filter((r) => r.errores.length > 0);
    const validas = revisadas.filter((r) => r.datos);
    const nuevos = await nuevosPorCrear(revisadas);

    const informe = {
      total: revisadas.length,
      validas: validas.length,
      conError: conError.length,
      // Se devuelven TODAS las filas con error, no las primeras diez: el admin
      // arregla el Excel de una pasada, no de diez subidas.
      errores: conError.map((r) => ({ fila: r.fila, nombre: r.nombre, errores: r.errores })),
      seCrearan: nuevos,
    };

    if (!confirmar) {
      return {
        ...informe,
        importado: false,
        mensaje:
          conError.length > 0
            ? `Hay ${conError.length} fila${conError.length > 1 ? "s" : ""} con problemas. No se importó nada.`
            : `${validas.length} productos listos para importar. Confirma para cargarlos.`,
      };
    }

    if (conError.length > 0) {
      return reply.code(400).send({
        ...informe,
        importado: false,
        mensaje: `No se importó nada: hay ${conError.length} fila${conError.length > 1 ? "s" : ""} con problemas. Corrige el Excel y vuelve a subirlo.`,
      });
    }

    // --- Escritura ---
    const ubicaciones = await db.location.findMany({ where: { active: true }, select: { id: true } });
    // UN rango para las N filas, no un correlativo por fila: con
    // connection_limit=1, pedir 500 números son 500 escrituras serializadas
    // contra la misma fila de Counter.
    const skus = await reserveSkuRange(validas.length);

    const creados = await db.$transaction(async (tx) => {
      const idPorNombre = async (tabla: "category" | "brand" | "supplier", nombres: string[]) => {
        const mapa = new Map<string, number>();
        for (const n of [...new Set(nombres)]) {
          const cliente = tx[tabla] as {
            findFirst: (a: unknown) => Promise<{ id: number } | null>;
            create: (a: unknown) => Promise<{ id: number }>;
          };
          const existe = await cliente.findFirst({ where: { name: n }, select: { id: true } });
          mapa.set(n, existe ? existe.id : (await cliente.create({ data: { name: n } })).id);
        }
        return mapa;
      };

      const cats = await idPorNombre("category", validas.map((v) => v.datos!.categoria).filter((x): x is string => !!x));
      const marcas = await idPorNombre("brand", validas.map((v) => v.datos!.marca).filter((x): x is string => !!x));
      const provs = await idPorNombre("supplier", validas.map((v) => v.datos!.proveedor).filter((x): x is string => !!x));

      let n = 0;
      for (const v of validas) {
        const d = v.datos!;
        const sku = skus[n++]!;
        const producto = await tx.product.create({
          data: {
            sku,
            name: d.name,
            description: d.description,
            categoryId: d.categoria ? cats.get(d.categoria)! : null,
            brandId: d.marca ? marcas.get(d.marca)! : null,
            supplierId: d.proveedor ? provs.get(d.proveedor)! : null,
            saleUnitId: d.saleUnitId,
            purchaseUnitId: d.purchaseUnitId,
            priceGross: d.priceGross,
            costNetMilliPeso: d.costNetMilliPeso,
            reorderLevelBaseMilli: d.reorderLevelBaseMilli,
            searchKey: buildSearchKey({ name: d.name, sku, barcodes: d.barcodes }),
            barcodes: { create: d.barcodes.map((code) => ({ code })) },
          },
          select: { id: true },
        });
        // Igual que en el alta manual: la fila de stock nace con el producto,
        // en la misma transacción.
        await tx.stockLevel.createMany({
          data: ubicaciones.map((u) => ({ productId: producto.id, locationId: u.id, qtyBaseMilli: 0 })),
        });
      }
      return validas.length;
    });

    await audit({
      userId: req.user.sub,
      action: "PRODUCTS_IMPORTED",
      entity: "Product",
      payload: { cantidad: creados, desde: skus[0], hasta: skus[skus.length - 1] },
    });

    return {
      ...informe,
      importado: true,
      creados,
      rangoSku: { desde: skus[0], hasta: skus[skus.length - 1] },
      mensaje: `${creados} productos cargados, del ${skus[0]} al ${skus[skus.length - 1]}.`,
    };
  });
}
