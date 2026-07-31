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
import { registrarMovimiento } from "../stock-ledger.js";
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
  roundSym,
} from "@ferrehouse/shared";

/**
 * Las columnas de la plantilla. El match se hace por NOMBRE normalizado, así
 * que mover una columna no rompe la carga; los `alias` aceptan la forma corta
 * por si alguien reusa una plantilla vieja.
 *
 * LOS TÍTULOS DICEN LA UNIDAD, y no es adorno. El precio va por unidad de
 * VENTA y el costo por unidad BASE: son dos magnitudes distintas en columnas
 * vecinas, y coinciden solo cuando la unidad de venta ES la base. Dejan de
 * coincidir justo en los productos que motivaron todo el sistema de unidades
 * —el saco de 25 kg, la caja de 100, la docena—. Sin el título, quien llena el
 * Excel escribe el precio del saco donde el sistema espera el del kilo, la
 * carga no da ningún error, y el margen, el inventario valorizado y la alerta
 * de reposición heredan el número equivocado para siempre.
 */
const COLUMNAS = [
  { clave: "nombre", titulo: "Nombre", alias: [], obligatoria: true, ancho: 38 },
  { clave: "descripcion", titulo: "Descripción", alias: [], obligatoria: false, ancho: 30 },
  { clave: "categoria", titulo: "Categoría", alias: [], obligatoria: false, ancho: 18 },
  { clave: "marca", titulo: "Marca", alias: [], obligatoria: false, ancho: 16 },
  { clave: "proveedor", titulo: "Proveedor", alias: [], obligatoria: false, ancho: 20 },
  { clave: "unidadVenta", titulo: "Unidad de venta", alias: [], obligatoria: true, ancho: 18 },
  { clave: "unidadCompra", titulo: "Unidad de compra", alias: [], obligatoria: true, ancho: 18 },
  { clave: "precio", titulo: "Precio con IVA (por unidad de venta)", alias: ["Precio con IVA", "Precio"], obligatoria: true, ancho: 30 },
  { clave: "costo", titulo: "Costo neto (por unidad base)", alias: ["Costo neto", "Costo"], obligatoria: false, ancho: 26 },
  { clave: "stockMinimo", titulo: "Stock mínimo (en unidad base)", alias: ["Stock mínimo"], obligatoria: false, ancho: 26 },
  {
    clave: "stockInicial",
    titulo: "Stock inicial (en unidad base)",
    alias: ["Stock inicial", "Existencia inicial"],
    obligatoria: false,
    ancho: 26,
  },
  { clave: "codigos", titulo: "Códigos de barra", alias: [], obligatoria: false, ancho: 26 },
] as const;

/** ¿Este título de celda corresponde a esta columna? */
function esColumna(titulo: string, col: (typeof COLUMNAS)[number]): boolean {
  const t = normalizeSearch(titulo);
  return t === normalizeSearch(col.titulo) || col.alias.some((a) => normalizeSearch(a) === t);
}

type Clave = (typeof COLUMNAS)[number]["clave"];
type Fila = Partial<Record<Clave, string>>;

