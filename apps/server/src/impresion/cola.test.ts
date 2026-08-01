/**
 * El consumidor de la cola de impresión.
 *
 * El transporte se inyecta, así que todo esto corre sin una impresora conectada
 * y sin gastar un centímetro de papel. Lo que NO se prueba acá es que la
 * Bixolon entienda los bytes: eso necesita la impresora y está dicho en el
 * README de instalación.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { db } from "../db.js";
import { procesarImpresiones, reintentarImpresion, resumenDeImpresion } from "./cola.js";
import type { ResultadoImpresion, TransporteImpresion } from "./transporte.js";
import { setSetting } from "../settings.js";
// Importarlo es lo que arma la base de este archivo: registra el `beforeAll`
// que aplica las migraciones y siembra. Sin este import no hay ni esquema.
import "../test-setup.js";

let idCaja: number, idCajaSinImpresora: number;

/** Un transporte que anota lo que le mandaron y contesta lo que se le diga. */
function transporteFalso(responder: () => ResultadoImpresion = () => ({ ok: true })): TransporteImpresion & {
  trabajos: Array<{ destino: string; bytes: Buffer }>;
} {
  const trabajos: Array<{ destino: string; bytes: Buffer }> = [];
  return {
    trabajos,
    async imprimir(destino, bytes) {
      trabajos.push({ destino, bytes });
      return responder();
    },
  };
}

const APAGADA = (): ResultadoImpresion => ({ ok: false, error: "no contestó", alcanzable: false });
const RECHAZA = (): ResultadoImpresion => ({ ok: false, error: "sin papel", alcanzable: true });

const BYTES = Buffer.from([0x1b, 0x40, 0x41, 0x1a, 0x42]); // con un 0x1A adentro, a propósito

beforeAll(async () => {
  const local = await db.location.findFirstOrThrow({ where: { isDefault: true } });
  idCaja = (await db.station.update({ where: { name: "CAJA-1" }, data: { printerTarget: "\\\\SRV\\TERMICA" } })).id;
  idCajaSinImpresora = (
    await db.station.create({ data: { name: "CONSULTA", locationId: local.id, active: true, printerTarget: null } })
  ).id;
});

beforeEach(async () => {
  await db.printJob.deleteMany();
  await setSetting("print.maxAttempts", 3);
});

const encolar = (stationId = idCaja, payload = BYTES) =>
  db.printJob.create({ data: { stationId, type: "RECEIPT", payload: payload.toString("base64") } });

const leer = (id: string) => db.printJob.findUniqueOrThrow({ where: { id } });

describe("imprimir lo que está pendiente", () => {
  it("manda los bytes al destino de la estación y lo marca impreso", async () => {
    const job = await encolar();
    const t = transporteFalso();

    const r = await procesarImpresiones({ transporte: t });

    expect(r.impresos).toBe(1);
    expect(t.trabajos).toHaveLength(1);
    expect(t.trabajos[0]!.destino).toBe("\\\\SRV\\TERMICA");
    // Los bytes llegan tal cual, sin pasar por texto en ninguna parte.
    expect(t.trabajos[0]!.bytes.equals(BYTES)).toBe(true);

    const despues = await leer(job.id);
    expect(despues.status).toBe("DONE");
    expect(despues.printedAt).not.toBeNull();
    expect(despues.lastError).toBeNull();
  });

  it("los manda en orden de creación", async () => {
    const a = await encolar(idCaja, Buffer.from("primero"));
    const b = await encolar(idCaja, Buffer.from("segundo"));
    const t = transporteFalso();

    await procesarImpresiones({ transporte: t });

    expect(t.trabajos.map((x) => x.bytes.toString())).toEqual(["primero", "segundo"]);
    expect((await leer(a.id)).status).toBe("DONE");
    expect((await leer(b.id)).status).toBe("DONE");
  });

  it("respeta el límite por pasada", async () => {
    await encolar();
    await encolar();
    const r = await procesarImpresiones({ transporte: transporteFalso() }, 1);
    expect(r.impresos).toBe(1);
    expect(await db.printJob.count({ where: { status: "PENDING" } })).toBe(1);
  });

  it("no toca lo que ya está impreso", async () => {
    const job = await encolar();
    await procesarImpresiones({ transporte: transporteFalso() });
    const t = transporteFalso();
    const r = await procesarImpresiones({ transporte: t });
    expect(r.revisados).toBe(0);
    expect(t.trabajos).toHaveLength(0);
    expect((await leer(job.id)).attempts).toBe(1);
  });
});

describe("la caja sin impresora", () => {
  /**
   * No es una omisión: la caja de consulta no imprime a propósito, y la del
   * mesón a la que todavía no le configuraron la térmica va a tener una. El
   * trabajo espera, no se pierde.
   */
  it("deja el trabajo esperando en vez de darlo por fallido", async () => {
    const job = await encolar(idCajaSinImpresora);
    const t = transporteFalso();

    const r = await procesarImpresiones({ transporte: t });

    expect(r.sinDestino).toBe(1);
    expect(t.trabajos).toHaveLength(0);
    const despues = await leer(job.id);
    expect(despues.status).toBe("PENDING");
    expect(despues.attempts).toBe(0);
  });

  it("y sale solo cuando le configuran una", async () => {
    await encolar(idCajaSinImpresora);
    await procesarImpresiones({ transporte: transporteFalso() });

    await db.station.update({ where: { id: idCajaSinImpresora }, data: { printerTarget: "\\\\SRV\\T2" } });
    const r = await procesarImpresiones({ transporte: transporteFalso() });

    expect(r.impresos).toBe(1);
  });
});

