/**
 * El consumidor de la cola de impresión.
 *
 * Hasta ahora `PrintJob` se llenaba y no lo leía nadie: vender dejaba el ticket
 * en ESC/POS guardado en la base y ahí se quedaba para siempre. La venta se
 * registraba bien, el arqueo cuadraba, y del papel no salía nada.
 *
 * DOS REGLAS QUE GOBIERNAN TODO LO DEMÁS:
 *
 * 1. **Un ticket no se imprime dos veces.** Es la regla que manda sobre la de
 *    reintentar. Cobrar de nuevo con un ticket duplicado en la mano es un
 *    problema en el mesón; un ticket que no salió se reimprime con un botón.
 *    Por eso el trabajo se RECLAMA con un update condicional antes de mandarlo,
 *    y por eso un trabajo que quedó en PRINTING —el servicio se cayó justo
 *    mientras imprimía— no se reintenta solo: nadie sabe si el papel salió, y
 *    esa pregunta la contesta una persona mirando la impresora.
 *
 * 2. **La impresora apagada no gasta intentos.** Es la misma regla que la cola
 *    de WhatsApp aplica a la sesión caída y por la misma razón: si cada pasada
 *    consumiera un intento, apagar la impresora para cambiarle el papel dejaría
 *    la cola entera en FALLIDO y los tickets no saldrían nunca al volver. Un
 *    intento se gasta solo cuando se habló con la impresora y aun así falló.
 */
import { db } from "../db.js";
import { getSetting } from "../settings.js";
import { transporteImpresion, type TransporteImpresion } from "./transporte.js";

export type DepsImpresion = {
  ahora?: () => Date;
  transporte?: TransporteImpresion;
};

export type ResumenImpresion = {
  revisados: number;
  impresos: number;
  reintentables: number;
  fallidos: number;
  /** Sin impresora configurada en la estación: no hay nada que intentar. */
  sinDestino: number;
};

/**
 * Una pasada: manda hasta `limite` trabajos pendientes.
 *
 * En orden de creación y de a uno. De a uno y no en paralelo porque dos
 * trabajos a la misma térmica se entrelazan: la impresora no tiene cola propia,
 * y medio ticket de una venta dentro de otro no es un ticket de nadie.
 */
export async function procesarImpresiones(deps: DepsImpresion = {}, limite = 10): Promise<ResumenImpresion> {
  const ahora = deps.ahora?.() ?? new Date();
  const t = deps.transporte ?? transporteImpresion();
  const maxIntentos = await getSetting("print.maxAttempts");

  const resumen: ResumenImpresion = { revisados: 0, impresos: 0, reintentables: 0, fallidos: 0, sinDestino: 0 };

  const pendientes = await db.printJob.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limite,
    include: { station: { select: { name: true, printerTarget: true } } },
  });

  for (const job of pendientes) {
    resumen.revisados++;

    /**
     * Sin impresora configurada no se toca el trabajo: queda PENDIENTE. Es lo
     * correcto y no una omisión — la caja de consulta no imprime a propósito, y
     * la caja del mesón a la que todavía no le configuraron la térmica va a
     * tener una el lunes. Cuando la tenga, esto sale solo. Quien avisa es el
     * mesón, en el momento: `sales.ts` ya devuelve el aviso al cobrar.
     */
    if (!job.station.printerTarget) {
      resumen.sinDestino++;
      continue;
    }

    /**
     * RECLAMAR. El `updateMany` con `status: "PENDING"` en el where es lo que
     * hace que dos pasadas superpuestas no manden el mismo ticket dos veces:
     * la segunda actualiza cero filas y se va. Con `connection_limit=1` hoy hay
     * una sola escritura a la vez, pero esto no depende de eso — depende de la
     * fila, que es donde tiene que estar.
     */
    const reclamado = await db.printJob.updateMany({
      where: { id: job.id, status: "PENDING" },
      data: { status: "PRINTING" },
    });
    if (reclamado.count === 0) continue;

    const r = await t.imprimir(job.station.printerTarget, Buffer.from(job.payload, "base64"));

    if (r.ok) {
      await db.printJob.update({
        where: { id: job.id },
        data: { status: "DONE", attempts: job.attempts + 1, printedAt: ahora, lastError: null },
      });
      resumen.impresos++;
      continue;
    }

    /**
     * No se pudo ni hablar con ella: vuelve a PENDIENTE **sin gastar intento**.
     * El error igual se anota, porque es lo que el panel muestra para explicar
     * por qué hay tickets esperando.
     */
    if (!r.alcanzable) {
      await db.printJob.update({ where: { id: job.id }, data: { status: "PENDING", lastError: r.error } });
      resumen.reintentables++;
      continue;
    }

    const intentos = job.attempts + 1;
    if (intentos >= maxIntentos) {
      await db.printJob.update({
        where: { id: job.id },
        data: { status: "FAILED", attempts: intentos, lastError: r.error },
      });
      resumen.fallidos++;
      continue;
    }

    await db.printJob.update({
      where: { id: job.id },
      data: { status: "PENDING", attempts: intentos, lastError: r.error },
    });
    resumen.reintentables++;
  }

  return resumen;
}

