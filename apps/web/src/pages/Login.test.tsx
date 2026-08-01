/**
 * La puerta de entrada al sistema.
 *
 * Es la pantalla que se usa varias veces al día, siempre con prisa, y la única
 * que tiene dos teclados compitiendo por el mismo campo: el de la pantalla —que
 * existe para las tablets y para los dedos con guantes— y el físico. Que
 * convivan no es evidente y ya costó un `preventDefault` en `onMouseDown`;
 * hasta ahora nada comprobaba que siguiera funcionando.
 */
import { describe, it, expect } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Login } from "./Login";
import { AuthProvider } from "@/lib/auth";
import { montarApi, type ApiFalsa } from "@/test/api-falsa";

const ADMIN = { id: 2, name: "Administrador", role: "ADMIN" };
const VENDEDOR = { id: 3, name: "Vendedor", role: "SELLER" };
const CAJA1 = { id: 1, name: "CAJA-1" };
const CAJA2 = { id: 2, name: "CAJA-2" };

const TOKEN = "un.token.cualquiera";

type Opciones = {
  usuarios?: typeof ADMIN[];
  estaciones?: typeof CAJA1[];
  login?: { estado?: number; cuerpo: unknown };
};

async function montar(o: Opciones = {}): Promise<{ api: ApiFalsa; user: ReturnType<typeof userEvent.setup> }> {
  const api = montarApi({
    "GET /api/auth/users": { cuerpo: { usuarios: o.usuarios ?? [ADMIN, VENDEDOR] } },
    "GET /api/auth/stations": { cuerpo: { estaciones: o.estaciones ?? [CAJA1] } },
    "POST /api/auth/login": o.login ?? {
      cuerpo: { token: TOKEN, usuario: { sub: 2, name: "Administrador", role: "ADMIN", stationId: 1, locationId: 1 } },
    },
  });
  const user = userEvent.setup();
  render(
    <AuthProvider>
      <Login />
    </AuthProvider>,
  );
  // Los usuarios llegan por fetch: hasta que no estén, no hay nada que apretar.
  await screen.findByRole("button", { name: /Administrador/ });
  return { api, user };
}

const entrar = () => screen.getByRole("button", { name: /^Entrar/ });
const campoPin = () => screen.getByLabelText("PIN");

describe("elegir quién eres", () => {
  it("muestra los usuarios que da el servidor, con su rol", async () => {
    await montar();
    expect(screen.getByRole("button", { name: /Administrador/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Vendedor/ })).toBeInTheDocument();
  });

  it("el elegido queda marcado, y solo uno", async () => {
    const { user } = await montar();
    const admin = screen.getByRole("button", { name: /Administrador/ });
    const vendedor = screen.getByRole("button", { name: /Vendedor/ });

    await user.click(admin);
    expect(admin).toHaveAttribute("aria-pressed", "true");
    expect(vendedor).toHaveAttribute("aria-pressed", "false");

    await user.click(vendedor);
    expect(admin).toHaveAttribute("aria-pressed", "false");
    expect(vendedor).toHaveAttribute("aria-pressed", "true");
  });

  /** Se opera sin mouse: elegido el usuario, el cursor ya está en el PIN. */
  it("al elegir usuario el foco salta solo al PIN", async () => {
    const { user } = await montar();
    await user.click(screen.getByRole("button", { name: /Administrador/ }));
    expect(campoPin()).toHaveFocus();
  });
});

describe("el PIN", () => {
  it("se puede teclear con el teclado físico", async () => {
    const { user } = await montar();
    await user.click(screen.getByRole("button", { name: /Administrador/ }));
    await user.keyboard("1234");
    expect(campoPin()).toHaveValue("1234");
  });

  /**
   * El teclado de pantalla es un atajo, no un modo: se puede empezar con el
   * dedo y terminar con el teclado físico.
   */
  it("el teclado de pantalla escribe en el mismo campo", async () => {
    const { user } = await montar();
    await user.click(screen.getByRole("button", { name: /Administrador/ }));

    await user.click(screen.getByRole("button", { name: "1" }));
    await user.click(screen.getByRole("button", { name: "2" }));
    expect(campoPin()).toHaveValue("12");
    expect(campoPin()).toHaveFocus();

    await user.keyboard("34");
    expect(campoPin()).toHaveValue("1234");
  });

  /**
   * SE PRUEBA EL MECANISMO Y NO EL EFECTO, y no por gusto.
   *
   * En un navegador, `mousedown` sobre un botón le da el foco, y por eso las
   * teclas de pantalla llaman a `preventDefault`: sin eso, el botón se queda
   * con el foco y el dígito siguiente tecleado a mano no llega al campo.
   *
   * jsdom NO implementa ese comportamiento por omisión. Comprobado: quitando
   * el `preventDefault` del componente, un test que mirara `toHaveFocus()`
   * seguía pasando — o sea que habría dicho que la protección está mientras el
   * bug volvía a la tienda. Así que se verifica que el evento quede cancelado,
   * que es exactamente la línea que existe para eso.
   */
  it("las teclas de pantalla cancelan el mousedown para no llevarse el foco", async () => {
    const { user } = await montar();
    await user.click(screen.getByRole("button", { name: /Administrador/ }));

    for (const t of ["1", "C", "←"]) {
      // `fireEvent` devuelve false cuando alguien llamó a preventDefault.
      expect(fireEvent.mouseDown(screen.getByRole("button", { name: t })), t).toBe(false);
    }
  });

  it("← borra el último dígito y C limpia todo", async () => {
    const { user } = await montar();
    await user.click(screen.getByRole("button", { name: /Administrador/ }));
    await user.keyboard("1234");

    await user.click(screen.getByRole("button", { name: "←" }));
    expect(campoPin()).toHaveValue("123");

    await user.click(screen.getByRole("button", { name: "C" }));
    expect(campoPin()).toHaveValue("");
  });

  /** El campo es `type=password`: quien teclea no ve lo que entra. */
  it("ignora lo que no sea dígito", async () => {
    const { user } = await montar();
    await user.click(screen.getByRole("button", { name: /Administrador/ }));
    await user.type(campoPin(), "12ab-3 4");
    expect(campoPin()).toHaveValue("1234");
  });

  it("no pasa de 6 dígitos, ni tecleando ni con el teclado de pantalla", async () => {
    const { user } = await montar();
    await user.click(screen.getByRole("button", { name: /Administrador/ }));
    await user.keyboard("123456");
    await user.keyboard("789");
    await user.click(screen.getByRole("button", { name: "1" }));
    expect(campoPin()).toHaveValue("123456");
  });
});

