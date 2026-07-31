/**
 * Los dos cascarones de navegación (ADR 007).
 *
 * Antes había UNA barra superior con las pestañas de todos: nueve destinos para
 * el administrador y cinco para el vendedor, de los cuales abre uno. Ahora el
 * rol elige el cascarón, y cada uno muestra solo lo que su usuario usa:
 *
 * - `PosShell` — riel de cuatro destinos gigantes. El vendedor mira esta barra
 *   ocho horas al día; lo que sobra en ella no es neutro, es ruido.
 * - `AdminShell` — barra lateral oscura con la navegación agrupada en cuatro
 *   temas, porque diez ítems seguidos se leen como una lista y no como un mapa.
 *
 * El administrador cruza de un lado al otro con «Ir a vender» y con la celda
 * ADMIN del riel: es la misma persona, no dos cuentas.
 */
import { Component, createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { NavLink, Link, useLocation } from "react-router-dom";
import {
  Banknote,
  Barcode,
  LayoutDashboard,
  List,
  LogOut,
  MessageCircle,
  Package,
  RotateCcw,
  TrendingUp,
  TriangleAlert,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { formatHora } from "@ferrehouse/shared";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

/**
 * El trazo cuadrado no es un capricho: el redondeado de Lucide por defecto
 * contradice una dirección visual cuyo radio es cero en todas partes. Se pone
 * una vez acá y no icono por icono.
 */
const ICONO = { strokeWidth: 2, strokeLinecap: "square", strokeLinejoin: "miter" } as const;

// ------------------------------------------------------------------- el modo

/**
 * En qué lado está parado el administrador.
 *
 * **Por qué hace falta:** el rol no alcanza para elegir cascarón. Catálogo y
 * Caja están en los DOS —el riel del POS los tiene como «Buscar» y «Caja», la
 * barra lateral como «Catálogo» y «Caja y turnos»— así que la misma ruta se
 * dibuja de dos maneras según de dónde vengas. Un administrador atendiendo el
 * mesón que aprieta «Caja» en el riel no puede saltar de golpe al backoffice
 * con el cliente al frente.
 *
 * Se guarda en `localStorage` y no en memoria porque el terminal se recarga —al
 * volver de imprimir, al reabrir el acceso directo— y volver al otro lado sin
 * haberlo pedido es la misma sorpresa, con un paso más.
 *
 * El vendedor no tiene modo: siempre está en el POS.
 */
const CLAVE_MODO = "fh.modo";
export type Modo = "pos" | "admin";

export function leerModo(): Modo {
  return localStorage.getItem(CLAVE_MODO) === "pos" ? "pos" : "admin";
}

function fijarModo(m: Modo) {
  localStorage.setItem(CLAVE_MODO, m);
}

/**
 * En qué cascarón está dibujada la pantalla.
 *
 * Catálogo y Caja se dibujan en los dos, y no son la misma pantalla en cada
 * uno: en el mesón, Caja se titula a sí misma porque el riel no tiene barra de
 * título; en el backoffice, el título ya lo pone el cascarón y repetirlo es
 * ruido. Preguntarlo acá evita que cada pantalla recalcule por su cuenta la
 * regla de `cascaronDe` en `App.tsx` y que las dos se desincronicen.
 */
const CascaronCtx = createContext<Modo>("admin");

export function useCascaron(): Modo {
  return useContext(CascaronCtx);
}

// ---------------------------------------------------------------- datos vivos

/** La hora del mesón. Cada 20 s: se muestra HH:MM, no segundos. */
function useReloj(): string {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setAhora(new Date()), 20_000);
    return () => window.clearInterval(id);
  }, []);
  return formatHora(ahora);
}

type EstadoCaja = { abierta: boolean; desde: string | null };

/**
 * El estado de la caja, que va en las dos barras.
 *
 * Se consulta al montar y cada dos minutos. No se pide en cada navegación
 * porque el cascarón no se desmonta al cambiar de pantalla — ese es justamente
 * el punto de que la barra viva acá arriba y no dentro de cada pantalla.
 */
