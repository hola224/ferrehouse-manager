/**
 * Kardex, ajustes, mermas y reconciliación (tareas 4.3, 4.7 y 4.8).
 *
 * El kardex es la pantalla que contesta "¿POR QUÉ EL STOCK DICE ESTO?". Todo
 * lo demás de este archivo existe para que esa respuesta sea completa: un
 * ajuste sin motivo, o un saldo que nadie compara contra el libro, son
 * exactamente los dos agujeros por los que un inventario deja de ser creíble.
 *
 * ORDEN DEL KARDEX: por `id`, no por fecha. El libro es append-only, así que
 * el orden de inserción ES el orden contable, y `balanceBaseMilli` es una foto
 * tomada en ese orden. Ordenar por fecha haría que una compra digitada con
 * fecha del viernes aparezca entre movimientos del jueves con un saldo que no
 * calza con la fila de arriba. La fecha se muestra en su columna, que es
 * donde el usuario la necesita.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { requireRole } from "../roles.js";
import { registrarMovimiento } from "../stock-ledger.js";
import { audit } from "../audit.js";
import {
  adjustmentInputSchema,
  STOCK_RULES,
  toBaseMilli,
  roundSym,
  formatQty,
  formatCLP,
  type StockMovementType,
} from "@ferrehouse/shared";

function malaPeticion(mensaje: string): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = 400;
  return e;
}

const idParam = z.object({ id: z.coerce.number().int().positive() });

/** De milésimas de unidad base a milésimas de la unidad de venta. */
function aUnidadDeVenta(baseMilli: number, factorMilli: number): number {
  return roundSym((baseMilli * 1000) / factorMilli);
}

