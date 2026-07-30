/**
 * Catálogo: la validación de un producto vive acá, en UN solo lugar
 * (tareas 1.1, 1.2, 1.6 y 1.7).
 *
 * Por qué en `shared` y no en la ruta del servidor: este sprint le abre DOS
 * puertas al mismo dato —el formulario del admin y el importador de Excel—.
 * Si el importador valida por su cuenta, se convierte en la puerta por donde
 * entra lo que el formulario rechaza, y eso no se descubre el día de la carga
 * sino meses después, cuando el kardex miente. Es el mismo patrón que ya usa
 * `settings.ts`: un registro, dos consumidores.
 *
 * El invariante "unidad de venta y de compra son del mismo grupo" NO se puede
 * expresar en Zod sobre los ids: hay que mirar las filas de `Unit`. Por eso
 * viene aparte, en `validarUnidades`, y lo llaman los dos consumidores con las
 * unidades ya resueltas.
 */
import { z } from "zod";

// ============================================================
// Piezas sueltas
// ============================================================

/** Id de relación opcional: `null` significa "sin categoría", no "no tocar". */
const idOpcional = z.number().int().positive().nullable().optional();

const nombre = (que: string, max = 120) =>
  z
    .string()
    .trim()
    .min(2, `El nombre ${que} necesita al menos 2 caracteres`)
    .max(max, `El nombre ${que} no puede pasar de ${max} caracteres`);

/**
 * Un código de barras se normaliza antes de compararlo. Sin esto, el mismo
 * código escaneado con un espacio al final entra como producto distinto y el
 * `@unique` de la base no lo ve venir.
 */
export function normalizeBarcode(code: string): string {
  return code.trim().replace(/\s+/g, "").toUpperCase();
}

/**
 * Clave de búsqueda: sin tildes, sin ñ, en minúsculas (tarea 1.5).
 *
 * SQLite no sabe comparar texto acentuado ignorando mayúsculas: su `LIKE` es
 * insensible solo en el rango ASCII. Sin normalizar, buscar "cañeria" no
 * encuentra "Cañería", y buscar "CAÑERIA" tampoco encuentra "cañería" —la Ñ
 * y la ñ son letras distintas para el motor—. En una ferretería chilena eso
 * es media repisa invisible.
 *
 * Por eso el producto guarda una columna ya normalizada y la búsqueda compara
 * contra ella. Se escribe en el mismo lugar donde se escribe el producto, así
 * que no puede quedar desincronizada.
 */