function useEstadoDeCaja(): EstadoCaja {
  const [estado, setEstado] = useState<EstadoCaja>({ abierta: false, desde: null });
  useEffect(() => {
    let vivo = true;
    const pedir = () =>
      api<{ abierta: boolean; sesion: { openedAt: string } | null }>("/cash/current")
        .then((r) => vivo && setEstado({ abierta: r.abierta, desde: r.sesion?.openedAt ?? null }))
        // Una barra que no sabe el estado de la caja no rompe la venta: se
        // queda callada. Lo que no puede hacer es tumbar la pantalla entera.
        .catch(() => undefined);
    void pedir();
    const id = window.setInterval(pedir, 120_000);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, []);
  return estado;
}

/** El nombre de la caja para la barra. `/auth/stations` es público: lo usa el login. */
function useNombreDeEstacion(stationId: number | undefined): string | null {
  const [nombre, setNombre] = useState<string | null>(null);
  useEffect(() => {
    if (stationId === undefined) return;
    let vivo = true;
    void api<{ estaciones: { id: number; name: string }[] }>("/auth/stations")
      .then((r) => vivo && setNombre(r.estaciones.find((e) => e.id === stationId)?.name ?? null))
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [stationId]);
  return nombre;
}

/**
 * El contador de alertas de la barra lateral. Es el ÚNICO badge de toda la
 * aplicación, y por eso puede significar algo.
 *
 * Vive en el cascarón y no en la pantalla de Alertas porque el número tiene que
 * verse desde Compras o desde Reportes — si solo se viera estando en Alertas,
 * no avisaría de nada. `/api/alerts` cuesta 5 ms y 457 bytes contra la base
 * local: se puede pedir cada tres minutos sin pensarlo.
 */
function useAlertas(): { total: number; criticas: number } {
  const [n, setN] = useState({ total: 0, criticas: 0 });
  useEffect(() => {
    let vivo = true;
    const pedir = () =>
      api<{ alertas: unknown[]; criticas: number }>("/alerts")
        .then((r) => vivo && setN({ total: r.alertas.length, criticas: r.criticas }))
        .catch(() => undefined);
    void pedir();
    const id = window.setInterval(pedir, 180_000);
    return () => {
      vivo = false;
      window.clearInterval(id);
    };
  }, []);
  return n;
}

// ------------------------------------------------------------------- barrera

/**
 * Barrera de errores de render.
 *
 * **Existe porque el modo de falla sin ella es el peor posible en un mesón.**
 * Se descubrió el 2026-07-31 con un defecto propio: al recuperar una venta en
 * espera, una línea sin `saleUnit` tumbaba la tabla, y React desmontaba el
 * árbol entero. Lo que quedaba era una pantalla EN BLANCO —sin navegación, sin
 * mensaje, sin forma de volver salvo recargar— y pasaba con la venta a medio
 * armar, o sea con el cliente al frente.
 *
 * No arregla el error: lo contiene. La navegación sobrevive, el vendedor se va
 * a otra pantalla y sigue trabajando, y el detalle técnico queda en la consola
 * para quien lo pueda leer. La pantalla dice qué hacer, no qué pasó.
 *
 * Va DENTRO de cada cascarón, nunca envolviéndolos: una barrera puesta por
 * fuera se lleva la navegación con ella y deja la aplicación en blanco, que es
 * exactamente lo que vino a evitar.
 */
class Barrera extends Component<{ children: ReactNode }, { cayo: boolean }> {
  override state = { cayo: false };

  static getDerivedStateFromError() {
    return { cayo: true };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error("[pantalla] se cayó:", error, info.componentStack);
  }

  override render() {
    if (!this.state.cayo) return this.props.children;
    return (
      <div className="border-2 border-accent bg-accent-tint p-8 text-center">
        <p className="text-lg font-bold">Esta pantalla se cayó.</p>
        <p className="mt-2 text-ink-soft">
          Lo que estabas haciendo acá se perdió, pero nada de lo ya cobrado se pierde nunca. Anda a otra pantalla desde
          el menú y vuelve a entrar.
        </p>
        <button onClick={() => this.setState({ cayo: false })} className="mt-4 underline underline-offset-4">
          Intentar de nuevo
        </button>
      </div>
    );
  }
}

function ConBarrera({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  // Se remonta al cambiar de ruta: si no, irse a otra pantalla dejaría la
  // barrera puesta y ninguna cargaría.
  return <Barrera key={pathname}>{children}</Barrera>;
}

// ------------------------------------------------------------- piezas comunes

/**
 * El chip de estado de caja de las barras oscuras. No es el `Chip` de
 * `ui.tsx`: aquel está calculado para fondo claro, y sus tonos sobre la tinta
 * del cascarón se ven sucios. Color Y palabra, igual que aquel.
 */
function ChipDeCaja({ estado }: { estado: EstadoCaja }) {
  if (!estado.abierta) {
    return (
      <span className="flex items-center gap-2 border border-shell-line-soft px-2.5 py-1 text-shell-muted">
        <span aria-hidden className="h-2 w-2 bg-shell-muted" />
        <span className="text-[11.5px] font-extrabold tracking-[0.08em]">CAJA CERRADA</span>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 border border-ok bg-ok/[0.18] px-2.5 py-1">
      <span aria-hidden className="h-2 w-2 bg-ok-bright" />
      <span className="text-[11.5px] font-extrabold tracking-[0.08em] text-surface">CAJA ABIERTA</span>
      {estado.desde ? <span className="font-mono text-[11px] text-shell-muted">desde {formatHora(estado.desde)}</span> : null}
    </span>
  );
}

// --------------------------------------------------------------- PosShell

type Destino = { a: string; icono: LucideIcon; texto: string };

/**
 * Cuatro destinos, no cinco: **el Kardex sale del POS.** El vendedor consulta
 * saldo desde Buscar, que es la misma pantalla de catálogo sin las columnas de
 * plata; el libro de movimientos es del administrador (ADR 007).
 *
 * «Buscar» apunta a `/catalogo` a propósito y no a una pantalla nueva:
 * `Catalogo.tsx` ya se comporta distinto según el rol —el vendedor no recibe
 * costo, margen ni el filtro de sin movimiento— así que la pantalla que el
 * diseño llama «Buscar» ya existe, con otro nombre en el menú.
 */
const DESTINOS_POS: Destino[] = [
  { a: "/venta", icono: Barcode, texto: "Venta" },
  { a: "/catalogo", icono: Package, texto: "Buscar" },
  { a: "/caja", icono: Banknote, texto: "Caja" },
  { a: "/devoluciones", icono: RotateCcw, texto: "Devolver" },
];

export function PosShell({ children }: { children: ReactNode }) {
  const { usuario, salir } = useAuth();
  const esAdmin = usuario?.role === "ADMIN";
  const caja = useEstadoDeCaja();
  const hora = useReloj();
  const estacion = useNombreDeEstacion(usuario?.stationId);

  return (
    <CascaronCtx.Provider value="pos">
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center bg-ink text-surface">
        <div className="grid h-14 w-14 shrink-0 place-items-center bg-accent">
          <img src="/brand/isotipo-blanco.svg" alt="" width={30} height={30} />
        </div>
        <span className="px-4 text-sm font-black tracking-[0.16em]">FERREHOUSE</span>
        <span aria-hidden className="h-6 w-px bg-shell-line-soft" />
        <span className="px-4 font-mono text-[11.5px] text-shell-muted">{estacion ?? "—"}</span>

        <div className="ml-auto flex items-center gap-4 pr-4">
          <ChipDeCaja estado={caja} />
          <div className="leading-tight">
            <div className="text-[13px] font-bold">{usuario?.name}</div>
            <div className="text-[10.5px] uppercase tracking-[0.1em] text-shell-label">
              {esAdmin ? "administrador" : "vendedor"}
            </div>
          </div>
          <span className="font-mono text-[15px] font-semibold">{hora}</span>
          <button
            onClick={salir}
            aria-label="Salir"
            title="Salir"
            className="grid h-[34px] w-[34px] place-items-center border border-shell-line-soft text-shell-text hover:text-surface"
          >
            <LogOut size={17} {...ICONO} />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-[104px] shrink-0 flex-col border-r-2 border-ink bg-surface">
          {DESTINOS_POS.map(({ a, icono: Icono, texto }) => (
            <NavLink
              key={a}
              to={a}
              className={({ isActive }) =>
                [
                  "flex h-[92px] shrink-0 flex-col items-center justify-center gap-[7px] border-b border-line-soft",
                  isActive ? "bg-accent text-surface" : "text-ink hover:bg-bg",
                ].join(" ")
              }
            >
              <Icono size={25} {...ICONO} />
              <span className="text-[10.5px] font-extrabold uppercase tracking-[0.09em]">{texto}</span>
            </NavLink>
          ))}
          {/* El administrador que está vendiendo vuelve a su lado desde acá. */}
          {esAdmin ? (
            <Link
              to="/"
              onClick={() => fijarModo("admin")}
              className="mt-auto flex h-16 shrink-0 flex-col items-center justify-center gap-1 border-t-2 border-ink bg-ink text-surface hover:bg-shell-hover"
            >
              <LayoutDashboard size={18} {...ICONO} />
              <span className="text-[9.5px] font-extrabold uppercase tracking-[0.09em]">Admin</span>
            </Link>
          ) : null}
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          <ConBarrera>{children}</ConBarrera>
        </main>
      </div>
    </div>
    </CascaronCtx.Provider>
  );
}

// -------------------------------------------------------------- AdminShell

type ItemAdmin = { a: string; icono: LucideIcon; texto: string; titulo: string; bajada?: string };

/**
 * Cuatro grupos, y el nombre de cada uno es lo que el administrador tiene en la
 * cabeza cuando lo busca: no «Inventario y logística» sino **Inventario**; no
 * «Finanzas» sino **Plata**, que es la palabra que se usa en la tienda.
 */
const GRUPOS: { etiqueta: string; items: ItemAdmin[] }[] = [
  {
    etiqueta: "Hoy",
    items: [
      { a: "/", icono: LayoutDashboard, texto: "Panel", titulo: "Panel", bajada: "Los cuatro números del día" },
      { a: "/alertas", icono: TriangleAlert, texto: "Alertas", titulo: "Alertas", bajada: "Lo que hay que mirar" },
    ],
  },
  {
    etiqueta: "Inventario",
    items: [
      { a: "/catalogo", icono: Package, texto: "Catálogo", titulo: "Catálogo", bajada: "Precios, costos y stock" },
      { a: "/kardex", icono: List, texto: "Kardex", titulo: "Kardex", bajada: "El libro de movimientos" },
      { a: "/compras", icono: Truck, texto: "Compras", titulo: "Compras", bajada: "Órdenes y recepciones" },
    ],
  },
  {
    etiqueta: "Plata",
    items: [
      { a: "/reportes", icono: TrendingUp, texto: "Reportes", titulo: "Reportes", bajada: "Ventas, márgenes e inventario" },
      { a: "/caja", icono: Banknote, texto: "Caja y turnos", titulo: "Caja y turnos", bajada: "Aperturas, cierres y arqueos" },
    ],
  },
  {
    etiqueta: "Tienda",
    items: [
      { a: "/usuarios", icono: Users, texto: "Usuarios", titulo: "Usuarios", bajada: "Quién entra y con qué permiso" },
      { a: "/whatsapp", icono: MessageCircle, texto: "WhatsApp", titulo: "WhatsApp", bajada: "El mensaje que se envía" },
    ],
  },
];

/** Las pantallas sin ítem de menú igual necesitan título en la barra de arriba. */
const SIN_MENU: Record<string, { titulo: string; bajada?: string }> = {
  "/estaciones": { titulo: "Cajas y estaciones", bajada: "Dónde vende cada terminal y a qué impresora imprime" },
  "/devoluciones": { titulo: "Devoluciones", bajada: "Anular una venta o devolver parte" },
  "/proveedores/nuevo": { titulo: "Proveedor nuevo" },
};

function tituloDe(pathname: string): { titulo: string; bajada?: string } {
  if (SIN_MENU[pathname]) return SIN_MENU[pathname]!;
  for (const g of GRUPOS) {
    for (const i of g.items) {
      if (i.a === "/" ? pathname === "/" : pathname.startsWith(i.a)) return { titulo: i.titulo, bajada: i.bajada };
    }
  }
  return { titulo: "Ferrehouse Manager" };
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { usuario, salir } = useAuth();
  const { pathname } = useLocation();
  const caja = useEstadoDeCaja();
  const alertas = useAlertas();
  const { titulo, bajada } = tituloDe(pathname);

  const fecha = new Intl.DateTimeFormat("es-CL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());

  return (
    <CascaronCtx.Provider value="admin">
    <div className="flex h-screen overflow-hidden">
      <aside className="flex w-[236px] shrink-0 flex-col bg-ink text-shell-text">
        <div className="flex h-[72px] shrink-0 items-center gap-3 bg-accent px-4 text-surface">
          <img src="/brand/isotipo-blanco.svg" alt="" width={38} height={38} />
          <div className="leading-tight">
            <div className="text-sm font-black tracking-[0.14em]">FERREHOUSE</div>
            <div className="text-[10.5px] font-bold tracking-[0.14em] opacity-85">MANAGER</div>
          </div>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto py-3">
          {GRUPOS.map((g) => (
            <div key={g.etiqueta} className="mb-2">
              <div className="px-4 pb-[7px] text-[9.5px] font-extrabold uppercase tracking-[0.16em] text-shell-label">
                {g.etiqueta}
              </div>
              {g.items.map(({ a, icono: Icono, texto }) => (
                <NavLink
                  key={a}
                  to={a}
                  end={a === "/"}
                  className={({ isActive }) =>
                    [
                      "flex h-10 items-center gap-[11px] px-4 text-sm",
                      isActive ? "bg-accent font-extrabold text-surface" : "font-medium hover:bg-shell-hover",
                    ].join(" ")
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icono size={17} {...ICONO} className={isActive ? "text-surface" : "text-shell-icon"} />
                      <span className="flex-1">{texto}</span>
                      {/*
                        El único badge de la aplicación. Blanco sobre rojo
                        cuando hay críticas, gris cuando no: un contador que se
                        ve igual con 8 avisos que con 1 caja descuadrada no
                        distingue lo que hay que mirar hoy de lo que puede
                        esperar al lunes.
                      */}
                      {a === "/alertas" && alertas.total > 0 ? (
                        <span
                          className={[
                            "fh-num grid h-[19px] min-w-[20px] place-items-center px-1 font-mono text-[11px] font-semibold",
                            alertas.criticas > 0 ? "bg-surface text-accent-ink" : "bg-shell-line-soft text-shell-text",
                          ].join(" ")}
                        >
                          {alertas.total}
                        </span>
                      ) : null}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="shrink-0 border-t border-shell-line p-4">
          <div className="text-[13px] font-bold text-surface">{usuario?.name}</div>
          <div className="text-[10.5px] uppercase tracking-[0.1em] text-shell-label">administrador</div>
          <Link
            to="/venta"
            onClick={() => fijarModo("pos")}
            className="mt-3 flex h-[42px] items-center justify-center border border-shell-border text-sm hover:bg-shell-hover"
          >
            Ir a vender
          </Link>
          <button onClick={salir} className="mt-2 w-full text-left text-xs text-shell-label hover:text-shell-text">
            Salir
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-baseline gap-3 border-b-2 border-ink bg-surface px-6">
          <h1 className="text-2xl font-black tracking-[-0.02em]">{titulo}</h1>
          {bajada ? <span className="text-[13px] text-ink-soft">{bajada}</span> : null}
          <div className="ml-auto flex items-center gap-4 self-center">
            {caja.abierta ? (
              <span className="flex items-center gap-2 border border-ok bg-ok/[0.08] px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-ok-ink">
                <span aria-hidden className="h-2 w-[7px] bg-current" />
                Caja abierta
              </span>
            ) : (
              <span className="flex items-center gap-2 border border-line-field bg-bg px-2 py-0.5 text-[10.5px] font-extrabold uppercase tracking-[0.1em] text-ink-soft">
                <span aria-hidden className="h-2 w-[7px] bg-current" />
                Caja cerrada
              </span>
            )}
            <span className="font-mono text-xs text-mono-ink">{fecha}</span>
          </div>
        </header>

        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-[22px]">
          <ConBarrera>{children}</ConBarrera>
        </main>
      </div>
    </div>
    </CascaronCtx.Provider>
  );
}
