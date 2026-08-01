/**
 * La venta: el cobro, el vuelto y el pago mixto.
 *
 * Acá se decide cuánta plata cambia de manos. Lo que más se cuida en este
 * archivo son dos cosas que la aritmética de cabeza no resuelve y que la
 * pantalla tiene que resolver bien todas las veces:
 *
 *   - **Los dos totales no son el mismo número.** En efectivo se cobra
 *     redondeado al múltiplo de la caja, porque no existe la moneda de $1; con
 *     tarjeta se cobra al peso exacto, porque no hay vuelto que dar.
 *   - **El vuelto se ve MIENTRAS se teclea**, no después de cobrar. Verlo
 *     después no evita ningún error.
 *
 * El precio de $199 con redondeo a $10 está elegido a propósito: hace que los
 * dos totales difieran ($200 y $199). Con un precio redondo, un test que
 * confundiera ambos pasaría igual.
 */
import { describe, it, expect } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Venta } from "./Venta";
import { montarApi, type ApiFalsa } from "@/test/api-falsa";

const UNIDAD = { id: 1, symbol: "un", factorMilli: 1000, groupId: 1 };
/** $199: con redondeo a $10, efectivo cobra $200 y tarjeta $199. */
const PERNO = { id: 10, sku: "FH-00010", name: "Perno 1/4", priceGross: 199, saleUnit: UNIDAD };

type Opciones = { cobro?: { estado?: number; cuerpo: unknown } };

const COBRO_OK = {
  cuerpo: {
    mensaje: "Venta 1 cobrada.",
    cambio: 0,
    avisoImpresion: null,
    avisoCliente: null,
    whatsapp: { encolado: false },
  },
};

function montar(o: Opciones = {}): { api: ApiFalsa; user: ReturnType<typeof userEvent.setup> } {
  const api = montarApi({
    "GET /api/pos/config": { cuerpo: { taxRatePercent: 19, multiploRedondeo: 10, topeDescuento: 5 } },
    "GET /api/cash/current": { cuerpo: { abierta: true } },
    "GET /api/catalog/units": { cuerpo: { grupos: [{ id: 1, allowsFraction: false }] } },
    "GET /api/suspended": { cuerpo: { esperas: [] } },
    "GET /api/products/search*": { cuerpo: { exacto: true, productos: [PERNO] } },
    "POST /api/sales": o.cobro ?? COBRO_OK,
  });
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <Venta />
    </MemoryRouter>,
  );
  return { api, user };
}

/** Una línea de $199 y el diálogo de cobro abierto. */
async function conElCobroAbierto(o: Opciones = {}) {
  const r = montar(o);
  await r.user.type(screen.getByRole("combobox"), "FH-00010{Enter}");
  await waitFor(() => expect(screen.getByRole("table")).toBeInTheDocument());
  await r.user.keyboard("{F2}");
  await screen.findByRole("dialog");
  return r;
}

const dialogo = () => screen.getByRole("dialog");
const botonEfectivo = () => within(dialogo()).getByRole("button", { name: /Efectivo/ });
const botonDebito = () => within(dialogo()).getByRole("button", { name: /Débito|Tarjeta/ });
const botonCobrar = () => within(dialogo()).getByRole("button", { name: /Cobrar e imprimir/ });
const campoEfectivo = () => within(dialogo()).getByLabelText(/Efectivo recibido/);
const campoDebito = () => within(dialogo()).getByLabelText(/Débito o crédito/);
/** La cifra grande de abajo: o «Vuelto» o «Falta». */
const cifraGrande = (rotulo: "Vuelto" | "Falta") =>
  within(dialogo()).getByText(rotulo).parentElement!.querySelector(".fh-num")!.textContent;

describe("al abrir el cobro", () => {
  /**
   * Cobrar nace deshabilitado —todavía no se dijo cómo paga— y un botón
   * deshabilitado no recibe foco: el intento se perdía en silencio y el foco
   * quedaba en el `body`, o sea que Enter no hacía nada.
   */
  it("el foco arranca en «Todo en efectivo», no en Cobrar", async () => {
    await conElCobroAbierto();
    expect(botonEfectivo()).toHaveFocus();
    expect(botonCobrar()).toBeDisabled();
  });

  it("no se pide ningún monto hasta elegir cómo paga", async () => {
    await conElCobroAbierto();
    expect(within(dialogo()).queryByLabelText(/Efectivo recibido/)).not.toBeInTheDocument();
    expect(within(dialogo()).getByText(/Indica cómo paga el cliente/)).toBeInTheDocument();
  });

  /** EL INVARIANTE CARO: los dos botones no dicen la misma cifra. */
  it("efectivo va redondeado y tarjeta al peso exacto", async () => {
    await conElCobroAbierto();
    expect(botonEfectivo()).toHaveTextContent("$200");
    expect(botonDebito()).toHaveTextContent("$199");
  });
});

