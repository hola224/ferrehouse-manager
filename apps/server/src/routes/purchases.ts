/**
 * Compras a proveedor (tareas 4.1 y 4.2).
 *
 * ES LA PUERTA POR DONDE ENTRA EL COSTO. Hasta acá el costo de un producto se
 * tecleaba; desde la primera compra lo manda el libro (decisión sellada 18) y
 * el formulario deja de aceptarlo.
 *
 * DOS CONVERSIONES QUE SE EQUIVOCAN SOLAS:
 *
 * 1. **La unidad.** El proveedor factura el saco, la ferretería vende el kilo.
 *    `unitCostNet` son pesos por unidad de COMPRA; el libro lleva unidad BASE.
 *    Un saco de 25 kg a $4.500 son $180 el kilo, y guardar 4.500 como costo
 *    del kilo infla el inventario 25 veces.
 *
 * 2. **La fecha.** El movimiento se fecha con `receivedAt` —cuándo llegó la
 *    mercadería—, no con el momento de digitar la factura. La factura del
 *    viernes se teclea el lunes.
 *
 * Solo ADMIN, y no por pudor: una compra lleva costos en cada línea, y la
 * decisión sellada 17 dice que lo que el vendedor no puede ver no sale del
 * servidor.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { requireRole } from "../roles.js";
import { registrarMovimiento } from "../stock-ledger.js";
import { purchaseInputSchema, toBaseMilli, roundSym, validarUnidades, formatCLP } from "@ferrehouse/shared";

function malaPeticion(mensaje: string): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = 400;
  return e;
}

const idParam = z.object({ id: z.coerce.number().int().positive() });

export async function registerPurchaseRoutes(app: FastifyInstance): Promise<void> {
  const soloAdmin = { preHandler: requireRole("ADMIN") };

  app.get("/api/purchases", soloAdmin, async (req) => {
    const q = z
      .object({ take: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(req.query ?? {});
    const compras = await db.purchase.findMany({
      where: { locationId: req.user.locationId },
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take: q.take,
      include: {
        supplier: { select: { id: true, name: true } },
        user: { select: { name: true } },
        _count: { select: { items: true } },
      },
    });
    return {
      compras: compras.map((c) => ({
        id: c.id,
        supplier: c.supplier,
        documentNumber: c.documentNumber,
        receivedAt: c.receivedAt,
        totalNet: c.totalNet,
        lineas: c._count.items,
        user: c.user,
      })),
    };
  });

  app.get("/api/purchases/:id", soloAdmin, async (req) => {
    const { id } = idParam.parse(req.params);
    const compra = await db.purchase.findUnique({
      where: { id },
      include: {
        supplier: true,
        user: { select: { name: true } },
        items: { include: { product: { select: { id: true, sku: true, name: true } }, unit: true } },
      },
    });
    if (!compra) throw malaPeticion("Esa compra no existe.");
    return { compra };
  });

  app.post("/api/purchases", soloAdmin, async (req, reply) => {
    const datos = purchaseInputSchema.parse(req.body);

    const recibida = datos.receivedAt ?? new Date();
    // Recibir mercadería mañana no es un caso de borde: es un tecleo con el
    // año equivocado, y deja el kardex con una fila en el futuro que ninguna
    // consulta por rango vuelve a mostrar.
    if (recibida.getTime() > Date.now() + 60_000) {
      throw malaPeticion("La fecha de recepción no puede ser futura.");
    }

    const proveedor = await db.supplier.findFirst({ where: { id: datos.supplierId, active: true } });
    if (!proveedor) throw malaPeticion("Ese proveedor no existe o está desactivado.");

    const ids = [...new Set(datos.items.map((i) => i.productId))];
    const productos = await db.product.findMany({
      where: { id: { in: ids }, deletedAt: null },
      include: { saleUnit: { include: { group: true } } },
    });
    const porId = new Map(productos.map((p) => [p.id, p]));
    const faltante = ids.find((i) => !porId.has(i));
    if (faltante) throw malaPeticion(`Un producto de la compra ya no existe (id ${faltante}).`);

    const unidades = await db.unit.findMany({ where: { id: { in: [...new Set(datos.items.map((i) => i.unitId))] } } });
    const unidadPorId = new Map(unidades.map((u) => [u.id, u]));

    // --- Preparar cada línea antes de escribir nada ---
    const lineas = datos.items.map((it) => {
      const p = porId.get(it.productId)!;
      const unidad = unidadPorId.get(it.unitId);
      if (!unidad) throw malaPeticion("Una de las unidades de la compra no existe.");

      const problema = validarUnidades(p.saleUnit, unidad);
      if (problema) throw malaPeticion(`${p.name}: ${problema}`);

      if (!p.saleUnit.group.allowsFraction && it.qtyMilli % 1000 !== 0) {
        throw malaPeticion(`${p.name} no se cuenta fraccionado: la cantidad tiene que ser un número entero.`);
      }

      const qtyBaseMilli = toBaseMilli(it.qtyMilli, unidad.factorMilli);
      if (qtyBaseMilli <= 0) {
        throw malaPeticion(`${p.name}: esa cantidad es demasiado chica para la unidad ${unidad.symbol}.`);
      }

      // Pesos exactos de la línea. Se guarda el TOTAL, no un costo por unidad
      // base: el total es exacto por construcción y es lo que suma la factura.
      const lineTotalNet = roundSym((it.unitCostNet * it.qtyMilli) / 1000);

      return { it, p, unidad, qtyBaseMilli, lineTotalNet };
    });

    const totalNet = lineas.reduce((t, l) => t + l.lineTotalNet, 0);

    const compra = await db.$transaction(async (tx) => {
      const creada = await tx.purchase.create({
        data: {
          supplierId: datos.supplierId,
          locationId: req.user.locationId,
          userId: req.user.sub,
          documentNumber: datos.documentNumber ?? null,
          notes: datos.notes ?? null,
          totalNet,
          receivedAt: recibida,
        },
      });

      for (const l of lineas) {
        await tx.purchaseItem.create({
          data: {
            purchaseId: creada.id,
            productId: l.p.id,
            unitId: l.unidad.id,
            qtyMilli: l.it.qtyMilli,
            unitCostNet: l.it.unitCostNet,
            lineTotalNet: l.lineTotalNet,
          },
        });

        await registrarMovimiento(tx, {
          productId: l.p.id,
          locationId: req.user.locationId,
          type: "PURCHASE",
          qtyBaseMilli: l.qtyBaseMilli,
          totalCostNet: l.lineTotalNet,
          userId: req.user.sub,
          refType: "PURCHASE",
          refId: creada.id,
          createdAt: recibida,
        });
      }

      return creada;
    });

    /**
     * Se devuelve el costo promedio que quedó, producto por producto. Es el
     * número que el administrador va a querer mirar apenas digite la factura
     * —"¿en cuánto me quedó el cemento?"— y buscarlo producto por producto en
     * el catálogo es exactamente la fricción que hace que nadie lo revise.
     */
    const despues = await db.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, costNetMilliPeso: true, saleUnit: { select: { symbol: true, factorMilli: true } } },
    });

    return reply.code(201).send({
      compra: await db.purchase.findUniqueOrThrow({
        where: { id: compra.id },
        include: { supplier: true, items: { include: { product: true, unit: true } } },
      }),
      costos: despues.map((p) => ({
        productId: p.id,
        nombre: p.name,
        costNetMilliPeso: p.costNetMilliPeso,
        texto: `${p.name}: ${formatCLP(roundSym((p.costNetMilliPeso * p.saleUnit.factorMilli) / 1_000_000))} por ${p.saleUnit.symbol}`,
      })),
      mensaje: `Compra registrada por ${formatCLP(totalNet)} neto.`,
    });
  });
}
