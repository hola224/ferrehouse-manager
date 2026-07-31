/**
 * Ticket de venta en ESC/POS, con el pulso del cajón (tarea 3.8, POS-06).
 *
 * **El cajón se abre en el MISMO trabajo de impresión que el ticket.** No es
 * una comodidad: el cajón cuelga físicamente de la impresora, y mandarlo en un
 * trabajo aparte significa que si la cola se atasca entre uno y otro, el
 * vendedor tiene el ticket en la mano y el cajón cerrado con el cliente
 * esperando el vuelto. Un solo trabajo, o ninguno.
 *
 * El pulso va **al final**, después del corte: así el cajón se abre cuando el
 * papel ya salió, y no mientras la impresora todavía está escribiendo.
 */
import {
  formatCLP,
  formatQty,
  formatHora,
  stripDiacritics,
  PAYMENT_METHOD_TEXT,
  type PaymentMethod,
} from "@ferrehouse/shared";

const ESC = 0x1b;
const GS = 0x1d;
const ANCHO = 32; // caracteres por línea en papel de 58 mm

/** La térmica usa una tabla tipo CP437: sin tildes, o imprime basura. */
const t = (s: string) => Buffer.from(stripDiacritics(s), "ascii");

function linea(izq: string, der: string): string {
  const a = stripDiacritics(izq);
  const relleno = Math.max(1, ANCHO - a.length - der.length);
  return a + " ".repeat(relleno) + der + "\n";
}

export type VentaParaTicket = {
  id: number;
  createdAt: Date;
  taxRatePercent: number;
  subtotalGross: number;
  discountAmount: number;
  roundingAmount: number;
  totalGross: number;
  fiscalDocType: string | null;
  fiscalFolio: string | null;
  user: { name: string };
  location: { name: string };
  items: {
    descriptionSnapshot: string;
    qtyMilli: number;
    unitPriceGross: number;
    discountAmount: number;
    lineTotalGross: number;
    unit: { symbol: string; group: { allowsFraction: boolean } };
  }[];
  payments: {
    method: string;
    amount: number;
    receivedAmount: number | null;
    changeAmount: number | null;
    reference: string | null;
  }[];
};

export function ticketEscPos(
  venta: VentaParaTicket,
  opciones: { tienda: string; esReimpresion?: boolean; abrirCajon?: boolean },
): Buffer {
  const b: Buffer[] = [];
  const neto = Math.round(venta.totalGross / (1 + venta.taxRatePercent / 100));
  const iva = venta.totalGross - neto;

  b.push(Buffer.from([ESC, 0x40])); // reiniciar
  b.push(Buffer.from([ESC, 0x61, 0x01])); // centrado
  b.push(Buffer.from([ESC, 0x21, 0x20])); // doble ancho
  b.push(t(opciones.tienda + "\n"));
  b.push(Buffer.from([ESC, 0x21, 0x00]));

  if (opciones.esReimpresion) {
    // POS-18: la copia sale marcada, y en grande. Un ticket reimpreso que se
    // ve igual al original sirve para cobrar dos veces.
    b.push(Buffer.from([ESC, 0x21, 0x10]));
    b.push(t("*** COPIA ***\n"));
    b.push(Buffer.from([ESC, 0x21, 0x00]));
  }

  b.push(Buffer.from([ESC, 0x61, 0x00])); // a la izquierda
  b.push(t("-".repeat(ANCHO) + "\n"));
  b.push(t(`Venta #${venta.id}\n`));
  b.push(
    t(
      `${new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(venta.createdAt)} ${formatHora(venta.createdAt)}\n`,
    ),
  );
  b.push(t(`Atendio: ${venta.user.name}\n`));
  if (venta.fiscalFolio) {
    b.push(t(`${venta.fiscalDocType ?? "DOC"} ${venta.fiscalFolio}\n`));
  }
  b.push(t("-".repeat(ANCHO) + "\n"));

  // --- Líneas ---
  for (const it of venta.items) {
    b.push(t(stripDiacritics(it.descriptionSnapshot).slice(0, ANCHO) + "\n"));
    const cantidad = formatQty(it.qtyMilli, it.unit.group.allowsFraction);
    b.push(t(linea(`  ${cantidad} ${it.unit.symbol} x ${formatCLP(it.unitPriceGross)}`, formatCLP(it.lineTotalGross))));
    if (it.discountAmount > 0) {
      b.push(t(linea("  descuento", formatCLP(-it.discountAmount))));
    }
  }

  b.push(t("-".repeat(ANCHO) + "\n"));
  if (venta.discountAmount > 0) {
    b.push(t(linea("Subtotal", formatCLP(venta.subtotalGross))));
    b.push(t(linea("Descuento", formatCLP(-venta.discountAmount))));
  }
  if (venta.roundingAmount !== 0) {
    // Se imprime siempre que exista: un total que no calza con la suma de las
    // líneas y no explica por qué es una discusión en el mesón.
    b.push(t(linea("Redondeo efectivo", formatCLP(venta.roundingAmount))));
  }

  // --- El total, en grande ---
  b.push(Buffer.from([ESC, 0x21, 0x30]));
  b.push(t(linea("TOTAL", formatCLP(venta.totalGross)).replace(/ {2,}/, "  ")));
  b.push(Buffer.from([ESC, 0x21, 0x00]));

  b.push(t(linea(`Neto`, formatCLP(neto))));
  b.push(t(linea(`IVA ${venta.taxRatePercent}%`, formatCLP(iva))));
  b.push(t("-".repeat(ANCHO) + "\n"));

  // --- Pagos, y el vuelto en grande: es el número que más errores evita ---
  for (const p of venta.payments) {
    const nombre = PAYMENT_METHOD_TEXT[p.method as PaymentMethod] ?? p.method;
    b.push(t(linea(nombre + (p.reference ? ` ${p.reference}` : ""), formatCLP(p.amount))));
    if (p.method === "CASH" && p.receivedAmount !== null) {
      b.push(t(linea("  recibido", formatCLP(p.receivedAmount))));
    }
  }
  const vuelto = venta.payments.reduce((s, p) => s + (p.changeAmount ?? 0), 0);
  if (vuelto > 0) {
    b.push(Buffer.from([ESC, 0x21, 0x10])); // doble alto
    b.push(t(linea("VUELTO", formatCLP(vuelto))));
    b.push(Buffer.from([ESC, 0x21, 0x00]));
  }

  b.push(t("\n"));
  b.push(Buffer.from([ESC, 0x61, 0x01]));
  b.push(t("Gracias por su compra\n"));
  b.push(t("\n\n\n"));
  b.push(Buffer.from([GS, 0x56, 0x00])); // cortar papel

  /**
   * `ESC p 0 25 250`: pulso al conector del cajón. VA DESPUÉS DEL CORTE, para
   * que el papel ya haya salido cuando el cajón se abre.
   *
   * En una reimpresión NO se manda: abrir el cajón sin una venta detrás es
   * exactamente lo que un arqueo no puede explicar.
   */
  if (opciones.abrirCajon) {
    b.push(Buffer.from([ESC, 0x70, 0x00, 25, 250]));
  }

  return Buffer.concat(b);
}
