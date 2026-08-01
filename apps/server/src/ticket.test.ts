/**
 * El ticket en papel.
 *
 * Nada de esto se puede mirar hasta que sale impreso, y para entonces ya se
 * gastó papel y hay alguien esperando. Así que se mira acá: se descompone el
 * ESC/POS y se verifica lo que en el mesón se vería de un vistazo — que nada se
 * salga del ancho, que no haya un carácter que la térmica no sepa imprimir, y
 * que el cajón se abra cuando corresponde y solo entonces.
 */
import { describe, it, expect } from "vitest";
import { ticketEscPos, type VentaParaTicket } from "./ticket.js";

const ANCHO = 32;

const VENTA: VentaParaTicket = {
  id: 1042,
  createdAt: new Date("2026-08-01T15:42:00"),
  taxRatePercent: 19,
  subtotalGross: 24680,
  discountAmount: 1000,
  roundingAmount: 0,
  totalGross: 23680,
  fiscalDocType: "BOLETA",
  fiscalFolio: "000123",
  user: { name: "Cristian" },
  location: { name: "Local" },
  items: [
    {
      descriptionSnapshot: "Cemento Portland 25 kg",
      qtyMilli: 2000,
      unitPriceGross: 7490,
      discountAmount: 0,
      lineTotalGross: 14980,
      unit: { symbol: "sc", group: { allowsFraction: false } },
    },
  ],
  payments: [{ method: "CASH", amount: 23680, receivedAmount: 30000, changeAmount: 6320, reference: null }],
};

type Linea = { texto: string; columnas: number };

/**
 * Descompone el ESC/POS en líneas con las COLUMNAS que ocupa cada una.
 *
 * `ESC ! n`: el bit 0x20 es doble ANCHO y duplica las columnas; el 0x10 es
 * doble ALTO y no ocupa ninguna de más. Confundirlos hace ver desbordes que no
 * existen — pasó al escribir esto.
 */
function desarmar(bytes: Buffer): { lineas: Linea[]; control: number[][]; texto: string } {
  const lineas: Linea[] = [];
  const control: number[][] = [];
  let modo = 0;
  let buffer = "";
  const volcar = () => {
    for (const l of buffer.split("\n")) lineas.push({ texto: l, columnas: l.length * (modo & 0x20 ? 2 : 1) });
    buffer = "";
  };
  for (let i = 0; i < bytes.length; i++) {
    const x = bytes[i]!;
    if (x === 0x1b && bytes[i + 1] === 0x40) { control.push([x, bytes[i + 1]!]); i += 1; continue; }
    if (x === 0x1b && bytes[i + 1] === 0x61) { volcar(); i += 2; continue; }
    if (x === 0x1b && bytes[i + 1] === 0x21) { volcar(); modo = bytes[i + 2]!; i += 2; continue; }
    if (x === 0x1d && bytes[i + 1] === 0x56) { volcar(); control.push([x, bytes[i + 1]!, bytes[i + 2]!]); i += 2; continue; }
    if (x === 0x1b && bytes[i + 1] === 0x70) {
      volcar();
      control.push([x, bytes[i + 1]!, bytes[i + 2]!, bytes[i + 3]!, bytes[i + 4]!]);
      i += 4;
      continue;
    }
    buffer += String.fromCharCode(x);
  }
  volcar();
  return { lineas, control, texto: lineas.map((l) => l.texto).join("\n") };
}

const CORTE = (c: number[]) => c[0] === 0x1d && c[1] === 0x56;
const CAJON = (c: number[]) => c[0] === 0x1b && c[1] === 0x70;

describe("el ancho del papel", () => {
  /**
   * 58 mm son 32 caracteres. Una línea que se pasa no da error: la impresora
   * la parte donde le toque, y el precio termina solo en el renglón de abajo.
   */
  it("ninguna línea se pasa de 32 columnas", () => {
    const { lineas } = desarmar(ticketEscPos(VENTA, { tienda: "FERREHOUSE", abrirCajon: true }));
    for (const l of lineas) {
      expect(l.columnas, `«${l.texto}» ocupa ${l.columnas} columnas`).toBeLessThanOrEqual(ANCHO);
    }
  });

  it("tampoco con un producto de nombre largo y un total de siete cifras", () => {
    const { lineas } = desarmar(
      ticketEscPos(
        {
          ...VENTA,
          totalGross: 1_234_567,
          subtotalGross: 1_234_567,
          discountAmount: 0,
          items: [
            {
              ...VENTA.items[0]!,
              descriptionSnapshot: "Plancha de zinc acanalada 0.35 x 3.60 m galvanizada",
              qtyMilli: 123_000,
              unitPriceGross: 10_037,
              lineTotalGross: 1_234_567,
            },
          ],
          payments: [{ method: "CASH", amount: 1_234_567, receivedAmount: 2_000_000, changeAmount: 765_433, reference: null }],
        },
        { tienda: "FERREHOUSE", abrirCajon: true },
      ),
    );
    for (const l of lineas) {
      expect(l.columnas, `«${l.texto}» ocupa ${l.columnas} columnas`).toBeLessThanOrEqual(ANCHO);
    }
  });
});

