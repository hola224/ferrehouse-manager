/**
 * Datos de demostración para poder EVALUAR la aplicación (2026-07-31).
 *
 * No es el seed y no lo reemplaza. El seed deja lo que una ferretería necesita
 * para existir —unidades, ubicación, caja, usuarios, settings— y por eso corre
 * en la tienda. Esto de acá deja lo que se necesita para *probar*: un catálogo
 * con productos de verdad, con marcas, proveedores y categorías, con saldo en
 * bodega y con historia en el kardex.
 *
 * POR QUÉ EXISTE: sin productos, media aplicación no se puede juzgar. El kardex
 * de un catálogo vacío es una pantalla en blanco, el buscador de la venta no
 * tiene qué sugerir, y el formulario de producto nuevo parece roto cuando en
 * realidad solo no hay ninguna categoría que elegir todavía.
 *
 * DOS REGLAS que lo hacen seguro de correr:
 *
 *   1. Es idempotente por nombre. Correrlo dos veces no duplica nada: el
 *      producto que ya está se salta, y lo dice.
 *   2. El stock entra por `registrarMovimiento`, el MISMO libro que usa una
 *      compra o una venta. Escribir `StockLevel` a mano sería más corto y
 *      dejaría el kardex mintiendo: saldo sin movimientos que lo expliquen.
 *
 * Se ejecuta con `pnpm --filter @ferrehouse/server db:demo`.
 */
import { db } from "../src/db.js";
import { registrarMovimiento } from "../src/stock-ledger.js";
import { nextSku } from "../src/sku.js";
import { buildSearchKey } from "@ferrehouse/shared";

type ProductoDemo = {
  name: string;
  categoria: string;
  marca: string;
  proveedor: string;
  /** Símbolo de la unidad de venta, tal como lo dejó el seed. */
  venta: string;
  /** Símbolo de la unidad de compra. Igual a `venta` cuando se compra suelto. */
  compra: string;
  /**
   * TODO LO QUE SIGUE VA EN UNIDADES DE VENTA, no en unidades base.
   *
   * Es la trampa de este archivo y ya cobró una víctima: escrito por unidad
   * base, un saco de cemento queda costando $4.350 **el kilo** y el reporte de
   * márgenes muestra pérdida en cada línea. Se lee y se escribe como habla el
   * dueño —«el saco sale 6.490 y me cuesta 4.350»— y la conversión a base la
   * hace el código, una sola vez, con el factor de la unidad.
   */
  /** Precio de repisa por unidad de venta, IVA incluido. */
  precio: number;
  /** Costo neto por unidad de VENTA, en pesos enteros. */
  costo: number;
  /** Cuánto entra al inventario inicial, en unidades de VENTA. */
  stock: number;
  /** Bajo este saldo (unidades de VENTA) el panel avisa. 0 = no avisa. */
  minimo?: number;
  /** Código de barras del envase, si el producto trae uno de fábrica. */
  barra?: string;
};

const CATEGORIAS = [
  "Fijaciones",
  "Electricidad",
  "Gasfitería",
  "Pinturas",
  "Herramientas",
  "Construcción",
  "Seguridad",
];

const MARCAS = ["Genérico", "Bosch", "Stanley", "Sika", "Tigre", "Vulco", "Melón", "Tricolor", "3M"];

const PROVEEDORES = [
  {
    name: "Distribuidora Ferretera del Sur",
    rut: "76.412.883-1",
    phone: "+56 41 274 5510",
    email: "ventas@ferreterasur.cl",
    notes: "Despacha martes y viernes. Pedido mínimo 5 UF.",
  },
  {
    name: "Comercial El Perno SpA",
    rut: "77.038.221-K",
    phone: "+56 9 8214 7733",
    email: "pedidos@elperno.cl",
    notes: "Retiro en bodega Talcahuano. Paga a 30 días.",
  },
  {
    name: "Importadora Andes Ltda.",
    rut: "78.554.109-6",
    phone: "+56 2 2887 4400",
    email: "contacto@impandes.cl",
    notes: "Solo importado: herramienta eléctrica y abrasivos.",
  },
];

