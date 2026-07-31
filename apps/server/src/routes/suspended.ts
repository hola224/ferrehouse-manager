/**
 * Venta en espera (tarea 3.7, POS-08, ADR-001).
 *
 * El cliente se va a buscar otra cosa y el mesón se libera. Vive en tabla
 * aparte —no es una venta con estado "pendiente"— y **sin ninguna relación con
 * caja ni con stock**: una espera no reserva mercadería ni toca el arqueo. El
 * aislamiento es estructural, no disciplina.
 *
 * LO IMPORTANTE AL RECUPERAR: el precio guardado **nunca se cobra**. Se relee
 * el vigente y se le muestra al vendedor la diferencia. Guardar el precio y
 * cobrarlo después es cómo un sistema termina vendiendo a precios de hace tres
 * meses porque una espera quedó colgada.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { requireRole } from "../roles.js";
import { formatCLP } from "@ferrehouse/shared";

function malaPeticion(mensaje: string): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = 400;
  return e;
}

const idParam = z.object({ id: z.coerce.number().int().positive() });

const suspendedSchema = z.object({
  label: z
    .string()
    .trim()
    .min(2, "Ponle un nombre para reconocerla: «Sr. camioneta azul», «Don Luis»")
    .max(60),
  note: z.string().trim().max(200).nullable().optional(),
  items: z
    .array(
      z.object({
        productId: z.number().int().positive(),
        qtyMilli: z.number().int().positive("La cantidad tiene que ser mayor que cero"),
      }),
    )
    .min(1, "Una espera necesita al menos una línea"),
});

export async function registerSuspendedRoutes(app: FastifyInstance): Promise<void> {
  const cualquiera = { preHandler: requireRole("ADMIN", "SELLER") };

  app.get("/api/suspended", cualquiera, async (req) => {
    const esperas = await db.suspendedSale.findMany({
      where: { locationId: req.user.locationId },
      orderBy: { touchedAt: "desc" },
      include: { user: { select: { name: true } }, items: true },
    });
    return {
      esperas: esperas.map((e) => ({
        id: e.id,
        label: e.label,
        note: e.note,
        lineas: e.items.length,
        createdAt: e.createdAt,
        touchedAt: e.touchedAt,
        user: e.user,
      })),
    };
  });

  app.post("/api/suspended", cualquiera, async (req, reply) => {
    const datos = suspendedSchema.parse(req.body);

    const productos = await db.product.findMany({
      where: { id: { in: [...new Set(datos.items.map((i) => i.productId))] }, deletedAt: null },
      select: { id: true, name: true, saleUnitId: true, priceGross: true },
    });
    const porId = new Map(productos.map((p) => [p.id, p]));
    const faltante = datos.items.find((i) => !porId.has(i.productId));
    if (faltante) throw malaPeticion("Un producto de la espera ya no existe.");

    /**
     * Dos esperas con el mismo nombre confunden, pero reventar con un error en
     * pleno mesón es peor (ADR-001). Se avisa y se sigue.
     */
    const repetida = await db.suspendedSale.findFirst({
      where: { locationId: req.user.locationId, label: datos.label },
    });

    const espera = await db.suspendedSale.create({
      data: {
        locationId: req.user.locationId,
        userId: req.user.sub,
        label: datos.label,
        note: datos.note ?? null,
        items: {
          create: datos.items.map((i) => {
            const p = porId.get(i.productId)!;
            return {
              productId: p.id,
              unitId: p.saleUnitId,
              qtyMilli: i.qtyMilli,
              // Foto NO vinculante: sirve para mostrar el delta al recuperar.
              unitPriceGrossAtHold: p.priceGross,
            };
          }),
        },
      },
      include: { items: true },
    });

    return reply.code(201).send({
      espera,
      aviso: repetida ? `Ojo: ya hay otra espera llamada «${datos.label}».` : null,
      mensaje: `Guardada como «${espera.label}».`,
    });
  });

  /**
   * Recuperar. **No cobra ni borra nada**: devuelve las líneas con el precio
   * VIGENTE y, cuando cambió, también el que tenía al suspender, para que el
   * vendedor lo vea antes de cobrar.
   */
  app.get("/api/suspended/:id", cualquiera, async (req) => {
    const { id } = idParam.parse(req.params);
    const espera = await db.suspendedSale.findUnique({
      where: { id },
      include: {
        user: { select: { name: true } },
        items: {
          include: {
            unit: true,
            product: { include: { saleUnit: { include: { group: true } } } },
          },
        },
      },
    });
    if (!espera) throw malaPeticion("Esa espera ya no existe: puede que alguien la haya cobrado o descartado.");

    const lineas = espera.items.map((it) => {
      const precioAhora = it.product.priceGross;
      const cambioPrecio = precioAhora !== it.unitPriceGrossAtHold;

      /**
       * Si la unidad de venta del producto cambió, la línea NO se recupera en
       * silencio. La cantidad está expresada en la unidad vieja, y las dos
       * pueden ser del mismo grupo —un rollo y un metro—, así que ninguna
       * validación de grupo lo detectaría: se cobraría el precio nuevo sobre
       * una cantidad que significa otra cosa.
       */
      const cambioUnidad = it.product.saleUnitId !== it.unitId;

      return {
        productId: it.productId,
        nombre: it.product.name,
        sku: it.product.sku,
        qtyMilli: it.qtyMilli,
        unidadGuardada: it.unit.symbol,
        unidadActual: it.product.saleUnit.symbol,
        /**
         * La unidad de venta ENTERA y si su grupo admite fracciones.
         *
         * La pantalla de venta arma sus líneas con esta forma —es la misma que
         * devuelve la búsqueda de productos— y sin ella tendría que inventarla.
         * Se intentó: la línea recuperada quedaba sin `saleUnit` y la pantalla
         * de venta se caía entera al pintar la tabla, con la venta adentro.
         */
        saleUnit: {
          id: it.product.saleUnit.id,
          symbol: it.product.saleUnit.symbol,
          factorMilli: it.product.saleUnit.factorMilli,
          groupId: it.product.saleUnit.groupId,
        },
        allowsFraction: it.product.saleUnit.group.allowsFraction,
        precioAhora,
        precioAlSuspender: it.unitPriceGrossAtHold,
        disponible: it.product.active && it.product.deletedAt === null,
        aviso: cambioUnidad
          ? `La unidad de venta cambió de ${it.unit.symbol} a ${it.product.saleUnit.symbol}. Revisa la cantidad antes de cobrar.`
          : cambioPrecio
            ? `El precio cambió de ${formatCLP(it.unitPriceGrossAtHold)} a ${formatCLP(precioAhora)}.`
            : null,
      };
    });

    return {
      espera: { id: espera.id, label: espera.label, note: espera.note, createdAt: espera.createdAt, user: espera.user },
      lineas,
      // Se resume arriba para que la pantalla no tenga que recorrer las líneas
      // solo para saber si hay que avisar algo.
      hayCambios: lineas.some((l) => l.aviso !== null || !l.disponible),
    };
  });

  app.patch("/api/suspended/:id", cualquiera, async (req) => {
    const { id } = idParam.parse(req.params);
    const datos = suspendedSchema.partial({ items: true }).parse(req.body);

    const espera = await db.suspendedSale.findUnique({ where: { id } });
    if (!espera) throw malaPeticion("Esa espera ya no existe.");

    await db.$transaction(async (tx) => {
      if (datos.items) {
        const productos = await tx.product.findMany({
          where: { id: { in: [...new Set(datos.items.map((i) => i.productId))] } },
          select: { id: true, saleUnitId: true, priceGross: true },
        });
        const porId = new Map(productos.map((p) => [p.id, p]));
        await tx.suspendedSaleItem.deleteMany({ where: { suspendedSaleId: id } });
        await tx.suspendedSaleItem.createMany({
          data: datos.items.map((i) => {
            const p = porId.get(i.productId)!;
            return {
              suspendedSaleId: id,
              productId: p.id,
              unitId: p.saleUnitId,
              qtyMilli: i.qtyMilli,
              unitPriceGrossAtHold: p.priceGross,
            };
          }),
        });
      }
      await tx.suspendedSale.update({
        where: { id },
        data: {
          ...(datos.label !== undefined ? { label: datos.label } : {}),
          ...(datos.note !== undefined ? { note: datos.note } : {}),
          /**
           * `touchedAt` la escribe la APLICACIÓN, no `@updatedAt`: la forma
           * normal de editar una espera es agregar o quitar líneas, y eso no
           * toca ningún escalar de esta fila. Con `@updatedAt` la alerta de
           * espera añeja (Sprint 5) mediría mal.
           */
          touchedAt: new Date(),
        },
      });
    });

    return { ok: true };
  });

  app.delete("/api/suspended/:id", cualquiera, async (req) => {
    const { id } = idParam.parse(req.params);
    const espera = await db.suspendedSale.findUnique({ where: { id } });
    if (!espera) throw malaPeticion("Esa espera ya no existe.");
    // Borrado de verdad: una espera descartada no es historia de nada. No tocó
    // stock ni caja, así que no deja huecos.
    await db.suspendedSale.delete({ where: { id } });
    return { ok: true, mensaje: `Espera «${espera.label}» descartada.` };
  });
}