describe("pagando en efectivo", () => {
  /**
   * Vacío a propósito: el campo pide el billete que puso el cliente, y dejarlo
   * con el total escrito invita a apretar Enter sobre una cifra que nadie contó.
   */
  it("«Recibido» queda vacío y enfocado", async () => {
    const { user } = await conElCobroAbierto();
    await user.click(botonEfectivo());

    await waitFor(() => expect(campoEfectivo()).toHaveFocus());
    expect(campoEfectivo()).toHaveValue("");
  });

  /**
   * La cifra grande cambia de trabajo. Un «$0» grande y quieto se lee como «no
   * hay vuelto», que es una afirmación distinta de «todavía no sé».
   */
  it("mientras el billete no alcanza dice «Falta», no un vuelto de $0", async () => {
    const { user } = await conElCobroAbierto();
    await user.click(botonEfectivo());
    await user.type(campoEfectivo(), "100");

    expect(cifraGrande("Falta")).toBe("$100");
    expect(within(dialogo()).queryByText("Vuelto")).not.toBeInTheDocument();
    expect(botonCobrar()).toBeDisabled();
  });

  /** El vuelto aparece mientras se teclea, no después de cobrar. */
  it("con el billete puesto muestra el vuelto en el acto", async () => {
    const { user } = await conElCobroAbierto();
    await user.click(botonEfectivo());
    await user.type(campoEfectivo(), "1000");

    expect(cifraGrande("Vuelto")).toBe("$800"); // 1000 - 200 redondeado
    expect(botonCobrar()).toBeEnabled();
  });

  /**
   * Los billetes SUMAN en vez de reemplazar: si el cliente paga con dos de
   * veinte, se aprieta dos veces — que es lo que hace la mano, no calcular
   * cuarenta y teclearlo.
   */
  it("los billetes rápidos suman entre sí", async () => {
    const { user } = await conElCobroAbierto();
    await user.click(botonEfectivo());

    const veinte = within(dialogo()).getByRole("button", { name: "20.000" });
    await user.click(veinte);
    await user.click(veinte);

    expect(campoEfectivo()).toHaveValue("$40.000");
    expect(cifraGrande("Vuelto")).toBe("$39.800");
  });

  it("el campo ignora lo que no sea dígito", async () => {
    const { user } = await conElCobroAbierto();
    await user.click(botonEfectivo());
    await user.type(campoEfectivo(), "1a0b0c0");

    expect(campoEfectivo()).toHaveValue("$1.000");
  });
});

describe("pagando con tarjeta", () => {
  /** El total EXACTO, no el redondeado: con tarjeta no hay vuelto que dar. */
  it("al elegir débito el monto viene puesto al peso exacto", async () => {
    const { user } = await conElCobroAbierto();
    await user.click(botonDebito());

    await waitFor(() => expect(campoDebito()).toHaveValue("$199"));
    expect(botonCobrar()).toBeEnabled();
  });

  it("avisa que el cajón no se abre en una venta toda con tarjeta", async () => {
    const { user } = await conElCobroAbierto();
    await user.click(botonDebito());

    expect(await within(dialogo()).findByText(/El cajón no se abre/)).toBeInTheDocument();
  });

  /**
   * F2 NO BORRA EL DÉBITO cuando ya hay un voucher digitado: la máquina cobró y
   * el papel está impreso, deshacerlo en la pantalla no lo deshace en el banco.
   * En el pago mixto esta tecla es «llévame al campo del efectivo».
   */
  it("volver a efectivo no borra un débito con voucher digitado", async () => {
    const { user } = await conElCobroAbierto();
    await user.click(botonDebito());
    await waitFor(() => expect(campoDebito()).toHaveValue("$199"));

    await user.clear(campoDebito());
    await user.type(campoDebito(), "100");
    await user.type(within(dialogo()).getByPlaceholderText(/Nº de voucher/), "998877");

    await user.keyboard("{F2}");
    expect(campoDebito()).toHaveValue("$100");
  });
});