const PRODUCTOS: ProductoDemo[] = [
  // --- Fijaciones (CONTEO: no admite fracción) ---
  { name: "Tornillo autoperforante 8x1 1/2\"", categoria: "Fijaciones", marca: "Genérico", proveedor: "Comercial El Perno SpA", venta: "un", compra: "cj100", precio: 45, costo: 22, stock: 2400, minimo: 500 },
  { name: "Tornillo volcanita 6x1\"", categoria: "Fijaciones", marca: "Genérico", proveedor: "Comercial El Perno SpA", venta: "un", compra: "mil", precio: 25, costo: 11, stock: 5000, minimo: 1000 },
  { name: "Perno hexagonal 1/2\" x 4\" grado 5", categoria: "Fijaciones", marca: "Genérico", proveedor: "Comercial El Perno SpA", venta: "un", compra: "cj25", precio: 890, costo: 430, stock: 180, minimo: 40 },
  { name: "Tarugo plástico 8 mm", categoria: "Fijaciones", marca: "Genérico", proveedor: "Comercial El Perno SpA", venta: "un", compra: "bl10", precio: 35, costo: 14, stock: 1500, minimo: 300 },
  { name: "Clavo corriente 3\"", categoria: "Fijaciones", marca: "Genérico", proveedor: "Distribuidora Ferretera del Sur", venta: "kg", compra: "cj20", precio: 2490, costo: 1420, stock: 85, minimo: 20 },
  { name: "Clavo techo 3\" con golilla", categoria: "Fijaciones", marca: "Genérico", proveedor: "Distribuidora Ferretera del Sur", venta: "kg", compra: "cj5", precio: 3690, costo: 2180, stock: 30, minimo: 10 },

  // --- Electricidad ---
  { name: "Cable eléctrico 2,5 mm² rojo", categoria: "Electricidad", marca: "Genérico", proveedor: "Distribuidora Ferretera del Sur", venta: "m", compra: "rl100", precio: 690, costo: 385, stock: 400, minimo: 100 },
  { name: "Cable eléctrico 1,5 mm² azul", categoria: "Electricidad", marca: "Genérico", proveedor: "Distribuidora Ferretera del Sur", venta: "m", compra: "rl100", precio: 490, costo: 268, stock: 300, minimo: 100 },
  { name: "Enchufe macho 10 A", categoria: "Electricidad", marca: "Genérico", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "cj50", precio: 1290, costo: 640, stock: 95, minimo: 20 },
  { name: "Ampolleta LED 9 W luz fría E27", categoria: "Electricidad", marca: "Genérico", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "cj25", precio: 1990, costo: 980, stock: 140, minimo: 30, barra: "7801234567890" },
  { name: "Cinta aisladora negra 18 m", categoria: "Electricidad", marca: "3M", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "cj25", precio: 1490, costo: 720, stock: 75, minimo: 15, barra: "7802345678901" },
  { name: "Automático 2x25 A", categoria: "Electricidad", marca: "Genérico", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "un", precio: 8990, costo: 5100, stock: 22, minimo: 6 },

  // --- Gasfitería ---
  { name: "Tubo PVC sanitario 110 mm", categoria: "Gasfitería", marca: "Tigre", proveedor: "Distribuidora Ferretera del Sur", venta: "tr6", compra: "tr6", precio: 12900, costo: 7600, stock: 18, minimo: 3 },
  { name: "Codo PVC 110 mm 90°", categoria: "Gasfitería", marca: "Tigre", proveedor: "Distribuidora Ferretera del Sur", venta: "un", compra: "cj25", precio: 2490, costo: 1310, stock: 60, minimo: 12 },
  { name: "Cañería PPR 20 mm", categoria: "Gasfitería", marca: "Tigre", proveedor: "Distribuidora Ferretera del Sur", venta: "m", compra: "tr3", precio: 1890, costo: 1040, stock: 90, minimo: 24 },
  { name: "Teflón 12 mm x 10 m", categoria: "Gasfitería", marca: "Genérico", proveedor: "Comercial El Perno SpA", venta: "un", compra: "cj100", precio: 590, costo: 240, stock: 200, minimo: 40 },
  { name: "Llave de paso 1/2\" bronce", categoria: "Gasfitería", marca: "Vulco", proveedor: "Distribuidora Ferretera del Sur", venta: "un", compra: "cj25", precio: 5990, costo: 3350, stock: 34, minimo: 8 },
  { name: "Sello de cera para WC", categoria: "Gasfitería", marca: "Genérico", proveedor: "Distribuidora Ferretera del Sur", venta: "un", compra: "cj25", precio: 2290, costo: 1180, stock: 40, minimo: 10 },

  // --- Pinturas (VOLUMEN: admite fracción) ---
  { name: "Látex blanco lavable", categoria: "Pinturas", marca: "Tricolor", proveedor: "Distribuidora Ferretera del Sur", venta: "L", compra: "bd20", precio: 4990, costo: 2740, stock: 160, minimo: 40 },
  { name: "Esmalte al agua blanco", categoria: "Pinturas", marca: "Tricolor", proveedor: "Distribuidora Ferretera del Sur", venta: "L", compra: "bd5", precio: 8990, costo: 5200, stock: 45, minimo: 10 },
  { name: "Diluyente sintético", categoria: "Pinturas", marca: "Genérico", proveedor: "Distribuidora Ferretera del Sur", venta: "L", compra: "bd20", precio: 3290, costo: 1780, stock: 60, minimo: 20 },
  { name: "Brocha 3\" cerda natural", categoria: "Pinturas", marca: "Genérico", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "doc", precio: 3490, costo: 1720, stock: 48, minimo: 12 },
  { name: "Rodillo antigota 22 cm", categoria: "Pinturas", marca: "Genérico", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "doc", precio: 4290, costo: 2150, stock: 36, minimo: 12 },
  { name: "Cinta de enmascarar 24 mm", categoria: "Pinturas", marca: "3M", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "cj50", precio: 1890, costo: 890, stock: 88, minimo: 20 },

  // --- Herramientas ---
  { name: "Taladro percutor 650 W", categoria: "Herramientas", marca: "Bosch", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "un", precio: 79990, costo: 48500, stock: 8, minimo: 3, barra: "7803456789012" },
  { name: "Esmeril angular 4 1/2\" 820 W", categoria: "Herramientas", marca: "Bosch", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "un", precio: 64990, costo: 39900, stock: 6, minimo: 2 },
  { name: "Juego de destornilladores 6 piezas", categoria: "Herramientas", marca: "Stanley", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "un", precio: 14990, costo: 8400, stock: 15, minimo: 5 },
  { name: "Huincha de medir 5 m", categoria: "Herramientas", marca: "Stanley", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "doc", precio: 6990, costo: 3700, stock: 30, minimo: 8 },
  { name: "Alicate universal 8\"", categoria: "Herramientas", marca: "Stanley", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "doc", precio: 9990, costo: 5600, stock: 18, minimo: 6 },
  { name: "Disco de corte metal 4 1/2\"", categoria: "Herramientas", marca: "Bosch", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "cj50", precio: 1290, costo: 590, stock: 120, minimo: 25 },
  { name: "Broca para concreto 8 mm", categoria: "Herramientas", marca: "Bosch", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "cj25", precio: 2490, costo: 1180, stock: 55, minimo: 12 },

  // --- Construcción ---
  { name: "Cemento Portland 25 kg", categoria: "Construcción", marca: "Melón", proveedor: "Distribuidora Ferretera del Sur", venta: "sc25", compra: "sc25", precio: 6490, costo: 4350, stock: 60, minimo: 10 },
  { name: "Arena fina", categoria: "Construcción", marca: "Genérico", proveedor: "Distribuidora Ferretera del Sur", venta: "kg", compra: "kg", precio: 190, costo: 92, stock: 3000, minimo: 500 },
  { name: "Fragüe gris 5 kg", categoria: "Construcción", marca: "Sika", proveedor: "Distribuidora Ferretera del Sur", venta: "cj5", compra: "cj5", precio: 7990, costo: 4600, stock: 12, minimo: 3 },
  { name: "Adhesivo cerámico 25 kg", categoria: "Construcción", marca: "Sika", proveedor: "Distribuidora Ferretera del Sur", venta: "sc25", compra: "sc25", precio: 9490, costo: 6100, stock: 20, minimo: 5 },
  { name: "Plancha OSB 11,1 mm", categoria: "Construcción", marca: "Genérico", proveedor: "Distribuidora Ferretera del Sur", venta: "pl", compra: "pl", precio: 18990, costo: 12400, stock: 25, minimo: 6 },
  { name: "Silicona neutra transparente", categoria: "Construcción", marca: "Sika", proveedor: "Distribuidora Ferretera del Sur", venta: "un", compra: "cj25", precio: 4490, costo: 2380, stock: 70, minimo: 15 },

  // --- Seguridad ---
  { name: "Guante cabritilla talla 9", categoria: "Seguridad", marca: "Genérico", proveedor: "Comercial El Perno SpA", venta: "par", compra: "doc", precio: 3990, costo: 2100, stock: 24, minimo: 6 },
  { name: "Antiparra transparente", categoria: "Seguridad", marca: "3M", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "cj25", precio: 2990, costo: 1450, stock: 40, minimo: 10 },
  { name: "Mascarilla N95", categoria: "Seguridad", marca: "3M", proveedor: "Importadora Andes Ltda.", venta: "un", compra: "cj50", precio: 1490, costo: 690, stock: 150, minimo: 30 },
];

