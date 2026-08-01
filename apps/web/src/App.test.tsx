/**
 * El guard por rol y a dónde cae cada quien (USR-03, ADR 007).
 *
 * Esta es la promesa que el sistema le hace al dueño: el vendedor no ve la
 * plata. Del lado del servidor ya está sostenida —un hook borra los campos de
 * costo y margen antes de serializar, y las rutas de admin exigen el rol—, pero
 * eso no alcanza para lo que se ve: una pantalla de administración que se
 * abriera para un vendedor mostraría el esqueleto, los títulos y los rótulos
 * de lo que no puede saber, aunque los números vinieran vacíos.
 *
 * SE PRUEBA CONTRA LA TABLA DE RUTAS DE VERDAD, la de `App.tsx`, y no contra
 * una copia armada en el test. Es la diferencia entre comprobar que el guard
 * funciona y comprobar que el guard está PUESTO en cada ruta: el modo de fallar
 * real no es que `Privado` esté mal escrito, es que alguien agregue la ruta
 * número quince y se olvide del `soloAdmin`.
 *
 * Las pantallas van reemplazadas por marcadores. No es para ir más rápido: es
 * para que este archivo hable de rutas y de nada más. Montar `Venta` de verdad
 * —82 KB que piden catálogo, caja y estación— haría que un fallo suyo se
 * reportara acá, en un test que dice llamarse «el vendedor no entra al panel».
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { montarApi } from "@/test/api-falsa";

/** Una pantalla de mentira que solo dice su nombre. */
const marcador = (nombre: string) => ({ [nombre]: () => <div>pantalla:{nombre}</div> });

vi.mock("@/pages/Dashboard", () => marcador("Dashboard"));
vi.mock("@/pages/Venta", () => marcador("Venta"));
vi.mock("@/pages/Login", () => marcador("Login"));
vi.mock("@/pages/Alertas", () => marcador("Alertas"));
vi.mock("@/pages/Catalogo", () => marcador("Catalogo"));
vi.mock("@/pages/Caja", () => marcador("Caja"));
vi.mock("@/pages/Kardex", () => marcador("Kardex"));
vi.mock("@/pages/Reportes", () => marcador("Reportes"));
vi.mock("@/pages/Compras", () => marcador("Compras"));
vi.mock("@/pages/Usuarios", () => marcador("Usuarios"));
vi.mock("@/pages/WhatsApp", () => marcador("WhatsApp"));
vi.mock("@/pages/ProveedorNuevo", () => marcador("ProveedorNuevo"));
vi.mock("@/pages/Devoluciones", () => marcador("Devoluciones"));
vi.mock("@/pages/Estaciones", () => marcador("Estaciones"));

// Los cascarones traen la navegación y piden sus propios datos; acá solo
// importa que dejen pasar a su contenido.
vi.mock("@/components/cascarones", () => ({
  PosShell: ({ children }: { children: React.ReactNode }) => <div data-cascaron="pos">{children}</div>,
  AdminShell: ({ children }: { children: React.ReactNode }) => <div data-cascaron="admin">{children}</div>,
  leerModo: () => "admin",
}));

const { App } = await import("./App");

const ADMIN = { sub: 2, name: "Administrador", role: "ADMIN", stationId: 1, locationId: 1 };
const VENDEDOR = { sub: 3, name: "Vendedor", role: "SELLER", stationId: 1, locationId: 1 };

/** Las rutas que el vendedor no puede ver, tal como están en `App.tsx`. */
const SOLO_ADMIN = [
  "/alertas",
  "/compras",
  "/estaciones",
  "/usuarios",
  "/reportes",
  "/whatsapp",
  "/kardex",
  "/proveedores/nuevo",
];

/** Las que sí comparten los dos roles. */
const COMPARTIDAS = ["/catalogo", "/caja", "/devoluciones", "/venta"];