export function normalizeSearch(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // saca las tildes que NFD dejó sueltas
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Lo que se guarda en `Product.searchKey`: nombre, SKU y códigos, juntos. */
export function buildSearchKey(p: { name: string; sku: string; barcodes?: string[] }): string {
  return normalizeSearch([p.name, p.sku, ...(p.barcodes ?? [])].join(" "));
}

export const barcodeSchema = z
  .string()
  .transform(normalizeBarcode)
  .pipe(
    z
      .string()
      .min(4, "Un código de barras necesita al menos 4 caracteres")
      .max(48, "Ese código de barras es demasiado largo")
      .regex(/^[A-Z0-9._-]+$/, "El código de barras solo acepta letras, números, punto, guion y guion bajo"),
  );

// ============================================================
// Producto
// ============================================================

export const productInputSchema = z.object({
  name: nombre("del producto"),
  description: z.string().trim().max(500).nullable().optional(),

  categoryId: idOpcional,
  brandId: idOpcional,
  supplierId: idOpcional,

  saleUnitId: z.number().int().positive("Falta la unidad de venta"),
  purchaseUnitId: z.number().int().positive("Falta la unidad de compra"),

  /** Precio de repisa por unidad de VENTA, IVA incluido (decisión sellada 1). */
  priceGross: z
    .number()
    .int("El precio va en pesos enteros: el peso chileno no tiene decimales")
    .min(0, "El precio no puede ser negativo"),

  /**
   * Costo NETO por unidad BASE, en milésimas de peso. Se digita solo para
   * arrancar: ver `puedeEditarCosto` más abajo.
   */
  costNetMilliPeso: z.number().int().min(0, "El costo no puede ser negativo").optional(),

  reorderLevelBaseMilli: z.number().int().min(0, "El stock mínimo no puede ser negativo").default(0),

  barcodes: z.array(barcodeSchema).max(20, "Veinte códigos de barra por producto son suficientes").default([]),

  active: z.boolean().default(true),
});

export type ProductInput = z.infer<typeof productInputSchema>;

/** En la edición todo es opcional, pero lo que venga se valida igual. */
export const productPatchSchema = productInputSchema.partial();
export type ProductPatch = z.infer<typeof productPatchSchema>;

/**
 * El costo se puede DIGITAR mientras el producto no tenga movimientos; desde el
 * primer movimiento lo manda el libro.
 *
 * Motivo: hasta el Sprint 4 no existen compras, así que no hay otra forma de
 * cargar el costo del inventario inicial que tecleándolo. Pero en cuanto entra
 * mercadería, `costNetMilliPeso` pasa a ser el PMP —un caché reconstruible
 * desde `StockMovement`— y dejarlo editable significaría que un tecleo puede
 * contradecir al libro sin dejar rastro. La regla se apaga sola: nadie tiene
 * que acordarse de quitar el campo en el Sprint 4.
 */
export function puedeEditarCosto(cantidadDeMovimientos: number): boolean {
  return cantidadDeMovimientos === 0;
}

// ============================================================
// El invariante de unidades (tarea 1.7)
// ============================================================

/** Lo mínimo que hay que saber de una unidad para validar y explicar. */
export type UnitLike = {
  id: number;
  groupId: number;
  name: string;
  symbol: string;
  factorMilli: number;
};

/**
 * `saleUnit` y `purchaseUnit` tienen que ser del MISMO `UnitGroup`.
 *
 * Si no lo son, la conversión de compra a venta se hace igual —los dos son
 * números— pero sobre magnitudes distintas: comprar en "Bidón 20 L" y vender
 * en "Kilogramo" da un kardex que se ve sano y miente un 13%, porque el
 * diluyente pesa 0,87 kg/L. Es el ejemplo que motivó el grupo VOLUMEN en
 * `.agents/SEED.md`.
 *
 * Devuelve el mensaje de error, o `null` si están bien.
 */
export function validarUnidades(saleUnit: UnitLike, purchaseUnit: UnitLike): string | null {
  if (saleUnit.groupId !== purchaseUnit.groupId) {
    return `No se puede comprar en ${purchaseUnit.name} y vender en ${saleUnit.name}: son magnitudes distintas. Ambas unidades tienen que ser del mismo grupo.`;
  }
  return null;
}

/**
 * El texto que la UI muestra bajo el selector de unidades (tarea 1.7).
 * Se arma acá para que diga lo mismo en el formulario, en el detalle y en el
 * reporte de errores del importador.
 */
export function describirConversion(saleUnit: UnitLike, purchaseUnit: UnitLike): string {
  if (saleUnit.id === purchaseUnit.id) {
    return `Se compra y se vende en ${saleUnit.name} (${saleUnit.symbol}).`;
  }
  const veces = purchaseUnit.factorMilli / saleUnit.factorMilli;
  const cuantas = new Intl.NumberFormat("es-CL", { maximumFractionDigits: 3 }).format(veces);
  return `Se compra en ${purchaseUnit.name}, se vende en ${saleUnit.name}: cada ${purchaseUnit.name} rinde ${cuantas} ${saleUnit.symbol}.`;
}

// ============================================================
// Categorías, marcas y proveedores (tarea 1.4)
// ============================================================

export const categoryInputSchema = z.object({ name: nombre("de la categoría", 60) });
export const brandInputSchema = z.object({ name: nombre("de la marca", 60) });

export const supplierInputSchema = z.object({
  name: nombre("del proveedor"),
  // El RUT se guarda normalizado sin puntos y con guion, que es como lo pide
  // el SII. Validar el dígito verificador queda para cuando se emitan DTE.
  rut: z
    .string()
    .trim()
    .transform((v) => v.replace(/\./g, "").toUpperCase())
    .pipe(z.string().regex(/^\d{7,8}-[\dK]$/, "El RUT va como 12345678-9"))
    .nullable()
    .optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email("Ese correo no es válido").nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().default(true),
});

// ============================================================
// Lectura de números tecleados o pegados desde Excel
// ============================================================

/**
 * Texto chileno → entero. Acepta "12.990", "$12.990", "12990".
 *
 * El punto acá es SIEMPRE separador de miles, nunca decimal: el peso no tiene
 * decimales, así que "12.990" es doce mil novecientos noventa y no doce coma
 * nueve nueve. Devuelve `null` si no se entiende, para que quien llama decida
 * si es un error de fila o un campo vacío.
 */
export function parsePesos(texto: string | number | null | undefined): number | null {
  if (texto == null || texto === "") return null;
  if (typeof texto === "number") return Number.isFinite(texto) ? Math.trunc(texto) : null;
  const limpio = texto.trim().replace(/^\$/, "").replace(/\./g, "").replace(/\s/g, "");
  if (!/^-?\d+$/.test(limpio)) return null;
  return Number(limpio);
}

/**
 * Texto chileno → milésimas. Acepta "7,5", "1.250,75", "7", "7.5".
 *
 * Regla de desambiguación, y es la parte que se puede hacer mal: si hay coma,
 * la coma es el decimal y los puntos son miles. Si NO hay coma y hay un solo
 * punto seguido de 1 a 3 dígitos, se interpreta como decimal —es lo que
 * escribe quien tiene el Excel en inglés—. Cualquier otro punto es de miles.
 */
export function parseCantidadMilli(texto: string | number | null | undefined): number | null {
  if (texto == null || texto === "") return null;
  if (typeof texto === "number") return Number.isFinite(texto) ? Math.round(texto * 1000) : null;

  const t = texto.trim().replace(/\s/g, "");
  let normalizado: string;

  if (t.includes(",")) {
    normalizado = t.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d+\.\d{1,3}$/.test(t)) {
    normalizado = t;
  } else {
    normalizado = t.replace(/\./g, "");
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalizado)) return null;
  const valor = Number(normalizado);
  if (!Number.isFinite(valor)) return null;
  // Redondeo simétrico: `Math.round(-2.5)` da -2 y rompería el signo.
  return Math.sign(valor) * Math.round(Math.abs(valor) * 1000);
}

/**
 * Los grupos sin fracción (CONTEO) no admiten media unidad: medio tornillo no
 * existe. Se valida al escribir la cantidad, no al leerla.
 */
export function validarFraccion(qtyMilli: number, allowsFraction: boolean, unitName: string): string | null {
  if (allowsFraction) return null;
  if (qtyMilli % 1000 !== 0) {
    return `${unitName} no se vende fraccionada: la cantidad tiene que ser un número entero.`;
  }
  return null;
}