/**
 * Movimientos que se agregan DESPUÉS del inventario inicial, para que el kardex
 * tenga algo que contar. Sin esto, cada producto tiene exactamente una línea y
 * la pantalla no muestra nada de lo que sabe hacer: reposición, corrección,
 * pérdida, y el costo promedio moviéndose.
 */
const HISTORIA: Array<{
  producto: string;
  type: "PURCHASE" | "ADJUSTMENT" | "SHRINKAGE";
  /** En unidades de VENTA, igual que arriba. En ADJUSTMENT el signo manda. */
  cantidad: number;
  /** Costo neto total del movimiento. Solo en compras. */
  costoTotal?: number;
  motivo?: string;
  /** Hace cuántos días ocurrió. */
  hace: number;
}> = [
  { producto: "Cemento Portland 25 kg", type: "PURCHASE", cantidad: 20, costoTotal: 86_000, hace: 12 },
  { producto: "Cemento Portland 25 kg", type: "PURCHASE", cantidad: 30, costoTotal: 132_600, hace: 5 },
  { producto: "Látex blanco lavable", type: "PURCHASE", cantidad: 60, costoTotal: 162_000, hace: 9 },
  { producto: "Látex blanco lavable", type: "SHRINKAGE", cantidad: 4, motivo: "Tarro reventado en bodega, se perdió completo.", hace: 3 },
  { producto: "Tornillo autoperforante 8x1 1/2\"", type: "PURCHASE", cantidad: 1000, costoTotal: 20_500, hace: 7 },
  { producto: "Tornillo autoperforante 8x1 1/2\"", type: "ADJUSTMENT", cantidad: -60, motivo: "Conteo de repisa: había 60 menos que en el sistema.", hace: 2 },
  { producto: "Cable eléctrico 2,5 mm² rojo", type: "PURCHASE", cantidad: 200, costoTotal: 75_000, hace: 6 },
  { producto: "Cable eléctrico 2,5 mm² rojo", type: "SHRINKAGE", cantidad: 12, motivo: "Punta del rollo dañada por humedad.", hace: 1 },
  { producto: "Taladro percutor 650 W", type: "PURCHASE", cantidad: 4, costoTotal: 190_000, hace: 15 },
  { producto: "Disco de corte metal 4 1/2\"", type: "ADJUSTMENT", cantidad: 15, motivo: "Aparecieron 15 en una caja mal rotulada.", hace: 4 },
  { producto: "Ampolleta LED 9 W luz fría E27", type: "PURCHASE", cantidad: 50, costoTotal: 47_500, hace: 8 },
  { producto: "Ampolleta LED 9 W luz fría E27", type: "SHRINKAGE", cantidad: 3, motivo: "Se quebraron al desembalar.", hace: 2 },
  { producto: "Arena fina", type: "PURCHASE", cantidad: 1000, costoTotal: 90_000, hace: 10 },
  { producto: "Guante cabritilla talla 9", type: "ADJUSTMENT", cantidad: -1, motivo: "Dos pares sin par: se dieron de baja.", hace: 6 },
];

