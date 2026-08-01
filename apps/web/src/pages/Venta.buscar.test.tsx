/**
 * La venta: buscar, agregar y la lista de líneas.
 *
 * Es la pantalla donde se pasan ocho horas al día con un cliente al frente, y
 * la única donde un error de comportamiento se convierte en plata mal cobrada.
 * Casi todo lo que se prueba acá está escrito en `Venta.tsx` como algo que YA
 * FALLÓ una vez —tomar el primer resultado a ciegas, borrar una línea al
 * corregir una letra, la cantidad inalcanzable sin mouse—, y hasta ahora nada
 * impedía que volviera.
 *
 * El cobro va en su propio archivo: acá no se paga nada.
 */
import { describe, it, expect } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Venta } from "./Venta";
import { montarApi, type ApiFalsa, type Llamada } from "@/test/api-falsa";

const UNIDAD = { id: 1, symbol: "un", factorMilli: 1000, groupId: 1 };

const TORNILLO = { id: 10, sku: "FH-00010", name: "Tornillo 3x30", priceGross: 190, saleUnit: UNIDAD };
const DESTORNILLADOR = { id: 11, sku: "FH-00011", name: "Juego de destornilladores", priceGross: 12990, saleUnit: UNIDAD };
const TORNIQUETE = { id: 12, sku: "FH-00012", name: "Torniquete", priceGross: 3500, saleUnit: UNIDAD };

type Busqueda = { exacto: boolean; productos: typeof TORNILLO[] };

type Opciones = {
  cajaAbierta?: boolean;
  /** Qué contesta la búsqueda, según lo que se buscó. */
  buscar?: (q: string) => Busqueda;
};

function montar(o: Opciones = {}): { api: ApiFalsa; user: ReturnType<typeof userEvent.setup> } {
  const api = montarApi({
    "GET /api/pos/config": { cuerpo: { taxRatePercent: 19, multiploRedondeo: 10, topeDescuento: 5 } },
    "GET /api/cash/current": { cuerpo: { abierta: o.cajaAbierta ?? true } },
    "GET /api/catalog/units": { cuerpo: { grupos: [{ id: 1, allowsFraction: false }] } },
    "GET /api/suspended": { cuerpo: { esperas: [] } },
    "GET /api/products/search*": (l: Llamada) => {
      const q = decodeURIComponent(new URL(l.ruta, "http://x").searchParams.get("q") ?? "");
      return { cuerpo: o.buscar ? o.buscar(q) : { exacto: false, productos: [] } };
    },
  });
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <Venta />
    </MemoryRouter>,
  );
  return { api, user };
}

const cajaEscaneo = () => screen.getByRole("combobox");
const filas = () => within(screen.getByRole("table")).getAllByRole("row").slice(1); // sin el encabezado
const totalAPagar = () => screen.getByText("Total a pagar").nextElementSibling?.textContent;

/** Un catálogo chico: «tor» calza con tres, «FH-00010» con uno exacto. */
const CATALOGO = (q: string): Busqueda => {
  if (q === "FH-00010" || q === "7801234567890") return { exacto: true, productos: [TORNILLO] };
  if (q.toLowerCase().startsWith("tor")) return { exacto: false, productos: [TORNILLO, TORNIQUETE, DESTORNILLADOR] };
  if (q.toLowerCase().startsWith("juego")) return { exacto: false, productos: [DESTORNILLADOR] };
  return { exacto: false, productos: [] };
};

describe("la caja cerrada", () => {
  /**
   * Se avisa desde el principio y no al cobrar: descubrirlo con el cliente
   * esperando y la venta ya armada es peor que no poder empezarla.
   */
  it("no deja vender y manda a abrirla", async () => {
    montar({ cajaAbierta: false });
    expect(await screen.findByText(/La caja está cerrada/)).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ir a la caja/ })).toHaveAttribute("href", "/caja");
  });
});