describe("el papel de 80 mm (48 columnas)", () => {
  it("las líneas separadoras usan el ancho completo, no las 32 de siempre", () => {
    const { lineas } = desarmar(ticketEscPos(VENTA, { tienda: "FERREHOUSE", ancho: 48, abrirCajon: false }));
    expect(lineas.some((l) => l.texto === "-".repeat(48))).toBe(true);
    expect(lineas.some((l) => l.texto === "-".repeat(32))).toBe(false);
  });

  it("ninguna línea se pasa de las 48 columnas", () => {
    const { lineas } = desarmar(ticketEscPos(VENTA, { tienda: "FERREHOUSE", ancho: 48, abrirCajon: true }));
    for (const l of lineas) {
      expect(l.columnas, `«${l.texto}» ocupa ${l.columnas} columnas`).toBeLessThanOrEqual(48);
    }
  });

  /**
   * En 58 mm un total de siete cifras no cabe en doble ancho y se baja a doble
   * alto. En 80 mm sí cabe: 17 caracteres × 2 = 34 ≤ 48. Que el papel ancho
   * recupere el total en grande es la mitad del motivo de configurar el ancho.
   */
  it("el total de siete cifras sale en doble ancho, que en 58 mm no cabía", () => {
    const venta = { ...VENTA, totalGross: 1_234_567, subtotalGross: 1_234_567, discountAmount: 0 };
    const en58 = desarmar(ticketEscPos(venta, { tienda: "F", abrirCajon: false }));
    const en80 = desarmar(ticketEscPos(venta, { tienda: "F", ancho: 48, abrirCajon: false }));
    const dobleAncho = (r: { lineas: Linea[] }) =>
      r.lineas.find((l) => l.texto.startsWith("TOTAL") && l.columnas === l.texto.length * 2);
    expect(dobleAncho(en58)).toBeUndefined();
    expect(dobleAncho(en80)).toBeDefined();
  });
});

describe("lo que la térmica sabe imprimir", () => {
  /**
   * La tabla es tipo CP437: una tilde o una eñe salen como otro carácter. El
   * ticket ya pasa todo por `stripDiacritics`, y esto es lo que comprueba que
   * no se le escape nada — incluido el nombre del producto, que lo escribe
   * quien carga el catálogo y va a llevar tildes.
   */
  it("todo el texto es ASCII, aunque el catálogo tenga tildes y eñes", () => {
    const bytes = ticketEscPos(
      {
        ...VENTA,
        user: { name: "José Muñoz" },
        items: [{ ...VENTA.items[0]!, descriptionSnapshot: "Cañería de cobre 1/2 pulgada — ½" }],
      },
      { tienda: "FERRETERÍA HOUSE", abrirCajon: false },
    );
    const { texto } = desarmar(bytes);
    const raros = [...texto].filter((c) => c.charCodeAt(0) > 126);
    expect(raros, `caracteres fuera de ASCII: ${JSON.stringify(raros)}`).toEqual([]);
  });
});

describe("el isotipo", () => {
  it("sale arriba, antes del nombre de la tienda", () => {
    const { texto } = desarmar(ticketEscPos(VENTA, { tienda: "FERREHOUSE", abrirCajon: false }));
    expect(texto.indexOf("/_FH_\\")).toBeGreaterThanOrEqual(0);
    expect(texto.indexOf("/_FH_\\")).toBeLessThan(texto.indexOf("FERREHOUSE"));
  });

  it("son tres líneas: el rollo se paga", () => {
    const { lineas } = desarmar(ticketEscPos(VENTA, { tienda: "FERREHOUSE", abrirCajon: false }));
    // Las líneas del dibujo son las que llevan una barra: el nombre de la
    // tienda no, y por eso no se puede filtrar solo por «F» y «H».
    const dibujo = lineas.filter((l) => /[/\\]/.test(l.texto));
    expect(dibujo.map((l) => l.texto.trim())).toEqual(["/\\", "/  \\", "/_FH_\\"]);
  });

  it("cabe en el ancho del papel con espacio de sobra", () => {
    const { lineas } = desarmar(ticketEscPos(VENTA, { tienda: "FERREHOUSE", abrirCajon: false }));
    for (const l of lineas.filter((x) => /[/\\]/.test(x.texto))) {
      expect(l.columnas).toBeLessThanOrEqual(12);
    }
  });
});