function haceDias(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(10, 30, 0, 0);
  return d;
}

/**
 * Borra los productos de demostración y su rastro, para poder rehacerlos.
 *
 * Esto BORRA DE VERDAD, y en un sistema cuyo principio es «nada se borra». La
 * excepción se justifica sola: son datos que este mismo archivo inventó para
 * poder probar, no hechos que ocurrieron en el mostrador. Pero se paga con dos
 * candados:
 *
 *   1. Solo toca productos cuyo nombre está en la tabla PRODUCTOS de acá
 *      arriba. Lo que el dueño creó a mano no se toca ni por error.
 *   2. Si un producto ya participó en una venta, una compra o una venta en
 *      espera, NO se borra y se dice cuál. Borrarlo dejaría una venta
 *      apuntando al vacío, que es peor que un catálogo sucio.
 */
async function limpiar(): Promise<void> {
  const nombres = PRODUCTOS.map((p) => p.name);
  const productos = await db.product.findMany({ where: { name: { in: nombres } }, select: { id: true, name: true } });
  if (productos.length === 0) {
    console.log("No hay productos de demostración que borrar.");
    return;
  }

  const ids = productos.map((p) => p.id);
  const conVentas = new Set<number>();
  for (const it of await db.saleItem.findMany({ where: { productId: { in: ids } }, select: { productId: true } })) {
    conVentas.add(it.productId);
  }
  for (const it of await db.purchaseItem.findMany({ where: { productId: { in: ids } }, select: { productId: true } })) {
    conVentas.add(it.productId);
  }
  for (const it of await db.suspendedSaleItem.findMany({ where: { productId: { in: ids } }, select: { productId: true } })) {
    conVentas.add(it.productId);
  }

  const borrables = productos.filter((p) => !conVentas.has(p.id));
  const intocables = productos.filter((p) => conVentas.has(p.id));

  const idsBorrables = borrables.map((p) => p.id);
  if (idsBorrables.length > 0) {
    await db.$transaction(async (tx) => {
      await tx.alert.deleteMany({ where: { productId: { in: idsBorrables } } });
      await tx.productBarcode.deleteMany({ where: { productId: { in: idsBorrables } } });
      await tx.stockMovement.deleteMany({ where: { productId: { in: idsBorrables } } });
      await tx.stockLevel.deleteMany({ where: { productId: { in: idsBorrables } } });
      await tx.product.deleteMany({ where: { id: { in: idsBorrables } } });
    });
  }

  console.log(`  borrados: ${borrables.length} productos con todo su kardex`);
  if (intocables.length > 0) {
    console.log(`  intactos por tener movimiento real: ${intocables.map((p) => p.name).join(", ")}`);
  }
}

