/**
 * El resumen de ventas de un rango (tareas 5.1 y 5.4).
 *
 * Vive fuera de la ruta porque lo piden dos: el reporte de ventas y el
 * dashboard, que muestra el mismo día en cuatro números. Calculados por
 * separado, el dashboard y el reporte terminarían discrepando por un
 * descuento prorrateado distinto, y no habría forma de decidir cuál mirar.
 *
 * SE SUMAN TODAS LAS FILAS, SIN FILTRAR POR ESTADO (ADR-002). Una devolución
 * es una venta de signo contrario: al sumarla, el total del día baja solo.
 * Filtrar por `status` contaría dos veces la plata que ya volvió.
 */
import { db } from "./db.js";
import { desglosarVenta, margenRealizadoPct, formatCLP } from "@ferrehouse/shared";

/**
 * `new Date("2026-07-30")` se parsea como medianoche UTC, que en Chile son
 * las 20:00 o 21:00 del día ANTERIOR: el reporte del día se comería las
 * últimas horas de venta y agregaría las de la tarde anterior. Se construye
 * la fecha local a mano.
 */
export function diaLocal(texto: string, finDelDia = false): Date {
  const [a, m, d] = texto.split("-").map(Number);
  return finDelDia ? new Date(a!, m! - 1, d!, 23, 59, 59, 999) : new Date(a!, m! - 1, d!, 0, 0, 0, 0);
}

export function hoyTexto(ahora = new Date()): string {
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
}

const MEDIOS: Record<string, string> = {
  CASH: "Efectivo",
  DEBIT: "Débito",
  CREDIT: "Crédito",
  TRANSFER: "Transferencia",
};

/** Lo que hay que leer de una venta para desglosarla. */
export const ventaParaReporte = {
  items: {
    select: {
      id: true,
      productId: true,
      qtyMilli: true,
      lineTotalGross: true,
      lineCostNet: true,
      // El factor de la unidad de ESTA línea. Sin él, sumar cantidades de
      // varias líneas del mismo producto suma rollos con metros.
      unit: { select: { factorMilli: true } },
    },
  },
  payments: { select: { method: true, amount: true } },
  user: { select: { id: true, name: true } },
} as const;

export async function resumenDeVentas(locationId: number, desde: Date, hasta: Date) {
  const ventas = await db.sale.findMany({
    where: { locationId, createdAt: { gte: desde, lte: hasta } },
    include: ventaParaReporte,
    orderBy: { id: "asc" },
  });

  let total = 0;
  let neto = 0;
  let iva = 0;
  let costo = 0;
  let descuentos = 0;
  let redondeos = 0;
  let devoluciones = 0;
  let anulaciones = 0;
  const porMedio = new Map<string, { monto: number; operaciones: number }>();
  const porVendedor = new Map<number, { nombre: string; monto: number; documentos: number; margen: number }>();

  for (const v of ventas) {
    const d = desglosarVenta({ ...v, items: v.items });
    total += d.totalGross;
    neto += d.neto;
    iva += d.iva;
    costo += d.costo;
    descuentos += v.discountAmount;
    redondeos += v.roundingAmount;
    /*
     * Una anulación NO es una devolución, y este proyecto separó las dos
     * palabras en todas partes (tabla de estados de STATE.md). Contarlas
     * juntas obliga a la pantalla a elegir una de las dos para nombrarlas, y
     * la que elija va a estar mal la mitad de las veces.
     */
    if (v.reversalKind === "RETURN") devoluciones++;
    else if (v.reversalKind === "VOID") anulaciones++;

    for (const p of v.payments) {
      const acc = porMedio.get(p.method) ?? { monto: 0, operaciones: 0 };
      acc.monto += p.amount;
      acc.operaciones++;
      porMedio.set(p.method, acc);
    }

    /**
     * Por el `userId` de la FILA, no el de la venta original. Una devolución
     * la registra quien la atendió, así que le resta a ese vendedor y no a
     * quien vendió. Es la consecuencia directa de sumar todas las filas, y la
     * pantalla lo dice en una línea para que nadie lo lea como un error.
     */
    const acc = porVendedor.get(v.userId) ?? { nombre: v.user.name, monto: 0, documentos: 0, margen: 0 };
    acc.monto += d.totalGross;
    acc.margen += d.margen;
    acc.documentos++;
    porVendedor.set(v.userId, acc);
  }

  return {
    documentos: ventas.length,
    devoluciones,
    anulaciones,
    reversas: devoluciones + anulaciones,
    total,
    totalTexto: formatCLP(total),
    neto,
    iva,
    costo,
    margen: neto - costo,
    margenPct: margenRealizadoPct(neto, neto - costo),
    descuentos,
    redondeos,
    porMedio: [...porMedio.entries()]
      .map(([metodo, v]) => ({ metodo, etiqueta: MEDIOS[metodo] ?? metodo, ...v, montoTexto: formatCLP(v.monto) }))
      .sort((a, b) => b.monto - a.monto),
    porVendedor: [...porVendedor.entries()]
      .map(([userId, v]) => ({ userId, ...v, montoTexto: formatCLP(v.monto) }))
      .sort((a, b) => b.monto - a.monto),
    folios: cuadrarFolios(ventas),
  };
}

