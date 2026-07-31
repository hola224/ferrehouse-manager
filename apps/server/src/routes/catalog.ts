/**
 * Catálogo (tareas 1.1, 1.2, 1.4, 1.5 y 1.7).
 *
 * Lo que hay que saber antes de tocar este archivo:
 *
 * - La validación de forma NO vive acá: vive en `@ferrehouse/shared/catalog`,
 *   porque el importador de Excel (1.6) usa exactamente la misma. Acá solo
 *   está lo que necesita mirar la base de datos.
 * - Los campos de costo se omiten solos para un token SELLER: lo hace el hook
 *   `preSerialization` de `app.ts`. Ninguna ruta de este archivo tiene que
 *   acordarse, y por eso las rutas de lectura no llevan `select` distinto por
 *   rol. Hay tests que golpean estas rutas con token de vendedor.
 * - Crear un producto crea su fila de `StockLevel` en cero EN LA MISMA
 *   TRANSACCIÓN. Si no, un producto puede quedar sin fila y la alerta de
 *   quiebre (ALE-02) no lo ve nunca.
 */
import type { FastifyInstance } from "fastify";
import ExcelJS from "exceljs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { audit } from "../audit.js";
import { requireRole } from "../roles.js";
import { nextSku } from "../sku.js";
import {
  productInputSchema,
  productPatchSchema,
  categoryInputSchema,
  brandInputSchema,
  supplierInputSchema,
  barcodeSchema,
  validarUnidades,
  describirConversion,
  buildSearchKey,
  normalizeSearch,
  normalizeBarcode,
  puedeEditarCosto,
  costoMilliPorUnidadDeVenta,
  margenDeListaPct,
  type UnitLike,
  TIPOS_QUE_FIJAN_COSTO,
} from "@ferrehouse/shared";

/** 400 con mensaje en español, que es lo que la UI muestra tal cual. */
function malaPeticion(mensaje: string): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = 400;
  return e;
}

function noEncontrado(mensaje: string): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = 404;
  return e;
}

const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Trae las dos unidades y aplica el invariante del sprint: mismo `UnitGroup`.
 * Devuelve las filas porque quien llama las necesita para el texto de la 1.7.
 */
async function resolverUnidades(saleUnitId: number, purchaseUnitId: number): Promise<[UnitLike, UnitLike]> {
  const unidades = await db.unit.findMany({
    where: { id: { in: [...new Set([saleUnitId, purchaseUnitId])] } },
    select: { id: true, groupId: true, name: true, symbol: true, factorMilli: true },
  });
  const venta = unidades.find((u) => u.id === saleUnitId);
  const compra = unidades.find((u) => u.id === purchaseUnitId);
  if (!venta) throw malaPeticion("La unidad de venta no existe");
  if (!compra) throw malaPeticion("La unidad de compra no existe");

  const error = validarUnidades(venta, compra);
  if (error) throw malaPeticion(error);
  return [venta, compra];
}

/** Los códigos de barra son únicos en toda la tienda, no por producto. */
async function verificarCodigosLibres(codigos: string[], productoId?: number): Promise<void> {
  if (codigos.length === 0) return;
  const repetidoEnLaLista = codigos.find((c, i) => codigos.indexOf(c) !== i);
  if (repetidoEnLaLista) throw malaPeticion(`El código ${repetidoEnLaLista} está repetido en la misma lista`);

  const ocupados = await db.productBarcode.findMany({
    where: { code: { in: codigos }, ...(productoId ? { productId: { not: productoId } } : {}) },
    select: { code: true, product: { select: { sku: true, name: true } } },
  });
  const choque = ocupados[0];
  if (choque) {
    throw malaPeticion(`El código ${choque.code} ya es de ${choque.product.name} (${choque.product.sku})`);
  }
}