async function main(): Promise<void> {
  console.log("Cargando datos de demostración…\n");

  const ubicacion = await db.location.findFirst({ where: { isDefault: true } });
  if (!ubicacion) throw new Error("No hay ubicación por defecto. Corre `db:seed` primero.");

  // El autor de todo esto es el administrador. Que un movimiento de stock tenga
  // autor no es decorativo: el kardex muestra QUIÉN lo hizo, y una carga demo
  // sin autor dejaría la columna vacía justo en la pantalla que se va a evaluar.
  const admin = await db.user.findFirst({ where: { role: "ADMIN", active: true } });
  if (!admin) throw new Error("No hay administrador activo. Corre `db:seed` primero.");

  // --- Categorías, marcas y proveedores ---
  const cats = new Map<string, number>();
  for (const name of CATEGORIAS) {
    const c = await db.category.upsert({ where: { name }, update: {}, create: { name } });
    cats.set(name, c.id);
  }
  const marcas = new Map<string, number>();
  for (const name of MARCAS) {
    const m = await db.brand.upsert({ where: { name }, update: {}, create: { name } });
    marcas.set(name, m.id);
  }
  // Supplier.name no es único en el esquema —dos sucursales del mismo
  // proveedor son legítimas—, así que acá el upsert se hace a mano.
  const provs = new Map<string, number>();
  for (const p of PROVEEDORES) {
    const existe = await db.supplier.findFirst({ where: { name: p.name } });
    const s = existe ?? (await db.supplier.create({ data: p }));
    provs.set(p.name, s.id);
  }
  console.log(`  categorías: ${cats.size}   marcas: ${marcas.size}   proveedores: ${provs.size}`);

  // --- Unidades, por símbolo ---
  const unidades = new Map<string, { id: number; groupId: number; factorMilli: number }>();
  for (const u of await db.unit.findMany({ select: { id: true, symbol: true, groupId: true, factorMilli: true } })) {
    unidades.set(u.symbol, u);
  }

  // --- Productos ---
  let creados = 0;
  let saltados = 0;
  const idPorNombre = new Map<string, { id: number; factor: number }>();

  for (const p of PRODUCTOS) {
    const ya = await db.product.findFirst({ where: { name: p.name } });
    if (ya) {
      idPorNombre.set(p.name, { id: ya.id, factor: unidades.get(p.venta)!.factorMilli });
      saltados++;
      continue;
    }

    const uVenta = unidades.get(p.venta);
    const uCompra = unidades.get(p.compra);
    if (!uVenta || !uCompra) throw new Error(`Unidad desconocida en «${p.name}»: ${p.venta} / ${p.compra}`);
    if (uVenta.groupId !== uCompra.groupId) {
      throw new Error(`«${p.name}»: la unidad de venta y la de compra tienen que ser del mismo grupo.`);
    }

    const sku = await nextSku();
    const producto = await db.$transaction(async (tx) => {
      const nuevo = await tx.product.create({
        data: {
          sku,
          name: p.name,
          categoryId: cats.get(p.categoria)!,
          brandId: marcas.get(p.marca)!,
          supplierId: provs.get(p.proveedor)!,
          saleUnitId: uVenta.id,
          purchaseUnitId: uCompra.id,
          priceGross: p.precio,
          // De unidad de venta a milésimas de unidad base: `factorMilli` ya
          // dice cuántas milésimas de base vale UNA unidad de venta.
          reorderLevelBaseMilli: (p.minimo ?? 0) * uVenta.factorMilli,
          searchKey: buildSearchKey({ name: p.name, sku, barcodes: p.barra ? [p.barra] : [] }),
        },
      });
      if (p.barra) await tx.productBarcode.create({ data: { productId: nuevo.id, code: p.barra } });

      // El inventario inicial fija el costo promedio: por eso lleva el total
      // neto exacto y no se deja valorizar solo (el promedio vigente es 0).
      await registrarMovimiento(tx, {
        productId: nuevo.id,
        locationId: ubicacion.id,
        type: "INITIAL",
        qtyBaseMilli: p.stock * uVenta.factorMilli,
        totalCostNet: p.stock * p.costo,
        userId: admin.id,
        reason: "Carga inicial de demostración",
        createdAt: haceDias(20),
      });
      return nuevo;
    });

    idPorNombre.set(p.name, { id: producto.id, factor: uVenta.factorMilli });
    creados++;
  }
  console.log(`  productos: ${creados} creados, ${saltados} ya estaban`);

  // --- Historia del kardex ---
  // Solo si el producto se acaba de crear: reaplicarla sobre una base que ya la
  // tiene duplicaría saldos, y el saldo es lo único que esta pantalla no puede
  // equivocarse.
  let movs = 0;
  if (creados > 0) {
    // En orden cronológico. El libro guarda el saldo y el costo DESPUÉS de cada
    // movimiento: insertarlos desordenados dejaría un histórico que no cuadra
    // consigo mismo aunque el saldo final salga bien.
    for (const h of [...HISTORIA].sort((a, b) => b.hace - a.hace)) {
      const ref = idPorNombre.get(h.producto);
      if (!ref) continue;
      await db.$transaction(async (tx) => {
        await registrarMovimiento(tx, {
          productId: ref.id,
          locationId: ubicacion.id,
          type: h.type,
          qtyBaseMilli: h.cantidad * ref.factor,
          ...(h.costoTotal !== undefined ? { totalCostNet: h.costoTotal } : {}),
          userId: admin.id,
          reason: h.motivo ?? (h.type === "PURCHASE" ? "Reposición de proveedor" : null),
          createdAt: haceDias(h.hace),
        });
      });
      movs++;
    }
  }
  console.log(`  movimientos de kardex: ${movs}`);

  const total = await db.product.count({ where: { deletedAt: null } });
  console.log(`\nListo. El catálogo tiene ${total} productos.`);
  console.log("Prueba: Catálogo (buscar «cañeria» sin tilde), Kardex de «Cemento Portland», Venta escribiendo «tor».");
}

const orden = process.argv.slice(2);
if (orden.includes("--limpiar") || orden.includes("--rehacer")) {
  console.log("Limpiando datos de demostración…\n");
  await limpiar();
  console.log();
}
if (!orden.includes("--limpiar")) await main();
await db.$disconnect();