describe("el pago mixto", () => {
  /**
   * La cifra que vuelve imposible el cálculo de cabeza: el débito va al peso,
   * el efectivo se redondea, y la resta no es la que uno haría a ojo.
   */
  it("dice cuánto falta en efectivo con el débito ya descontado", async () => {
    const { user } = await conElCobroAbierto();
    await user.click(botonDebito());
    await waitFor(() => expect(campoDebito()).toHaveValue("$199"));

    await user.clear(campoDebito());
    await user.type(campoDebito(), "100");

    expect(within(dialogo()).getByText(/A cobrar en efectivo/).textContent).toMatch(/\$100/);
    expect(within(dialogo()).getByText(/el resto ya va con la tarjeta/)).toBeInTheDocument();
  });

  it("cobra las dos patas juntas", async () => {
    const { api, user } = await conElCobroAbierto();
    await user.click(botonDebito());
    await waitFor(() => expect(campoDebito()).toHaveValue("$199"));
    await user.clear(campoDebito());
    await user.type(campoDebito(), "100");

    await user.click(botonEfectivo());
    await waitFor(() => expect(campoEfectivo()).toHaveFocus());
    await user.type(campoEfectivo(), "100");

    await waitFor(() => expect(botonCobrar()).toBeEnabled());
    await user.click(botonCobrar());

    await waitFor(() => expect(api.ultima("POST", "/api/sales")).toBeDefined());
    const enviado = api.ultima("POST", "/api/sales")!.cuerpo as { payments: Array<Record<string, unknown>> };
    expect(enviado.payments).toEqual([
      { method: "DEBIT", amount: 100, reference: null },
      { method: "CASH", receivedAmount: 100 },
    ]);
  });
});

describe("cobrar", () => {
  it("manda las líneas y el documento", async () => {
    const { api, user } = await conElCobroAbierto();
    await user.click(botonEfectivo());
    await user.type(campoEfectivo(), "1000");
    await user.click(botonCobrar());

    await waitFor(() => expect(api.ultima("POST", "/api/sales")).toBeDefined());
    const enviado = api.ultima("POST", "/api/sales")!.cuerpo as Record<string, unknown>;
    expect(enviado.items).toEqual([{ productId: 10, qtyMilli: 1000, discountAmount: 0 }]);
    expect(enviado.fiscalDocType).toBe("BOLETA");
  });

  /**
   * Enter es la tecla que se aprieta al terminar de teclear una cifra. Antes
   * obligaba a soltar el teclado o a tabular hasta el botón.
   */
  it("Enter en el campo del monto cobra", async () => {
    const { api, user } = await conElCobroAbierto();
    await user.click(botonEfectivo());
    await user.type(campoEfectivo(), "1000{Enter}");

    await waitFor(() => expect(api.ultima("POST", "/api/sales")).toBeDefined());
  });

  it("al cobrar cierra el diálogo, limpia la venta y avisa", async () => {
    const { user } = await conElCobroAbierto();
    await user.click(botonEfectivo());
    await user.type(campoEfectivo(), "1000{Enter}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText(/Venta 1 cobrada/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  /**
   * El aviso de impresión NO se puede perder: el vendedor le prometió un ticket
   * al cliente, y si no salió tiene que enterarse ahora.
   */
  it("si el ticket no salió, lo dice", async () => {
    const { user } = await conElCobroAbierto({
      cobro: {
        cuerpo: {
          mensaje: "Venta 1 cobrada.",
          cambio: 0,
          avisoImpresion: "No se pudo imprimir el ticket.",
          avisoCliente: null,
          whatsapp: { encolado: false },
        },
      },
    });
    await user.click(botonEfectivo());
    await user.type(campoEfectivo(), "1000{Enter}");

    expect(await screen.findByText(/No se pudo imprimir el ticket/)).toBeInTheDocument();
  });

  /** Si el servidor rechaza, la venta NO se pierde: sigue armada para reintentar. */
  it("si el servidor rechaza, muestra el motivo y conserva la venta", async () => {
    const { user } = await conElCobroAbierto({
      cobro: { estado: 400, cuerpo: { error: "La caja se cerró en otro terminal" } },
    });
    await user.click(botonEfectivo());
    await user.type(campoEfectivo(), "1000{Enter}");

    expect(await within(dialogo()).findByText(/La caja se cerró en otro terminal/)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(botonCobrar()).toBeEnabled();
  });
});