describe("cuándo se puede entrar", () => {
  it("no se puede sin haber elegido usuario", async () => {
    await montar();
    expect(entrar()).toBeDisabled();
  });

  it("no se puede con menos de 4 dígitos", async () => {
    const { user } = await montar();
    await user.click(screen.getByRole("button", { name: /Administrador/ }));
    await user.keyboard("123");
    expect(entrar()).toBeDisabled();
    await user.keyboard("4");
    expect(entrar()).toBeEnabled();
  });

  /** Con una sola caja no se pregunta: se elige sola y no aparece. */
  it("con una sola caja no aparece el selector y se puede entrar igual", async () => {
    const { user } = await montar({ estaciones: [CAJA1] });
    expect(screen.queryByText("Caja")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Administrador/ }));
    await user.keyboard("111111");
    expect(entrar()).toBeEnabled();
  });

  /**
   * Con dos cajas hay que elegir, y hasta entonces no se entra. La estación
   * decide de qué ubicación sale el stock y a qué impresora van los tickets:
   * entrar por la caja equivocada descuadra el arqueo de las dos.
   */
  it("con dos cajas hay que elegir una antes de poder entrar", async () => {
    const { user } = await montar({ estaciones: [CAJA1, CAJA2] });
    await user.click(screen.getByRole("button", { name: /Administrador/ }));
    await user.keyboard("111111");
    expect(entrar()).toBeDisabled();

    await user.selectOptions(screen.getByRole("combobox"), "2");
    expect(entrar()).toBeEnabled();
  });
});

describe("entrar", () => {
  it("manda usuario, PIN y caja al servidor", async () => {
    const { api, user } = await montar();
    await user.click(screen.getByRole("button", { name: /Administrador/ }));
    await user.keyboard("111111");
    await user.click(entrar());

    await waitFor(() => expect(api.ultima("POST", "/api/auth/login")).toBeDefined());
    expect(api.ultima("POST", "/api/auth/login")!.cuerpo).toEqual({ userId: 2, pin: "111111", stationId: 1 });
  });

  /** Se opera sin mouse: el PIN termina en Enter, no en un clic. */
  it("Enter en el campo del PIN envía el formulario", async () => {
    const { api, user } = await montar();
    await user.click(screen.getByRole("button", { name: /Administrador/ }));
    await user.keyboard("111111{Enter}");

    await waitFor(() => expect(api.ultima("POST", "/api/auth/login")).toBeDefined());
  });

  it("guarda el token para las llamadas siguientes", async () => {
    const { user } = await montar();
    await user.click(screen.getByRole("button", { name: /Administrador/ }));
    await user.keyboard("111111");
    await user.click(entrar());

    await waitFor(() => expect(localStorage.getItem("fh.token")).toBe(TOKEN));
  });

  /**
   * El mensaje del servidor tal cual, y el PIN limpio para reintentar sin
   * borrar a mano. Un `role="alert"` además lo anuncia sin que haya que
   * buscarlo con la vista.
   */
  it("con el PIN equivocado muestra lo que dijo el servidor y limpia el campo", async () => {
    const { user } = await montar({ login: { estado: 401, cuerpo: { error: "PIN incorrecto" } } });
    await user.click(screen.getByRole("button", { name: /Administrador/ }));
    await user.keyboard("999999");
    await user.click(entrar());

    expect(await screen.findByRole("alert")).toHaveTextContent("PIN incorrecto");
    expect(campoPin()).toHaveValue("");
    expect(campoPin()).toHaveFocus();
  });

  it("si el servidor no está, lo dice en vez de quedarse pensando", async () => {
    const { user } = await montar({ login: { estado: 500, cuerpo: {} } });
    await user.click(screen.getByRole("button", { name: /Administrador/ }));
    await user.keyboard("111111");
    await user.click(entrar());

    expect(await screen.findByRole("alert")).toHaveTextContent(/No se pudo conectar con el servidor/);
    expect(entrar()).toBeDisabled(); // el PIN se limpió: hay que teclearlo de nuevo
  });
});