export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  const soloAdmin = { preHandler: requireRole("ADMIN") };
  const cualquiera = { preHandler: requireRole("ADMIN", "SELLER") };

  // ============================================================
  // Unidades — lectura para poblar los selectores (tarea 1.7)
  // ============================================================

  app.get("/api/catalog/units", cualquiera, async () => ({
    grupos: await db.unitGroup.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        allowsFraction: true,
        units: {
          orderBy: [{ isBase: "desc" }, { factorMilli: "asc" }],
          select: { id: true, name: true, symbol: true, factorMilli: true, isBase: true, groupId: true },
        },
      },
    }),
  }));

  // ============================================================
  // Categorías, marcas y proveedores (tarea 1.4)
  // ============================================================

  /**
   * Las ubicaciones. Solo lectura y solo el administrador: hoy hay una sola
   * (decisión 12) y la interfaz la esconde hasta que exista la segunda bodega,
   * pero la pantalla de cajas necesita saber a cuál asociar cada terminal.
   *
   * No hay alta ni edición: crear una segunda ubicación es una decisión de
   * negocio que además obliga a revisar los reportes por ubicación, no algo
   * que se hace desde un formulario un martes.
   */
  app.get("/api/catalog/locations", soloAdmin, async () => ({
    ubicaciones: await db.location.findMany({
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
      select: { id: true, name: true, isDefault: true },
    }),
  }));

  app.get("/api/catalog/categories", cualquiera, async () => ({
    categorias: await db.category.findMany({ orderBy: { name: "asc" } }),
  }));

  app.post("/api/catalog/categories", soloAdmin, async (req, reply) => {
    const datos = categoryInputSchema.parse(req.body);
    const existe = await db.category.findUnique({ where: { name: datos.name } });
    if (existe) throw malaPeticion(`Ya existe la categoría ${datos.name}`);
    const creada = await db.category.create({ data: datos });
    return reply.code(201).send({ categoria: creada });
  });

  app.patch("/api/catalog/categories/:id", soloAdmin, async (req) => {
    const { id } = idParam.parse(req.params);
    const datos = categoryInputSchema.parse(req.body);
    return { categoria: await db.category.update({ where: { id }, data: datos }) };
  });

  app.get("/api/catalog/brands", cualquiera, async () => ({
    marcas: await db.brand.findMany({ orderBy: { name: "asc" } }),
  }));

  app.post("/api/catalog/brands", soloAdmin, async (req, reply) => {
    const datos = brandInputSchema.parse(req.body);
    const existe = await db.brand.findUnique({ where: { name: datos.name } });
    if (existe) throw malaPeticion(`Ya existe la marca ${datos.name}`);
    return reply.code(201).send({ marca: await db.brand.create({ data: datos }) });
  });

  app.patch("/api/catalog/brands/:id", soloAdmin, async (req) => {
    const { id } = idParam.parse(req.params);
    const datos = brandInputSchema.parse(req.body);
    return { marca: await db.brand.update({ where: { id }, data: datos }) };
  });

  /**
   * Los proveedores los ve solo el admin: son datos de compra, y lo que el
   * vendedor no necesita ver no sale del servidor (decisión sellada 17).
   */
  app.get("/api/catalog/suppliers", soloAdmin, async () => ({
    proveedores: await db.supplier.findMany({ orderBy: { name: "asc" } }),
  }));

  app.post("/api/catalog/suppliers", soloAdmin, async (req, reply) => {
    const datos = supplierInputSchema.parse(req.body);
    return reply.code(201).send({ proveedor: await db.supplier.create({ data: datos }) });
  });

  app.patch("/api/catalog/suppliers/:id", soloAdmin, async (req) => {
    const { id } = idParam.parse(req.params);
    const datos = supplierInputSchema.partial().parse(req.body);
    return { proveedor: await db.supplier.update({ where: { id }, data: datos }) };
  });

  // ============================================================
  // Productos (tareas 1.1 y 1.2)
  // ============================================================

  const productoCompleto = {
    include: {
      category: true,
      brand: true,
      supplier: true,
      saleUnit: true,
      purchaseUnit: true,
      barcodes: { orderBy: { id: "asc" } },
      stockLevels: { include: { location: { select: { id: true, name: true } } } },
    },
  } satisfies Prisma.ProductDefaultArgs;

  /**
   * Ordena los resultados por CÓMO calzan, no por alfabeto.
   *
   * Alfabético parece neutral y no lo es: buscando «tor», «Juego de
   * destornilladores» sale antes que «Tornillo autoperforante» porque la J va
   * antes que la T. En una caja eso pone el producto equivocado en la primera
   * posición, que es la que se elige sin mirar.
   *
   * Tres escalones, y dentro de cada uno se mantiene el alfabético:
   *   0 — el nombre EMPIEZA con lo escrito           («tor» → Tornillo…)
   *   1 — alguna PALABRA del nombre empieza con eso  («vol» → Tornillo volcanita)
   *   2 — calza en cualquier parte                   («tor» → …destornilladores)
   */
  function ordenarPorCalce<T extends { name: string }>(filas: T[], q: string): T[] {
    const buscado = normalizeSearch(q);
    if (!buscado) return filas;
    const escalon = (nombre: string): number => {
      const n = normalizeSearch(nombre);
      if (n.startsWith(buscado)) return 0;
      if (n.split(" ").some((palabra) => palabra.startsWith(buscado))) return 1;
      return 2;
    };
    return [...filas]
      .map((f, i) => ({ f, e: escalon(f.name), i }))
      // El índice desempata para que el orden sea estable: sin él, dos
      // productos del mismo escalón podrían bailar entre una búsqueda y otra.
      .sort((a, b) => a.e - b.e || a.i - b.i)
      .map((x) => x.f);
  }

  const listaQuery = z.object({
    q: z.string().trim().optional(),
    categoryId: z.coerce.number().int().positive().optional(),
    brandId: z.coerce.number().int().positive().optional(),
    incluirInactivos: z.coerce.boolean().default(false),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });

  app.get("/api/products", cualquiera, async (req) => {
    const f = listaQuery.parse(req.query);

    // `deletedAt` saca al producto de TODA pantalla operativa; `active = false`
    // solo lo saca del POS. El vendedor nunca ve ni uno ni otro.
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(req.user.role === "SELLER" || !f.incluirInactivos ? { active: true } : {}),
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      ...(f.brandId ? { brandId: f.brandId } : {}),
      ...(f.q ? { searchKey: { contains: normalizeSearch(f.q) } } : {}),
    };

    const [productos, total] = await Promise.all([
      db.product.findMany({ where, ...productoCompleto, orderBy: { name: "asc" }, take: f.limit, skip: f.offset }),
      db.product.count({ where }),
    ]);
    return { productos, total, limit: f.limit, offset: f.offset };
  });

  /**
   * La caja única de búsqueda (tarea 1.5, POS-03).
   *
   * Una sola caja acepta las tres cosas, y el orden importa: si el vendedor
   * escaneó, el resultado tiene que ser EL producto y no una lista donde hay
   * que elegir. Por eso el código de barras exacto y el SKU exacto cortan la
   * búsqueda y devuelven `exacto: true`, que es la señal para que el POS
   * agregue la línea sin preguntar.
   */
  app.get("/api/products/search", cualquiera, async (req) => {
    const { q, limit } = z
      .object({ q: z.string().trim().min(1, "Escribe algo para buscar"), limit: z.coerce.number().int().min(1).max(50).default(20) })
      .parse(req.query);

    const visible: Prisma.ProductWhereInput =
      req.user.role === "SELLER" ? { deletedAt: null, active: true } : { deletedAt: null };

    const porCodigo = await db.product.findFirst({
      where: { ...visible, barcodes: { some: { code: normalizeBarcode(q) } } },
      ...productoCompleto,
    });
    if (porCodigo) return { exacto: true, motivo: "CODIGO_BARRAS", productos: [porCodigo] };

    const porSku = await db.product.findFirst({
      where: { ...visible, sku: q.trim().toUpperCase() },
      ...productoCompleto,
    });
    if (porSku) return { exacto: true, motivo: "SKU", productos: [porSku] };

    const productos = await db.product.findMany({
      where: { ...visible, searchKey: { contains: normalizeSearch(q) } },
      ...productoCompleto,
      orderBy: { name: "asc" },
      take: limit,
    });
    return { exacto: false, motivo: "TEXTO", productos: ordenarPorCalce(productos, q) };
  });

  app.get("/api/products/:id", cualquiera, async (req) => {
    const { id } = idParam.parse(req.params);
    const producto = await db.product.findFirst({
      where: { id, deletedAt: null, ...(req.user.role === "SELLER" ? { active: true } : {}) },
      ...productoCompleto,
    });
    if (!producto) throw noEncontrado("Ese producto no existe");
    return {
      producto,
      conversion: describirConversion(producto.saleUnit, producto.purchaseUnit),
      // Cuántos movimientos tiene decide si el costo todavía se puede teclear.
      movimientos: await db.stockMovement.count({ where: { productId: id, type: { in: TIPOS_QUE_FIJAN_COSTO } } }),
    };
  });

  app.post("/api/products", soloAdmin, async (req, reply) => {
    const datos = productInputSchema.parse(req.body);
    const [venta, compra] = await resolverUnidades(datos.saleUnitId, datos.purchaseUnitId);
    await verificarCodigosLibres(datos.barcodes);

    const ubicaciones = await db.location.findMany({ where: { active: true }, select: { id: true } });
    const sku = await nextSku();

    const producto = await db.$transaction(async (tx) => {
      const creado = await tx.product.create({
        data: {
          sku,
          name: datos.name,
          description: datos.description ?? null,
          categoryId: datos.categoryId ?? null,
          brandId: datos.brandId ?? null,
          supplierId: datos.supplierId ?? null,
          saleUnitId: datos.saleUnitId,
          purchaseUnitId: datos.purchaseUnitId,
          priceGross: datos.priceGross,
          costNetMilliPeso: datos.costNetMilliPeso ?? 0,
          reorderLevelBaseMilli: datos.reorderLevelBaseMilli,
          active: datos.active,
          searchKey: buildSearchKey({ name: datos.name, sku, barcodes: datos.barcodes }),
          barcodes: { create: datos.barcodes.map((code) => ({ code })) },
        },
      });

      // Va DENTRO de la transacción a propósito: un producto sin fila de
      // StockLevel es invisible para la alerta de quiebre y hace que la
      // validación de venta consulte un registro inexistente. Crearla en una
      // segunda escritura significa que existe un instante —y un modo de
      // fallar— en que el producto está a medio nacer.
      await tx.stockLevel.createMany({
        data: ubicaciones.map((u) => ({ productId: creado.id, locationId: u.id, qtyBaseMilli: 0 })),
      });

      return creado;
    });

    await audit({
      userId: req.user.sub,
      action: "PRODUCT_CREATED",
      entity: "Product",
      entityId: producto.id,
      payload: { sku: producto.sku, name: producto.name },
    });

    return reply.code(201).send({
      producto: await db.product.findUniqueOrThrow({ where: { id: producto.id }, ...productoCompleto }),
      conversion: describirConversion(venta, compra),
    });
  });

  app.patch("/api/products/:id", soloAdmin, async (req) => {
    const { id } = idParam.parse(req.params);
    const datos = productPatchSchema.parse(req.body);

    const actual = await db.product.findUnique({ where: { id }, include: { barcodes: true } });
    if (!actual || actual.deletedAt) throw noEncontrado("Ese producto no existe");

    const saleUnitId = datos.saleUnitId ?? actual.saleUnitId;
    const purchaseUnitId = datos.purchaseUnitId ?? actual.purchaseUnitId;
    const [venta, compra] = await resolverUnidades(saleUnitId, purchaseUnitId);

    if (datos.costNetMilliPeso !== undefined) {
      /**
       * Se cuentan SOLO los movimientos que traen un costo propio (Sprint 4).
       * Contar todos —como se hacía— dejaba el costo bloqueado apenas el
       * producto se vendía una vez, y una venta no fija ningún costo: lo copia
       * del vigente. En un producto vendido antes de cargar el inventario
       * inicial eso significaba no poder corregir nunca el costo tecleado mal.
       */
      const movimientos = await db.stockMovement.count({
        where: { productId: id, type: { in: TIPOS_QUE_FIJAN_COSTO } },
      });
      if (!puedeEditarCosto(movimientos)) {
        throw malaPeticion(
          "El costo de este producto ya lo manda el libro de stock: se recalcula solo con cada compra. " +
            "Para corregirlo hay que registrar un ajuste, no editar el producto.",
        );
      }
    }

    const codigos = datos.barcodes;
    if (codigos) await verificarCodigosLibres(codigos, id);

    const nombre = datos.name ?? actual.name;
    const codigosFinales = codigos ?? actual.barcodes.map((b) => b.code);

    await db.$transaction(async (tx) => {
      if (codigos) {
        await tx.productBarcode.deleteMany({ where: { productId: id } });
        await tx.productBarcode.createMany({ data: codigos.map((code) => ({ productId: id, code })) });
      }
      await tx.product.update({
        where: { id },
        data: {
          ...(datos.name !== undefined ? { name: datos.name } : {}),
          ...(datos.description !== undefined ? { description: datos.description } : {}),
          ...(datos.categoryId !== undefined ? { categoryId: datos.categoryId } : {}),
          ...(datos.brandId !== undefined ? { brandId: datos.brandId } : {}),
          ...(datos.supplierId !== undefined ? { supplierId: datos.supplierId } : {}),
          ...(datos.saleUnitId !== undefined ? { saleUnitId: datos.saleUnitId } : {}),
          ...(datos.purchaseUnitId !== undefined ? { purchaseUnitId: datos.purchaseUnitId } : {}),
          ...(datos.priceGross !== undefined ? { priceGross: datos.priceGross } : {}),
          ...(datos.costNetMilliPeso !== undefined ? { costNetMilliPeso: datos.costNetMilliPeso } : {}),
          ...(datos.reorderLevelBaseMilli !== undefined
            ? { reorderLevelBaseMilli: datos.reorderLevelBaseMilli }
            : {}),
          ...(datos.active !== undefined ? { active: datos.active } : {}),
          searchKey: buildSearchKey({ name: nombre, sku: actual.sku, barcodes: codigosFinales }),
        },
      });
    });

    await audit({ userId: req.user.sub, action: "PRODUCT_UPDATED", entity: "Product", entityId: id, payload: datos });

    return {
      producto: await db.product.findUniqueOrThrow({ where: { id }, ...productoCompleto }),
      conversion: describirConversion(venta, compra),
    };
  });

  /**
   * El catálogo en un Excel. Solo el administrador: lleva costo y margen.
   *
   * **NO es la plantilla de importación, y la hoja lo dice en su primera fila.**
   * El importador solo CREA productos —reserva SKU nuevos con `reserveSkuRange`
   * y llama a `product.create`; no existe ningún camino que actualice uno
   * existente—, así que exportar con la forma de la plantilla y volver a
   * subirla duplicaría la ferretería entera con SKU nuevos. Por eso este
   * archivo lleva el SKU adelante, incluye columnas que la plantilla no tiene
   * (margen, estado, saldo) y no pretende viajar de vuelta.
   */
  app.get("/api/products/export.xlsx", soloAdmin, async (_req, reply) => {
    const productos = await db.product.findMany({
      where: { deletedAt: null },
      ...productoCompleto,
      orderBy: { name: "asc" },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = "Ferrehouse Manager";
    const hoja = wb.addWorksheet("Catálogo");

    hoja.columns = [
      { header: "SKU", key: "sku", width: 12 },
      { header: "Nombre", key: "nombre", width: 40 },
      { header: "Categoría", key: "categoria", width: 18 },
      { header: "Marca", key: "marca", width: 16 },
      { header: "Proveedor", key: "proveedor", width: 20 },
      { header: "Unidad de venta", key: "unidad", width: 16 },
      { header: "Precio con IVA", key: "precio", width: 15 },
      { header: "Costo neto (unidad base)", key: "costo", width: 22 },
      { header: "Margen %", key: "margen", width: 11 },
      { header: "Saldo (unidad base)", key: "saldo", width: 18 },
      { header: "Stock mínimo", key: "minimo", width: 14 },
      { header: "Estado", key: "estado", width: 14 },
      { header: "Códigos de barra", key: "codigos", width: 32 },
    ];
    hoja.getRow(1).font = { bold: true };
    hoja.getRow(1).getCell(1).note =
      "Este archivo es para LEER, no para volver a subir. La importación solo crea productos nuevos: " +
      "si subes esto, la ferretería queda duplicada con SKU nuevos. Para cambiar precios, edítalos en el sistema.";

    for (const p of productos) {
      const saldoMilli = p.stockLevels.reduce((s, n) => s + n.qtyBaseMilli, 0);
      /*
        El costo y el margen salen de `@ferrehouse/shared`, NO de una cuenta
        escrita acá. El costo se guarda por unidad BASE y el precio por unidad
        de VENTA, y mezclarlos es un error que ya ocurrió: un saco de 25 kg
        aparecía con 96,7% de margen cuando el real era 17,5%. La conversión
        vive en un solo lugar justamente para que no vuelva a pasar.
      */
      const costoVenta = costoMilliPorUnidadDeVenta(p);
      const margen = margenDeListaPct(p);
      const bajo = saldoMilli <= p.reorderLevelBaseMilli;
      hoja.addRow({
        sku: p.sku,
        nombre: p.name,
        categoria: p.category?.name ?? "",
        marca: p.brand?.name ?? "",
        proveedor: p.supplier?.name ?? "",
        unidad: p.saleUnit.symbol,
        precio: p.priceGross,
        // Costo cero es «todavía no se cargó», no «sale gratis»: va vacío, que
        // es lo que la pantalla muestra como raya.
        costo: p.costNetMilliPeso === 0 ? "" : Math.round(costoVenta / 1000),
        margen: margen === null ? "" : Number(margen.toFixed(1)),
        saldo: saldoMilli / 1000,
        minimo: p.reorderLevelBaseMilli / 1000,
        estado: !p.active ? "Inactivo" : bajo ? "Stock bajo" : "OK",
        codigos: p.barcodes.map((b) => b.code).join(", "),
      });
    }

    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const hoy = new Date().toISOString().slice(0, 10);
    return reply
      .type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
      .header("content-disposition", `attachment; filename="catalogo-ferrehouse-${hoy}.xlsx"`)
      .send(buffer);
  });

  /**
   * Descontinuar. No hay borrado físico: el producto está referenciado por
   * ventas y por el libro de stock, y esas tablas son inmutables. El SKU no se
   * reutiliza jamás, ni después de esto: está impreso en la etiqueta pegada en
   * la repisa.
   */
  app.delete("/api/products/:id", soloAdmin, async (req) => {
    const { id } = idParam.parse(req.params);
    const actual = await db.product.findUnique({ where: { id } });
    if (!actual || actual.deletedAt) throw noEncontrado("Ese producto no existe");

    await db.product.update({ where: { id }, data: { deletedAt: new Date(), active: false } });
    await audit({
      userId: req.user.sub,
      action: "PRODUCT_DISCONTINUED",
      entity: "Product",
      entityId: id,
      payload: { sku: actual.sku },
    });
    return { ok: true, mensaje: `${actual.name} quedó descontinuado. Su SKU ${actual.sku} no se reutiliza.` };
  });

  // ============================================================
  // Códigos de barra (tarea 1.2)
  // ============================================================

  app.post("/api/products/:id/barcodes", soloAdmin, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { code, note } = z
      .object({ code: barcodeSchema, note: z.string().trim().max(80).nullable().optional() })
      .parse(req.body);

    const producto = await db.product.findUnique({ where: { id }, include: { barcodes: true } });
    if (!producto || producto.deletedAt) throw noEncontrado("Ese producto no existe");
    await verificarCodigosLibres([code], id);

    const codigos = [...producto.barcodes.map((b) => b.code), code];
    await db.$transaction([
      db.productBarcode.create({ data: { productId: id, code, note: note ?? null } }),
      db.product.update({
        where: { id },
        data: { searchKey: buildSearchKey({ name: producto.name, sku: producto.sku, barcodes: codigos }) },
      }),
    ]);

    return reply.code(201).send({
      producto: await db.product.findUniqueOrThrow({ where: { id }, ...productoCompleto }),
    });
  });

  app.delete("/api/products/:id/barcodes/:barcodeId", soloAdmin, async (req) => {
    const { id, barcodeId } = z
      .object({ id: z.coerce.number().int().positive(), barcodeId: z.coerce.number().int().positive() })
      .parse(req.params);

    const producto = await db.product.findUnique({ where: { id }, include: { barcodes: true } });
    if (!producto) throw noEncontrado("Ese producto no existe");
    if (!producto.barcodes.some((b) => b.id === barcodeId)) throw noEncontrado("Ese código no es de este producto");

    const quedan = producto.barcodes.filter((b) => b.id !== barcodeId).map((b) => b.code);
    await db.$transaction([
      db.productBarcode.delete({ where: { id: barcodeId } }),
      db.product.update({
        where: { id },
        data: { searchKey: buildSearchKey({ name: producto.name, sku: producto.sku, barcodes: quedan }) },
      }),
    ]);

    return { producto: await db.product.findUniqueOrThrow({ where: { id }, ...productoCompleto }) };
  });
}