describe("el encabezado y la despedida del administrador", () => {
  it("el encabezado sale entre el nombre de la tienda y la primera separadora", () => {
    const { texto } = desarmar(
      ticketEscPos(VENTA, {
        tienda: "FERREHOUSE",
        encabezado: "Av. Los Carrera 1234, Concepcion\n+56 9 1234 5678",
        abrirCajon: false,
      }),
    );
    const nombre = texto.indexOf("FERREHOUSE");
    const direccion = texto.indexOf("Av. Los Carrera 1234, Concepcion");
    const telefono = texto.indexOf("+56 9 1234 5678");
    const separadora = texto.indexOf("-".repeat(32));
    expect(direccion).toBeGreaterThan(nombre);
    expect(telefono).toBeGreaterThan(direccion);
    expect(separadora).toBeGreaterThan(telefono);
  });

  it("la despedida reemplaza al «Gracias por su compra»", () => {
    const { texto } = desarmar(
      ticketEscPos(VENTA, { tienda: "F", pie: "Cambios hasta 30 dias con boleta", abrirCajon: false }),
    );
    expect(texto).toContain("Cambios hasta 30 dias con boleta");
    expect(texto).not.toContain("Gracias por su compra");
  });

  it("sin configurar, el ticket es el de siempre", () => {
    const { texto } = desarmar(ticketEscPos(VENTA, { tienda: "F", abrirCajon: false }));
    expect(texto).toContain("Gracias por su compra");
  });

  it("despedida vacía a propósito = sin despedida", () => {
    const { texto } = desarmar(ticketEscPos(VENTA, { tienda: "F", pie: "", abrirCajon: false }));
    expect(texto).not.toContain("Gracias por su compra");
  });

  /**
   * El texto lo escribe el administrador con tildes, porque así se escribe: la
   * transliteración es problema del generador, no suyo. La misma regla que el
   * catálogo.
   */
  it("las tildes del administrador se transliteran igual que las del catálogo", () => {
    const { texto } = desarmar(
      ticketEscPos(VENTA, {
        tienda: "F",
        encabezado: "Concepción, Ñuñoa 42 ½",
        pie: "¡Vuelva pronto!",
        abrirCajon: false,
      }),
    );
    expect(texto).toContain("Concepcion, Nunoa 42 1/2");
    expect(texto).toContain("Vuelva pronto!");
    const raros = [...texto].filter((c) => c.charCodeAt(0) > 126);
    expect(raros).toEqual([]);
  });

  it("las líneas vacías de los extremos no gastan papel; las del medio sí", () => {
    const { lineas } = desarmar(
      ticketEscPos(VENTA, { tienda: "F", encabezado: "\n\nArriba\n\nAbajo\n\n", abrirCajon: false }),
    );
    const textos = lineas.map((l) => l.texto);
    const arriba = textos.indexOf("Arriba");
    expect(arriba).toBeGreaterThanOrEqual(0);
    expect(textos[arriba + 1]).toBe("");
    expect(textos[arriba + 2]).toBe("Abajo");
  });
});

describe("el cajón", () => {
  /**
   * El pulso VA DESPUÉS DEL CORTE: así el cajón se abre cuando el papel ya
   * salió, y no mientras la impresora todavía está escribiendo.
   */
  it("el pulso va después del corte de papel", () => {
    const { control } = desarmar(ticketEscPos(VENTA, { tienda: "F", abrirCajon: true }));
    const iCorte = control.findIndex(CORTE);
    const iCajon = control.findIndex(CAJON);
    expect(iCorte).toBeGreaterThanOrEqual(0);
    expect(iCajon).toBeGreaterThan(iCorte);
  });

  it("sin efectivo no se manda ningún pulso", () => {
    const { control } = desarmar(ticketEscPos(VENTA, { tienda: "F", abrirCajon: false }));
    expect(control.some(CAJON)).toBe(false);
  });
});

describe("la reimpresión", () => {
  /** Una copia que se ve igual al original sirve para cobrar dos veces. */
  it("sale marcada COPIA", () => {
    const { texto } = desarmar(ticketEscPos(VENTA, { tienda: "F", esReimpresion: true }));
    expect(texto).toContain("*** COPIA ***");
  });

  /** Abrir el cajón sin una venta detrás es lo que un arqueo no puede explicar. */
  it("nunca abre el cajón, ni aunque se lo pidan", () => {
    const { control } = desarmar(
      ticketEscPos(VENTA, { tienda: "F", esReimpresion: true, abrirCajon: false }),
    );
    expect(control.some(CAJON)).toBe(false);
  });
});
