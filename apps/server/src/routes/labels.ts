/**
 * Etiquetas de producto (tarea 1.3, CAT-02).
 *
 * "Media tienda no tiene código de barras" — tornillos, fittings, terminales.
 * A esos se les imprime una etiqueta con el SKU interno en Code128, y el
 * lector la lee de vuelta como si fuera de fábrica.
 *
 * La impresión NO sale directo al puerto: entra en la cola `PrintJob` con su
 * `stationId` (decisión sellada 9). Hoy hay una sola térmica USB colgando del
 * servidor, pero el día que haya dos, la cola ya sabe a cuál va cada trabajo
 * y no hay que reescribir nada. El worker que vacía la cola llega en el
 * Sprint 3 junto con el ticket: hasta entonces los trabajos se acumulan como
 * PENDING, que es exactamente lo que una cola debe hacer si nadie la atiende.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { requireRole } from "../roles.js";
import { code128Svg, formatCLP, esCodificableCode128B, stripDiacritics } from "@ferrehouse/shared";

const idParam = z.object({ id: z.coerce.number().int().positive() });

// --- ESC/POS ---
const ESC = 0x1b;
const GS = 0x1d;

/**
 * Bytes de la etiqueta. El código de barras lo dibuja LA IMPRESORA con `GS k`,
 * no nosotros: a 203 dpi el rasterizado propio pierde nitidez, y con Code128
 * la nitidez es la diferencia entre que el lector lea al primer intento o que
 * el vendedor tenga que insistir tres veces con el cliente al frente.
 */
function etiquetaEscPos(datos: { sku: string; nombre: string; precio: number }): Buffer {
  /**
   * La térmica no habla UTF-8, y tampoco latin1: por omisión usa una tabla tipo
   * CP437/CP850, donde la ñ es 0xA4 y no 0xF1. Mandarle "Cañería" tal cual
   * imprime basura, y no hay forma de comprobarlo sin la impresora en la mano.
   *
   * Así que se le quitan las tildes antes de mandarlo. "Caneria PVC" se lee; el
   * mojibake no. Cuando en el Sprint 3 se conecte la térmica de verdad y se
   * sepa qué tabla usa, esto se reemplaza por la codificación correcta — el
   * ticket va a necesitar exactamente la misma decisión.
   */
  const texto = (s: string) => Buffer.from(stripDiacritics(s), "ascii");
  const bytes: Buffer[] = [];

  bytes.push(Buffer.from([ESC, 0x40])); // ESC @ — reiniciar impresora
  bytes.push(Buffer.from([ESC, 0x61, 0x01])); // centrado

  // Nombre recortado: en 58 mm entran unos 32 caracteres por línea.
  bytes.push(texto(datos.nombre.slice(0, 32) + "\n"));

  bytes.push(Buffer.from([GS, 0x68, 0x50])); // GS h — alto del código: 80 puntos
  bytes.push(Buffer.from([GS, 0x77, 0x02])); // GS w — ancho del módulo: 2
  bytes.push(Buffer.from([GS, 0x48, 0x02])); // GS H — imprimir el texto debajo

  // GS k 73 <largo> <datos> — el 73 es Code128; el 0x7b 0x42 al principio de
  // los datos le dice a la impresora que use el subconjunto B.
  const carga = Buffer.concat([Buffer.from([0x7b, 0x42]), texto(datos.sku)]);
  bytes.push(Buffer.from([GS, 0x6b, 73, carga.length]), carga);

  bytes.push(Buffer.from([ESC, 0x21, 0x30])); // doble alto y ancho
  bytes.push(texto("\n" + formatCLP(datos.precio) + "\n"));
  bytes.push(Buffer.from([ESC, 0x21, 0x00])); // volver a tamaño normal
  bytes.push(texto("\n\n"));

  return Buffer.concat(bytes);
}

export async function registerLabelRoutes(app: FastifyInstance): Promise<void> {
  const cualquiera = { preHandler: requireRole("ADMIN", "SELLER") };

  /**
   * Vista previa en SVG. Es lo que se mira antes de gastar etiquetas: el
   * Code128 que dibuja este SVG codifica el mismo texto que va a la térmica.
   */
  app.get("/api/products/:id/label.svg", cualquiera, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const producto = await db.product.findFirst({ where: { id, deletedAt: null } });
    if (!producto) {
      const e = new Error("Ese producto no existe") as Error & { statusCode: number };
      e.statusCode = 404;
      throw e;
    }
    const svg = code128Svg(producto.sku, {
      titulo: producto.name,
      precio: formatCLP(producto.priceGross),
    });
    return reply.type("image/svg+xml").send(svg);
  });

  /**
   * Encolar la impresión. Solo el admin: imprimir etiquetas es organizar la
   * repisa, no vender.
   */
  app.post("/api/products/:id/label", { preHandler: requireRole("ADMIN") }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { copias, stationId } = z
      .object({
        copias: z.coerce.number().int().min(1).max(100).default(1),
        stationId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.body ?? {});

    const producto = await db.product.findFirst({ where: { id, deletedAt: null } });
    if (!producto) {
      const e = new Error("Ese producto no existe") as Error & { statusCode: number };
      e.statusCode = 404;
      throw e;
    }
    if (!esCodificableCode128B(producto.sku)) {
      const e = new Error(`El SKU ${producto.sku} tiene caracteres que Code128 no codifica`) as Error & {
        statusCode: number;
      };
      e.statusCode = 400;
      throw e;
    }

    // Por omisión imprime en la estación desde la que se está trabajando: es
    // la que tiene la impresora al lado.
    const destino = stationId ?? req.user.stationId;
    const estacion = await db.station.findUnique({ where: { id: destino } });
    if (!estacion || !estacion.active) {
      const e = new Error("Esa caja no existe o está inactiva") as Error & { statusCode: number };
      e.statusCode = 400;
      throw e;
    }
    if (!estacion.printerTarget) {
      const e = new Error(`${estacion.name} no tiene impresora configurada`) as Error & { statusCode: number };
      e.statusCode = 400;
      throw e;
    }

    const payload = Buffer.concat(
      Array.from({ length: copias }, () =>
        etiquetaEscPos({ sku: producto.sku, nombre: producto.name, precio: producto.priceGross }),
      ),
    ).toString("base64");

    const trabajo = await db.printJob.create({
      data: { stationId: destino, type: "LABEL", payload },
      select: { id: true, stationId: true, type: true, status: true, createdAt: true },
    });

    return reply.code(201).send({
      trabajo,
      mensaje: `${copias} etiqueta${copias > 1 ? "s" : ""} de ${producto.sku} en la cola de ${estacion.name}.`,
    });
  });
}