export async function registerStockRoutes(app: FastifyInstance): Promise<void> {
  const cualquiera = { preHandler: requireRole("ADMIN", "SELLER") };
  const soloAdmin = { preHandler: requireRole("ADMIN") };

  // ============================================================
  // 4.8 — Kardex de un producto
  // ============================================================

  app.get("/api/stock/:id/kardex", cualquiera, async (req) => {
    const { id } = idParam.parse(req.params);
    const q = z
      .object({
        locationId: z.coerce.number().int().positive().optional(),
        take: z.coerce.number().int().min(1).max(500).default(100),
        desde: z.coerce.date().optional(),
        hasta: z.coerce.date().optional(),
      })
      .parse(req.query ?? {});

    const locationId = q.locationId ?? req.user.locationId;

    const producto = await db.product.findFirst({
      where: { id, deletedAt: null },
      include: { saleUnit: { include: { group: true } }, purchaseUnit: true },
    });
    if (!producto) throw malaPeticion("Ese producto no existe.");

    const fraccion = producto.saleUnit.group.allowsFraction;
    const factor = producto.saleUnit.factorMilli;

    const movimientos = await db.stockMovement.findMany({
      where: {
        productId: id,
        locationId,
        ...(q.desde || q.hasta
          ? { createdAt: { ...(q.desde ? { gte: q.desde } : {}), ...(q.hasta ? { lte: q.hasta } : {}) } }
          : {}),
      },
      orderBy: { id: "desc" },
      take: q.take,
      include: { user: { select: { id: true, name: true } } },
    });

    // Las referencias se resuelven en lote: un kardex de 100 filas con una
    // consulta por fila son 100 viajes a la base para pintar una tabla.
    const idsVenta = movimientos.filter((m) => m.refType === "SALE" && m.refId).map((m) => m.refId!);
    const idsCompra = movimientos.filter((m) => m.refType === "PURCHASE" && m.refId).map((m) => m.refId!);
    const ventas = idsVenta.length
      ? await db.sale.findMany({
          where: { id: { in: idsVenta } },
          select: { id: true, status: true, reversalKind: true, fiscalFolio: true },
        })
      : [];
    const compras = idsCompra.length
      ? await db.purchase.findMany({
          where: { id: { in: idsCompra } },
          select: { id: true, documentNumber: true, supplier: { select: { name: true } } },
        })
      : [];
    const ventaPorId = new Map(ventas.map((v) => [v.id, v]));
    const compraPorId = new Map(compras.map((c) => [c.id, c]));

    const nivel = await db.stockLevel.findUnique({
      where: { productId_locationId: { productId: id, locationId } },
    });

    return {
      producto: {
        id: producto.id,
        sku: producto.sku,
        name: producto.name,
        unidad: producto.saleUnit.symbol,
        allowsFraction: fraccion,
        costNetMilliPeso: producto.costNetMilliPeso,
      },
      saldoBaseMilli: nivel?.qtyBaseMilli ?? 0,
      saldoTexto: `${formatQty(aUnidadDeVenta(nivel?.qtyBaseMilli ?? 0, factor), fraccion)} ${producto.saleUnit.symbol}`,
      movimientos: movimientos.map((m) => {
        const regla = STOCK_RULES[m.type as StockMovementType];
        const venta = m.refType === "SALE" && m.refId ? ventaPorId.get(m.refId) : null;
        const compra = m.refType === "PURCHASE" && m.refId ? compraPorId.get(m.refId) : null;
        return {
          id: m.id,
          createdAt: m.createdAt,
          type: m.type,
          etiqueta: regla?.etiqueta ?? m.type,
          tono: regla?.tono ?? "neutral",
          // La cantidad se muestra en la unidad de VENTA: el libro lleva base,
          // pero nadie piensa el cable en milésimas de metro.
          qtyMilli: aUnidadDeVenta(m.qtyBaseMilli, factor),
          qtyBaseMilli: m.qtyBaseMilli,
          balanceMilli: aUnidadDeVenta(m.balanceBaseMilli, factor),
          balanceBaseMilli: m.balanceBaseMilli,
          balanceCostNetMilliPeso: m.balanceCostNetMilliPeso,
          totalCostNet: m.totalCostNet,
          user: m.user,
          reason: m.reason,
          refType: m.refType,
          refId: m.refId,
          referencia: venta
            ? `Venta #${venta.id}${venta.fiscalFolio ? ` (${venta.fiscalFolio})` : ""}`
            : compra
              ? `Compra #${compra.id} — ${compra.supplier.name}${compra.documentNumber ? ` (${compra.documentNumber})` : ""}`
              : null,
        };
      }),
    };
  });

  // ============================================================
  // 4.3 — Ajustes y mermas
  // ============================================================

  app.post("/api/stock/adjustments", soloAdmin, async (req, reply) => {
    const datos = adjustmentInputSchema.parse(req.body);

    const producto = await db.product.findFirst({
      where: { id: datos.productId, deletedAt: null },
      include: { saleUnit: { include: { group: true } } },
    });
    if (!producto) throw malaPeticion("Ese producto no existe.");

    const unidad = datos.unitId
      ? await db.unit.findUnique({ where: { id: datos.unitId } })
      : producto.saleUnit;
    if (!unidad) throw malaPeticion("Esa unidad no existe.");
    if (unidad.groupId !== producto.saleUnit.groupId) {
      throw malaPeticion(`${producto.name} no se mide en ${unidad.name}: son magnitudes distintas.`);
    }
    if (!producto.saleUnit.group.allowsFraction && datos.qtyMilli % 1000 !== 0) {
      throw malaPeticion(`${producto.name} no se cuenta fraccionado: la cantidad tiene que ser un número entero.`);
    }
    if (datos.qtyMilli === 0) throw malaPeticion("Un ajuste de cero no corrige nada.");

    const qtyBaseMilli = toBaseMilli(datos.qtyMilli, unidad.factorMilli);

    const escrito = await db.$transaction(async (tx) =>
      registrarMovimiento(tx, {
        productId: producto.id,
        locationId: req.user.locationId,
        type: datos.type,
        qtyBaseMilli,
        userId: req.user.sub,
        reason: datos.reason,
      }),
    );

    await audit({
      userId: req.user.sub,
      action: datos.type === "SHRINKAGE" ? "STOCK_SHRINKAGE" : "STOCK_ADJUSTED",
      entity: "Product",
      entityId: producto.id,
      payload: { qtyBaseMilli: escrito.qtyBaseMilli, reason: datos.reason, saldo: escrito.balanceBaseMilli },
    });

    const fraccion = producto.saleUnit.group.allowsFraction;
    return reply.code(201).send({
      movimiento: escrito,
      saldoTexto: `${formatQty(aUnidadDeVenta(escrito.balanceBaseMilli, producto.saleUnit.factorMilli), fraccion)} ${producto.saleUnit.symbol}`,
      mensaje:
        datos.type === "SHRINKAGE"
          ? `Merma registrada. ${producto.name} queda en ${formatQty(aUnidadDeVenta(escrito.balanceBaseMilli, producto.saleUnit.factorMilli), fraccion)} ${producto.saleUnit.symbol}.`
          : `Ajuste registrado. ${producto.name} queda en ${formatQty(aUnidadDeVenta(escrito.balanceBaseMilli, producto.saleUnit.factorMilli), fraccion)} ${producto.saleUnit.symbol}.`,
    });
  });

  // ============================================================
  // 4.7 — Reconciliación
  // ============================================================

  /**
   * Recalcula `StockLevel` sumando el libro y deja registrada cada divergencia
   * como `Alert` de tipo `STOCK_RECONCILE_DIFF`.
   *
   * **La alerta se escribe ANTES de corregir el caché.** Al revés, la
   * corrección borraría la única evidencia de que hubo un descuadre: el saldo
   * quedaría bien y nadie se enteraría nunca de que el caché se había
   * despegado del libro, que es justo lo que este job existe para detectar.
   */
  app.post("/api/stock/reconcile", soloAdmin, async (req, reply) => {
    const porLibro = await db.stockMovement.groupBy({
      by: ["productId", "locationId"],
      _sum: { qtyBaseMilli: true },
    });
    const niveles = await db.stockLevel.findMany();

    const clave = (p: number, l: number) => `${p}:${l}`;
    const libro = new Map(porLibro.map((g) => [clave(g.productId, g.locationId), g._sum.qtyBaseMilli ?? 0]));
    const cache = new Map(niveles.map((n) => [clave(n.productId, n.locationId), n.qtyBaseMilli]));

    const claves = new Set([...libro.keys(), ...cache.keys()]);
    const divergencias: { productId: number; locationId: number; cache: number; libro: number; diff: number }[] = [];

    for (const k of claves) {
      const [productId, locationId] = k.split(":").map(Number) as [number, number];
      const enLibro = libro.get(k) ?? 0;
      const enCache = cache.get(k) ?? 0;
      if (enLibro !== enCache) {
        divergencias.push({ productId, locationId, cache: enCache, libro: enLibro, diff: enLibro - enCache });
      }
    }

    const productos = divergencias.length
      ? await db.product.findMany({
          where: { id: { in: divergencias.map((d) => d.productId) } },
          include: { saleUnit: { include: { group: true } } },
        })
      : [];
    const porId = new Map(productos.map((p) => [p.id, p]));

    for (const d of divergencias) {
      const p = porId.get(d.productId);
      const texto = p
        ? `${p.name}: el caché decía ${formatQty(aUnidadDeVenta(d.cache, p.saleUnit.factorMilli), p.saleUnit.group.allowsFraction)} y el libro dice ${formatQty(aUnidadDeVenta(d.libro, p.saleUnit.factorMilli), p.saleUnit.group.allowsFraction)} ${p.saleUnit.symbol}.`
        : `Producto ${d.productId}: caché ${d.cache}, libro ${d.libro} (milésimas de unidad base).`;
      await db.alert.create({
        data: {
          type: "STOCK_RECONCILE_DIFF",
          severity: "CRITICAL",
          productId: d.productId,
          locationId: d.locationId,
          message: texto,
        },
      });
    }

    // Recién ahora se corrige: el libro es la verdad, el nivel es caché.
    for (const d of divergencias) {
      await db.stockLevel.upsert({
        where: { productId_locationId: { productId: d.productId, locationId: d.locationId } },
        create: { productId: d.productId, locationId: d.locationId, qtyBaseMilli: d.libro },
        update: { qtyBaseMilli: d.libro },
      });
    }

    return reply.send({
      revisados: claves.size,
      divergencias: divergencias.length,
      detalle: divergencias,
      mensaje:
        divergencias.length === 0
          ? "El caché de saldos coincide con el libro en todos los productos."
          : `Se corrigieron ${divergencias.length} saldos y quedó una alerta por cada uno.`,
    });
  });

  app.get("/api/stock/alerts", soloAdmin, async () => {
    const alertas = await db.alert.findMany({
      where: { resolvedAt: null },
      orderBy: { id: "desc" },
      take: 100,
      include: { product: { select: { id: true, sku: true, name: true } } },
    });
    return { alertas };
  });

  // ============================================================
  // Valorizado: lo que hay en repisa y cuánto vale (INV-06)
  // ============================================================

  app.get("/api/stock/valued", soloAdmin, async (req) => {
    const niveles = await db.stockLevel.findMany({
      where: { locationId: req.user.locationId, NOT: { qtyBaseMilli: 0 } },
      include: { product: { include: { saleUnit: { include: { group: true } } } } },
      orderBy: { productId: "asc" },
    });
    const filas = niveles
      .filter((n) => n.product.deletedAt === null)
      .map((n) => ({
        productId: n.productId,
        sku: n.product.sku,
        name: n.product.name,
        qtyBaseMilli: n.qtyBaseMilli,
        cantidad: `${formatQty(aUnidadDeVenta(n.qtyBaseMilli, n.product.saleUnit.factorMilli), n.product.saleUnit.group.allowsFraction)} ${n.product.saleUnit.symbol}`,
        // Valor neto exacto en pesos: milésimas de base × milésimas de peso.
        valorNeto: roundSym((n.qtyBaseMilli * n.product.costNetMilliPeso) / 1_000_000),
      }));
    const total = filas.reduce((t, f) => t + f.valorNeto, 0);
    return { filas, total, totalTexto: formatCLP(total) };
  });
}
