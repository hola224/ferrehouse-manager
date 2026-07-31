/**
 * Reporte de cierre de caja en ESC/POS (tarea 2.5).
 *
 * Sale por la cola `PrintJob`, igual que la etiqueta y que el ticket del
 * Sprint 3: nada escribe al puerto directamente.
 *
 * El papel dice **lo mismo** que la pantalla sobre una diferencia, porque los
 * dos llaman a `estadoArqueo` de `@ferrehouse/shared`. Si cada uno decidiera su
 * propio umbral o su propia palabra, el ticket y el monitor se contradirían
 * delante del dueño, y ahí ya no se sabe a cuál creerle.
 */
import { formatCLP, estadoArqueo, stripDiacritics, CASH_MOVEMENT_TEXT, type CashMovementType } from "@ferrehouse/shared";

const ESC = 0x1b;
const GS = 0x1d;
const ANCHO = 32; // caracteres por línea en papel de 58 mm

type SesionParaImprimir = {
  id: number;
  openedAt: Date;
  closedAt: Date | null;
  openingAmount: number;
  expectedAmount: number | null;
  countedAmount: number | null;
  differenceAmount: number | null;
  notes: string | null;
  station: { name: string };
  user: { name: string };
  movements: {
    type: string;
    amount: number;
    description: string | null;
    createdAt: Date;
    user: { name: string };
  }[];
};

/** La térmica usa una tabla tipo CP437: sin tildes, o imprime basura. */
const t = (s: string) => Buffer.from(stripDiacritics(s), "ascii");

/** Etiqueta a la izquierda, monto a la derecha, alineados a 32 columnas. */
function linea(etiqueta: string, monto: string): string {
  const izq = stripDiacritics(etiqueta);
  const relleno = Math.max(1, ANCHO - izq.length - monto.length);
  return izq + " ".repeat(relleno) + monto + "\n";
}

function fecha(d: Date): string {
  return new Intl.DateTimeFormat("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function reporteCierreEscPos(sesion: SesionParaImprimir, limiteAlerta: number): Buffer {
  const b: Buffer[] = [];
  const esperado = sesion.expectedAmount ?? 0;
  const contado = sesion.countedAmount ?? 0;
  const diferencia = sesion.differenceAmount ?? 0;
  const estado = estadoArqueo(diferencia, limiteAlerta);

  b.push(Buffer.from([ESC, 0x40])); // reiniciar
  b.push(Buffer.from([ESC, 0x61, 0x01])); // centrado
  b.push(Buffer.from([ESC, 0x21, 0x30])); // doble alto y ancho
  b.push(t("CIERRE DE CAJA\n"));
  b.push(Buffer.from([ESC, 0x21, 0x00]));
  b.push(t(`${sesion.station.name}\n`));
  b.push(Buffer.from([ESC, 0x61, 0x00])); // a la izquierda
  b.push(t("-".repeat(ANCHO) + "\n"));

  b.push(t(`Turno de: ${sesion.user.name}\n`));
  b.push(t(`Abierta:  ${fecha(sesion.openedAt)}\n`));
  b.push(t(`Cerrada:  ${sesion.closedAt ? fecha(sesion.closedAt) : "-"}\n`));
  b.push(t("-".repeat(ANCHO) + "\n"));

  // --- Movimientos, agrupados por tipo ---
  const porTipo = new Map<string, { n: number; total: number }>();
  for (const m of sesion.movements) {
    if (m.type === "CLOSING") continue; // el ajuste del arqueo se muestra aparte
    const a = porTipo.get(m.type) ?? { n: 0, total: 0 };
    porTipo.set(m.type, { n: a.n + 1, total: a.total + m.amount });
  }
  for (const [tipo, { n, total }] of porTipo) {
    const nombre = CASH_MOVEMENT_TEXT[tipo as CashMovementType] ?? tipo;
    b.push(t(linea(`${nombre} (${n})`, formatCLP(total))));
  }

  b.push(t("-".repeat(ANCHO) + "\n"));
  b.push(t(linea("Esperado", formatCLP(esperado))));
  b.push(t(linea("Contado", formatCLP(contado))));

  // La diferencia va en grande: es el número por el que se imprime esto.
  b.push(Buffer.from([ESC, 0x21, 0x10])); // doble alto
  b.push(t(linea("DIFERENCIA", formatCLP(diferencia))));
  b.push(Buffer.from([ESC, 0x21, 0x00]));

  // COLOR NO HAY en papel térmico: la palabra es la única señal. Por eso
  // `estadoArqueo` devuelve siempre las dos cosas.
  b.push(Buffer.from([ESC, 0x61, 0x01]));
  b.push(t(`** ${estado.palabra.toUpperCase()} **\n`));
  b.push(Buffer.from([ESC, 0x61, 0x00]));

  // --- Detalle de retiros e ingresos, que es lo que se audita ---
  const conMotivo = sesion.movements.filter((m) => m.type === "WITHDRAWAL" || m.type === "DEPOSIT");
  if (conMotivo.length > 0) {
    b.push(t("-".repeat(ANCHO) + "\n"));
    b.push(t("Retiros e ingresos:\n"));
    for (const m of conMotivo) {
      b.push(t(linea(` ${m.description ?? "sin motivo"}`.slice(0, 22), formatCLP(m.amount))));
      b.push(t(`   ${stripDiacritics(m.user.name)}\n`));
    }
  }

  if (sesion.notes) {
    b.push(t("-".repeat(ANCHO) + "\n"));
    b.push(t(`Nota: ${sesion.notes}\n`));
  }

  b.push(t("-".repeat(ANCHO) + "\n"));
  b.push(Buffer.from([ESC, 0x61, 0x01]));
  b.push(t("Firma: ______________________\n\n"));
  b.push(t(`sesion #${sesion.id}\n`));
  b.push(t("\n\n\n"));
  b.push(Buffer.from([GS, 0x56, 0x00])); // cortar papel

  return Buffer.concat(b);
}