type FilaRevisada = {
  fila: number;
  nombre: string;
  errores: string[];
  /** Advertencias que NO impiden importar, pero que conviene mirar. */
  avisos: string[];
  /** Cómo quedó interpretada la fila, en castellano y con sus unidades. */
  interpretacion?: string;
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
    /** Lo que hay hoy en repisa. Entra al libro como movimiento `INITIAL`. */
    stockInicialBaseMilli: number;
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
    const titulo = celda(c.value);
    const columna = COLUMNAS.find((x) => esColumna(titulo, x));
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
  // La unidad base de cada grupo: el costo y el stock mínimo se expresan en
  // ella, y el informe tiene que poder nombrarla.
  const baseDeGrupo = new Map<number, string>(
    (await db.unit.findMany({ where: { isBase: true }, select: { groupId: true, symbol: true } })).map((u) => [
      u.groupId,
      u.symbol,
    ]),
  );
  // Los grupos sin fracción (CONTEO) no admiten medio tornillo, y el stock
  // inicial se digita en unidad base: hay que poder rechazarlo acá.
  const fraccionDeGrupo = new Map<number, boolean>(
    (await db.unitGroup.findMany({ select: { id: true, allowsFraction: true } })).map((g) => [g.id, g.allowsFraction]),
  );
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

    /**
     * 4.4 — El inventario inicial entra por acá, como movimiento `INITIAL`.
     *
     * Es la ÚNICA forma de que el libro arranque con saldo sin inventar una
     * compra a un proveedor que nunca facturó eso. Y exige costo: mercadería
     * que entra sin costo deja el promedio en cero y el margen de todo lo que
     * se venda después sale igual al precio.
     */
    const inicial = parseCantidadMilli(f.stockInicial ?? "");
    if (f.stockInicial && inicial === null) errores.push(`No entiendo el stock inicial "${f.stockInicial}"`);
    if (inicial !== null && inicial < 0) errores.push("El stock inicial no puede ser negativo");
    if (inicial && inicial > 0 && !costo) {
      errores.push("Hay stock inicial pero no hay costo: sin costo, el margen de ese producto sale igual al precio");
    }
    if (inicial && uVenta && fraccionDeGrupo.get(uVenta.groupId) === false && inicial % 1000 !== 0) {
      errores.push(`${uVenta.name} no se cuenta fraccionado: el stock inicial tiene que ser un número entero`);
    }

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
      return { fila: numeroDeFila, nombre, errores: errores.length ? errores : ["Fila inválida"], avisos: [] };
    }

    /**
     * Cómo quedó entendida la fila, con las unidades escritas. Es la mitad útil
     * del informe previo: sin esto, una fila que parsea limpio es invisible, y
     * el error de cargar el precio del saco donde el sistema espera el del kilo
     * pasa sin que nadie lo vea — no es un error de formato, así que ninguna
     * validación lo puede atrapar.
     */
    const simboloBase = baseDeGrupo.get(uVenta.groupId) ?? "?";
    const pesos = (n: number) => "$" + new Intl.NumberFormat("es-CL", { maximumFractionDigits: 0 }).format(n);
    const partes = [`${pesos(parsed.data.priceGross)} por ${uVenta.symbol}`];
    if (costo) partes.push(`costo ${pesos(costo)} por ${simboloBase}`);
    if (minimo) {
      partes.push(
        `mínimo ${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 3 }).format(minimo / 1000)} ${simboloBase}`,
      );
    }
    if (inicial) {
      partes.push(
        `entran ${new Intl.NumberFormat("es-CL", { maximumFractionDigits: 3 }).format(inicial / 1000)} ${simboloBase}`,
      );
    }
    if (uVenta.id !== uCompra.id) partes.push(`se compra en ${uCompra.symbol}`);

    const avisos: string[] = [];
    /**
     * Costo contra precio, PERO llevados a la misma unidad: el costo viene por
     * unidad base y el precio por unidad de venta.
     *
     * Comparar los números crudos no serviría de nada, y sería justamente
     * ciego al error que este aviso persigue: cemento que se vende en sacos, a
     * $6.490 el saco, con el costo tecleado como "4900" creyendo que era por
     * saco. Guardado por kilo, ese saco cuesta $122.500 y vale $6.490. Los
     * números crudos (4900 contra 6490) se ven perfectamente sanos.
     *
     * No bloquea: hay liquidaciones de verdad, y el aviso es para mirar.
     */
    if (costo) {
      const costoPorUnidadDeVenta = (costo * uVenta.factorMilli) / 1000;
      if (costoPorUnidadDeVenta >= parsed.data.priceGross) {
        const mismaUnidad = uVenta.symbol === simboloBase;
        avisos.push(
          `El costo sale ${pesos(Math.round(costoPorUnidadDeVenta))} por ${uVenta.symbol} y el precio es ` +
            `${pesos(parsed.data.priceGross)} por ${uVenta.symbol}: no es menor. ` +
            (mismaUnidad
              ? "Revisa la fila."
              : `Ojo: escribiste ${pesos(costo)} de costo, que se lee por ${simboloBase} —no por ${uVenta.symbol}—. ` +
                "Son unidades distintas."),
        );
      }
    }

    return {
      fila: numeroDeFila,
      nombre,
      errores: [],
      avisos,
      interpretacion: `${parsed.data.name} — ${partes.join(" · ")}`,
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
        stockInicialBaseMilli: inicial ?? 0,
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

    // Las notas de las dos columnas de plata dicen la unidad con un ejemplo
    // concreto. Es el error más caro de esta plantilla y el único que ninguna
    // validación puede atrapar, porque el número es perfectamente válido.
    const NOTAS: Partial<Record<Clave, string>> = {
      precio: "Por UNIDAD DE VENTA. Si vendes el cemento por kilo, va el precio del kilo — no el del saco.",
      costo: "Por UNIDAD BASE del grupo (kg, m, un, L). Ojo: no siempre es la misma unidad que el precio.",
      stockMinimo: "En unidad base. Acepta decimales con coma: 7,5",
      stockInicial: "Lo que hay hoy en repisa, en unidad base. Entra como movimiento INITIAL y exige costo",
      codigos: "Varios códigos separados por coma.",
      unidadVenta: "Escribe el símbolo de la hoja 'Unidades disponibles': m, kg, un, sc25…",
      unidadCompra: "Tiene que ser del mismo grupo que la de venta.",
    };
    hoja.getRow(1).eachCell((c, i) => {
      const col = COLUMNAS[i - 1]!;
      const nota = [col.obligatoria ? "Obligatoria." : null, NOTAS[col.clave] ?? null].filter(Boolean).join(" ");
      if (nota) c.note = nota;
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
      stockInicial: "120",
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
      // Cómo quedó entendida cada fila buena, con sus unidades escritas. Es lo
      // que permite ver el precio cargado en la unidad equivocada, que ninguna
      // validación puede atrapar porque no es un error de formato.
      interpretadas: validas.map((r) => ({ fila: r.fila, dice: r.interpretacion! })),
      avisos: validas.filter((r) => r.avisos.length > 0).map((r) => ({ fila: r.fila, nombre: r.nombre, avisos: r.avisos })),
      seCrearan: nuevos,
    };

    if (!confirmar) {
      return {
        ...informe,
        importado: false,
        mensaje:
          conError.length > 0
            ? `Hay ${conError.length} fila${conError.length > 1 ? "s" : ""} con problemas. No se importó nada.`
            : `${validas.length} productos listos para importar. Revisa cómo quedaron entendidos y confirma.`,
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

        /**
         * 4.4 — El inventario inicial, como movimiento del libro y no como un
         * saldo puesto a mano. Escribir `StockLevel` directamente dejaría un
         * saldo que el libro no explica, y el job de reconciliación (4.7) lo
         * acusaría —con razón— como divergencia en la primera pasada.
         */
        if (d.stockInicialBaseMilli > 0) {
          await registrarMovimiento(tx, {
            productId: producto.id,
            locationId: req.user.locationId,
            type: "INITIAL",
            qtyBaseMilli: d.stockInicialBaseMilli,
            totalCostNet: roundSym((d.stockInicialBaseMilli * d.costNetMilliPeso) / 1_000_000),
            userId: req.user.sub,
            reason: "Carga de inventario inicial",
          });
        }
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