describe("escanear", () => {
  it("un código exacto agrega la línea sin preguntar nada", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await user.type(cajaEscaneo(), "7801234567890{Enter}");

    await waitFor(() => expect(filas()).toHaveLength(1));
    expect(within(filas()[0]!).getByText("Tornillo 3x30")).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("deja la caja vacía y el foco de vuelta en ella", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await user.type(cajaEscaneo(), "FH-00010{Enter}");

    await waitFor(() => expect(filas()).toHaveLength(1));
    expect(cajaEscaneo()).toHaveValue("");
    expect(cajaEscaneo()).toHaveFocus();
  });

  /** Es lo que hace un vendedor al pasar tres veces el mismo perno. */
  it("el mismo producto dos veces suma a la misma línea, no crea otra", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await user.type(cajaEscaneo(), "FH-00010{Enter}");
    await waitFor(() => expect(filas()).toHaveLength(1));
    await user.type(cajaEscaneo(), "FH-00010{Enter}");

    await waitFor(() => expect(filas()[0]!).toHaveTextContent("2 un"));
    expect(filas()).toHaveLength(1);
    expect(totalAPagar()).toBe("$380");
  });

  it("lo que no calza con nada lo dice, con lo que se buscó", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await user.type(cajaEscaneo(), "no-existe-esto{Enter}");

    expect(await screen.findByText(/Nada calza con «no-existe-esto»/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("escribir el nombre", () => {
  /**
   * EL BUG QUE ESTE TEST EXISTE PARA QUE NO VUELVA. Antes, Enter tomaba
   * `productos[0]` pasara lo que pasara: escribir «tor» agregaba «Juego de
   * destornilladores» —primero por orden alfabético— sin decir que había otras
   * siete opciones. En una caja, eso es cobrar un destornillador cuando
   * pidieron un tornillo.
   */
  it("si calza más de uno, Enter NO agrega ninguno: los muestra", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await user.type(cajaEscaneo(), "tor{Enter}");

    const lista = await screen.findByRole("listbox");
    expect(within(lista).getAllByRole("option")).toHaveLength(3);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("si calza uno solo, ese se agrega", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await user.type(cajaEscaneo(), "juego{Enter}");

    await waitFor(() => expect(filas()).toHaveLength(1));
    expect(within(filas()[0]!).getByText("Juego de destornilladores")).toBeInTheDocument();
  });

  it("con ↑↓ se elige de la lista y Enter agrega ese", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await user.type(cajaEscaneo(), "tor{Enter}");
    await screen.findByRole("listbox");

    // Enter dejó marcada la primera; una flecha abajo pasa a la segunda.
    await user.keyboard("{ArrowDown}{Enter}");

    await waitFor(() => expect(filas()).toHaveLength(1));
    expect(within(filas()[0]!).getByText("Torniquete")).toBeInTheDocument();
  });

  it("hacer clic en una sugerencia también la agrega", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await user.type(cajaEscaneo(), "tor{Enter}");
    const lista = await screen.findByRole("listbox");

    await user.click(within(lista).getByRole("option", { name: /Torniquete/ }));
    await waitFor(() => expect(filas()).toHaveLength(1));
  });

  it("Esc cierra la lista sin agregar nada", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await user.type(cajaEscaneo(), "tor{Enter}");
    await screen.findByRole("listbox");

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("las sugerencias mientras se escribe", () => {
  /** Con una o dos letras calza medio catálogo y la lista es ruido. */
  it("no aparecen antes de la tercera letra", async () => {
    const { api, user } = montar({ buscar: CATALOGO });
    await user.type(cajaEscaneo(), "to");

    await new Promise((r) => setTimeout(r, 300)); // más que el retardo de 160 ms
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(api.llamadas.some((l) => l.ruta.includes("/products/search"))).toBe(false);
  });

  it("desde la tercera aparecen solas, sin apretar Enter", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await user.type(cajaEscaneo(), "tor");

    const lista = await screen.findByRole("listbox");
    expect(within(lista).getAllByRole("option")).toHaveLength(3);
  });

  /** Con un código exacto no hay nada que elegir: una lista de uno estorba. */
  it("un resultado exacto no abre la lista", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await user.type(cajaEscaneo(), "FH-00010");

    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  /**
   * Ninguna marcada al aparecer. Marcar la primera automáticamente sería el
   * mismo error de antes con otro disfraz: Enter agregaría la de arriba.
   */
  it("aparecen sin ninguna marcada", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await user.type(cajaEscaneo(), "tor");
    const lista = await screen.findByRole("listbox");

    for (const o of within(lista).getAllByRole("option")) {
      expect(o).toHaveAttribute("aria-selected", "false");
    }
  });
});

describe("la lista de líneas con el teclado", () => {
  async function conDosLineas() {
    const r = montar({ buscar: CATALOGO });
    await r.user.type(cajaEscaneo(), "FH-00010{Enter}");
    await waitFor(() => expect(filas()).toHaveLength(1));
    await r.user.type(cajaEscaneo(), "juego{Enter}");
    await waitFor(() => expect(filas()).toHaveLength(2));
    return r;
  }

  /**
   * El foco vuelve siempre a la caja de escaneo, así que «caja vacía» es el
   * estado en el que el vendedor pasa el turno. Sin esto, «↑↓ moverse» y
   * «Supr quitar línea» estaban escritas en la barra de ayuda y solo
   * funcionaban después de tocar la línea con el mouse.
   */
  it("con la caja vacía, Supr quita la línea elegida", async () => {
    const { user } = await conDosLineas();
    await user.keyboard("{Delete}");

    await waitFor(() => expect(filas()).toHaveLength(1));
    expect(screen.getByText("Tornillo 3x30")).toBeInTheDocument();
  });

  it("con la caja vacía, ↑↓ mueve la selección antes de borrar", async () => {
    const { user } = await conDosLineas();
    await user.keyboard("{ArrowUp}"); // de la segunda a la primera
    await user.keyboard("{Delete}");

    await waitFor(() => expect(filas()).toHaveLength(1));
    expect(screen.getByText("Juego de destornilladores")).toBeInTheDocument();
  });

  /**
   * EL OTRO BUG CARO. Con texto escrito, Supr es de quien está escribiendo:
   * borrar un carácter mal tecleado en el buscador NO puede borrar una línea
   * de la venta. Un carácter invisible tampoco — por eso el componente mira
   * `texto === ""` y no `.trim()`.
   */
  it("con algo escrito en la caja, Supr NO borra ninguna línea", async () => {
    const { user } = await conDosLineas();
    await user.type(cajaEscaneo(), "torni");
    await user.keyboard("{Delete}");

    expect(filas()).toHaveLength(2);
  });

  it("ni siquiera con un solo espacio escrito", async () => {
    const { user } = await conDosLineas();
    await user.type(cajaEscaneo(), " ");
    await user.keyboard("{Delete}");

    expect(filas()).toHaveLength(2);
  });
});

describe("las teclas de función", () => {
  /**
   * Se prueba lo que HACEN y no cómo se pintan. La versión que miraba la clase
   * `opacity-40` de la barra de ayuda comprobaba el color de una etiqueta; lo
   * que importa es que apretar la tecla no abra un panel imposible — y que la
   * etiqueta apagada no esté mintiendo al revés, prometiendo poco.
   */
  it("con la venta vacía, F2 y F4 no abren nada", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await screen.findByText(/Escanea el primer producto/);

    await user.keyboard("{F2}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.keyboard("{F4}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("con una línea, F2 abre el cobro", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await user.type(cajaEscaneo(), "FH-00010{Enter}");
    await waitFor(() => expect(filas()).toHaveLength(1));

    await user.keyboard("{F2}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  /** F8 —ver las esperas— sí puede actuar sin líneas: es cómo se recupera una. */
  it("F8 abre las esperas aunque la venta esté vacía", async () => {
    const { user } = montar({ buscar: CATALOGO });
    await screen.findByText(/Escanea el primer producto/);

    await user.keyboard("{F8}");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  /**
   * Las teclas de la barra salen de `@ferrehouse/shared`, no de una lista
   * escrita en la pantalla: tenerlas en dos lados es la forma garantizada de
   * anunciar una tecla que ya no hace nada.
   */
  it("la barra de ayuda anuncia las teclas que existen", async () => {
    montar({ buscar: CATALOGO });
    await screen.findByText(/Escanea el primer producto/);

    const ayuda = screen.getByText("↑↓").closest("div")!;
    for (const t of ["F2", "F4", "F6", "F8", "↑↓", "Supr"]) {
      expect(within(ayuda).getByText(t), t).toBeInTheDocument();
    }
  });
});