describe("la impresora apagada", () => {
  /**
   * LA REGLA QUE SOSTIENE TODO. Si cada pasada consumiera un intento, apagar la
   * impresora para cambiarle el papel dejaría la cola entera en FALLIDO —el
   * worker pasa cada 3 segundos— y los tickets no saldrían nunca al volver.
   */
  it("no gasta intentos: el trabajo sigue esperando", async () => {
    const job = await encolar();

    for (let i = 0; i < 5; i++) await procesarImpresiones({ transporte: transporteFalso(APAGADA) });

    const despues = await leer(job.id);
    expect(despues.status).toBe("PENDING");
    expect(despues.attempts).toBe(0);
    // El error igual queda anotado: es lo que el panel muestra para explicar
    // por qué hay tickets esperando.
    expect(despues.lastError).toContain("no contestó");
  });

  it("y el ticket sale cuando la vuelven a encender", async () => {
    await encolar();
    await procesarImpresiones({ transporte: transporteFalso(APAGADA) });

    const r = await procesarImpresiones({ transporte: transporteFalso() });
    expect(r.impresos).toBe(1);
  });
});

describe("la impresora que rechaza el trabajo", () => {
  it("gasta un intento por pasada y se da por perdido en el tope", async () => {
    const job = await encolar();

    await procesarImpresiones({ transporte: transporteFalso(RECHAZA) });
    expect((await leer(job.id)).attempts).toBe(1);
    expect((await leer(job.id)).status).toBe("PENDING");

    await procesarImpresiones({ transporte: transporteFalso(RECHAZA) });
    expect((await leer(job.id)).attempts).toBe(2);

    const r = await procesarImpresiones({ transporte: transporteFalso(RECHAZA) });
    expect(r.fallidos).toBe(1);
    const despues = await leer(job.id);
    expect(despues.status).toBe("FAILED");
    expect(despues.attempts).toBe(3);
    expect(despues.lastError).toBe("sin papel");
  });

  it("un fallido no se vuelve a intentar solo", async () => {
    const job = await encolar();
    for (let i = 0; i < 3; i++) await procesarImpresiones({ transporte: transporteFalso(RECHAZA) });
    expect((await leer(job.id)).status).toBe("FAILED");

    const t = transporteFalso();
    const r = await procesarImpresiones({ transporte: t });
    expect(r.revisados).toBe(0);
    expect(t.trabajos).toHaveLength(0);
  });

  it("el tope sale de la configuración, no de una constante", async () => {
    await setSetting("print.maxAttempts", 1);
    const job = await encolar();
    await procesarImpresiones({ transporte: transporteFalso(RECHAZA) });
    expect((await leer(job.id)).status).toBe("FAILED");
  });
});

describe("un ticket no se imprime dos veces", () => {
  /**
   * La regla que manda sobre la de reintentar. Un ticket duplicado en la mano
   * de un cliente es un problema en el mesón; uno que no salió se reimprime con
   * un botón.
   */
  it("dos pasadas al mismo tiempo mandan el trabajo una sola vez", async () => {
    await encolar();
    const t = transporteFalso();

    await Promise.all([procesarImpresiones({ transporte: t }), procesarImpresiones({ transporte: t })]);

    expect(t.trabajos).toHaveLength(1);
    expect(await db.printJob.count({ where: { status: "DONE" } })).toBe(1);
  });

  /**
   * El servicio se cayó justo mientras imprimía. Nadie sabe si el papel salió,
   * y esa pregunta la contesta una persona mirando la impresora — no un
   * reintento automático.
   */
  it("un trabajo colgado en PRINTING no se reintenta solo", async () => {
    const job = await encolar();
    await db.printJob.update({ where: { id: job.id }, data: { status: "PRINTING" } });

    const t = transporteFalso();
    const r = await procesarImpresiones({ transporte: t });

    expect(r.revisados).toBe(0);
    expect(t.trabajos).toHaveLength(0);
    expect((await leer(job.id)).status).toBe("PRINTING");
  });
});

describe("reintentar a mano", () => {
  it("devuelve un fallido a la cola y le pone los intentos en cero", async () => {
    const job = await encolar();
    for (let i = 0; i < 3; i++) await procesarImpresiones({ transporte: transporteFalso(RECHAZA) });
    expect((await leer(job.id)).status).toBe("FAILED");

    await reintentarImpresion(job.id);
    const vuelto = await leer(job.id);
    expect(vuelto.status).toBe("PENDING");
    expect(vuelto.attempts).toBe(0);
    expect(vuelto.lastError).toBeNull();

    expect((await procesarImpresiones({ transporte: transporteFalso() })).impresos).toBe(1);
  });

  /** Es el único camino de vuelta que tiene un trabajo colgado. */
  it("también rescata uno que quedó en PRINTING", async () => {
    const job = await encolar();
    await db.printJob.update({ where: { id: job.id }, data: { status: "PRINTING" } });

    await reintentarImpresion(job.id);
    expect((await procesarImpresiones({ transporte: transporteFalso() })).impresos).toBe(1);
  });
});

describe("el resumen para el panel", () => {
  it("cuenta lo que espera, lo que se cayó y lo que quedó colgado", async () => {
    await encolar(); // se imprime
    await procesarImpresiones({ transporte: transporteFalso() });

    const falla = await encolar();
    for (let i = 0; i < 3; i++) await procesarImpresiones({ transporte: transporteFalso(RECHAZA) });
    expect((await leer(falla.id)).status).toBe("FAILED");

    const colgado = await encolar();
    await db.printJob.update({ where: { id: colgado.id }, data: { status: "PRINTING" } });
    await encolar(); // queda pendiente

    const r = await resumenDeImpresion();
    expect(r).toEqual({ pendientes: 1, fallidos: 1, colgados: 1, impresosHoy: 1 });
  });
});