/**
 * Devuelve un trabajo a la cola (el botón «reimprimir» del panel).
 *
 * Sirve para los FALLIDOS y también para los que quedaron colgados en
 * PRINTING, que es el único camino de vuelta que tienen: la pasada automática
 * no los toca a propósito. Los intentos vuelven a cero porque si alguien
 * reintenta a mano es porque arregló algo —puso papel, encendió la impresora— y
 * dejarle un solo intento haría que se cayera de nuevo al primer tropiezo.
 */
export async function reintentarImpresion(jobId: string): Promise<void> {
  await db.printJob.update({
    where: { id: jobId },
    data: { status: "PENDING", attempts: 0, lastError: null },
  });
}

/** Para el panel: qué está esperando y qué se cayó. */
export async function resumenDeImpresion(): Promise<{
  pendientes: number;
  fallidos: number;
  colgados: number;
  impresosHoy: number;
}> {
  const inicioDelDia = new Date();
  inicioDelDia.setHours(0, 0, 0, 0);
  const [pendientes, fallidos, colgados, impresosHoy] = await Promise.all([
    db.printJob.count({ where: { status: "PENDING" } }),
    db.printJob.count({ where: { status: "FAILED" } }),
    db.printJob.count({ where: { status: "PRINTING" } }),
    db.printJob.count({ where: { status: "DONE", printedAt: { gte: inicioDelDia } } }),
  ]);
  return { pendientes, fallidos, colgados, impresosHoy };
}

// ============================================================
// El lazo, que solo corre en el servidor de verdad
// ============================================================

let lazo: NodeJS.Timeout | null = null;

/**
 * Cada 3 segundos, y no cada 30 como el de WhatsApp.
 *
 * Los dos números salen del mismo razonamiento y dan distinto porque el que
 * espera es distinto. El mensaje de WhatsApp lo lee el cliente en su casa, un
 * rato después; el ticket lo espera alguien de pie en el mesón, con la mano
 * estirada. Tres segundos es lo que se tolera entre apretar «Cobrar» y oír la
 * impresora.
 *
 * `desfase` protege del solapamiento: si una pasada se demora más que el
 * intervalo —una impresora que agota los 10 segundos de espera—, la siguiente
 * no arranca encima. El reclamo por fila ya impide el doble ticket; esto
 * impide además la fila de pasadas apiladas.
 */
let corriendo = false;

export function iniciarWorkerImpresion(cadaMs = 3_000): void {
  if (lazo) return;
  lazo = setInterval(() => {
    if (corriendo) return;
    corriendo = true;
    procesarImpresiones()
      .catch((e) => console.error("[impresion] la pasada de la cola falló:", e))
      .finally(() => {
        corriendo = false;
      });
  }, cadaMs);
  lazo.unref?.();
}

export function detenerWorkerImpresion(): void {
  if (lazo) clearInterval(lazo);
  lazo = null;
  corriendo = false;
}