// ============================================================
// 5.4 — Cuadratura de folios
// ============================================================

type VentaConFolio = { fiscalDocType: string | null; fiscalFolio: string | null };

export type CuadraturaSerie = {
  tipo: string;
  documentos: number;
  desde: number | null;
  hasta: number | null;
  huecos: number[];
  duplicados: Array<{ folio: number; veces: number }>;
  noNumericos: string[];
};

/**
 * Huecos y duplicados de folio, POR SERIE.
 *
 * Cada tipo de documento numera aparte: la boleta 120 y la factura 120
 * conviven sin problema. Mezclarlas en una sola secuencia inventa huecos que
 * no existen y esconde los que sí.
 *
 * Solo se buscan huecos DENTRO del mínimo y el máximo observados en el rango:
 * entre el último folio de ayer y el primero de hoy no hay hueco, hay noche.
 *
 * Se acusa en el reporte y no con una restricción de la base (POS-07): un
 * `unique` impediría corregir un folio mal tecleado, que es la causa más
 * común de un duplicado.
 */
export function cuadrarFolios(ventas: VentaConFolio[]): { series: CuadraturaSerie[]; sinFolio: number } {
  const porTipo = new Map<string, string[]>();
  let sinFolio = 0;

  for (const v of ventas) {
    const folio = v.fiscalFolio?.trim();
    const tipo = v.fiscalDocType?.trim();
    // "NONE" y el nulo son lo mismo: una venta sin documento tributario, que
    // es legítima (una venta interna, un traspaso). No es un hueco.
    if (!folio || !tipo || tipo === "NONE") {
      sinFolio++;
      continue;
    }
    porTipo.set(tipo, [...(porTipo.get(tipo) ?? []), folio]);
  }

  const series = [...porTipo.entries()].map(([tipo, folios]) => {
    const numericos: number[] = [];
    const noNumericos: string[] = [];
    for (const f of folios) {
      if (/^\d+$/.test(f)) numericos.push(Number(f));
      else noNumericos.push(f);
    }

    const veces = new Map<number, number>();
    for (const n of numericos) veces.set(n, (veces.get(n) ?? 0) + 1);

    const duplicados = [...veces.entries()]
      .filter(([, c]) => c > 1)
      .map(([folio, c]) => ({ folio, veces: c }))
      .sort((a, b) => a.folio - b.folio);

    const desde = numericos.length ? Math.min(...numericos) : null;
    const hasta = numericos.length ? Math.max(...numericos) : null;
    const huecos: number[] = [];
    if (desde !== null && hasta !== null) {
      for (let n = desde; n <= hasta; n++) if (!veces.has(n)) huecos.push(n);
    }

    return { tipo, documentos: folios.length, desde, hasta, huecos, duplicados, noNumericos };
  });

  return { series: series.sort((a, b) => a.tipo.localeCompare(b.tipo)), sinFolio };
}