function entrarComo(usuario: typeof ADMIN | null, url: string) {
  window.history.pushState({}, "", url);
  if (usuario) {
    localStorage.setItem("fh.token", "un.token.cualquiera");
    montarApi({ "GET /api/me": { cuerpo: { usuario } } });
  } else {
    montarApi({});
  }
  render(<App />);
}

/** Lo que quedó en pantalla, por el marcador. */
const enPantalla = () => screen.queryByText(/^pantalla:/)?.textContent?.replace("pantalla:", "") ?? null;

beforeEach(() => {
  window.history.pushState({}, "", "/");
});

describe("sin haber entrado", () => {
  it("cualquier ruta manda al login", async () => {
    entrarComo(null, "/reportes");
    await waitFor(() => expect(enPantalla()).toBe("Login"));
    expect(window.location.pathname).toBe("/login");
  });
});

describe("el administrador", () => {
  it("cae en el panel al entrar", async () => {
    entrarComo(ADMIN, "/");
    await waitFor(() => expect(enPantalla()).toBe("Dashboard"));
  });

  it.each(SOLO_ADMIN)("puede abrir %s", async (ruta) => {
    entrarComo(ADMIN, ruta);
    await waitFor(() => expect(enPantalla()).not.toBeNull());
    expect(window.location.pathname).toBe(ruta);
  });
});

describe("el vendedor", () => {
  /**
   * Entra directo a vender: es lo que abre el 100% de las veces, y su panel no
   * tendría ninguna cifra que mostrarle.
   */
  it("cae en Venta al entrar, no en el panel", async () => {
    entrarComo(VENDEDOR, "/");
    await waitFor(() => expect(enPantalla()).toBe("Venta"));
    expect(window.location.pathname).toBe("/venta");
  });

  /**
   * Tecleando la URL a mano, que es la única forma de llegar: el riel del POS
   * no ofrece ninguna de estas.
   */
  it.each(SOLO_ADMIN)("no puede abrir %s ni tecleándola", async (ruta) => {
    entrarComo(VENDEDOR, ruta);
    await waitFor(() => expect(enPantalla()).toBe("Venta"));
    expect(window.location.pathname).toBe("/venta");
  });

  it.each(COMPARTIDAS)("sí puede abrir %s", async (ruta) => {
    entrarComo(VENDEDOR, ruta);
    await waitFor(() => expect(enPantalla()).not.toBeNull());
    expect(window.location.pathname).toBe(ruta);
  });

  /** Nunca sale del cascarón del mesón: no tiene otro, ni forma de volver. */
  it.each(COMPARTIDAS)("ve %s dentro del cascarón del POS", async (ruta) => {
    entrarComo(VENDEDOR, ruta);
    await waitFor(() => expect(enPantalla()).not.toBeNull());
    expect(document.querySelector("[data-cascaron]")).toHaveAttribute("data-cascaron", "pos");
  });
});

describe("los cascarones del administrador", () => {
  it("vender y devolver se abren en el POS aunque las abra el administrador", async () => {
    for (const ruta of ["/venta", "/devoluciones"]) {
      entrarComo(ADMIN, ruta);
      await waitFor(() => expect(enPantalla()).not.toBeNull());
      expect(document.querySelector("[data-cascaron]"), ruta).toHaveAttribute("data-cascaron", "pos");
      screen.getByText(/^pantalla:/).remove();
    }
  });

  it("el panel y los reportes se abren en el backoffice", async () => {
    entrarComo(ADMIN, "/reportes");
    await waitFor(() => expect(enPantalla()).toBe("Reportes"));
    expect(document.querySelector("[data-cascaron]")).toHaveAttribute("data-cascaron", "admin");
  });
});

describe("una ruta que no existe", () => {
  it("vuelve al inicio del rol que corresponda", async () => {
    entrarComo(VENDEDOR, "/no-existe-esta-ruta");
    await waitFor(() => expect(enPantalla()).toBe("Venta"));
  });
});
