import { Component, type ReactNode } from "react";
import { BrowserRouter, Routes, Route, Navigate, Link, NavLink, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Catalogo } from "@/pages/Catalogo";
import { Caja } from "@/pages/Caja";
import { Venta } from "@/pages/Venta";
import { Kardex } from "@/pages/Kardex";
import { Reportes } from "@/pages/Reportes";
import { Compras } from "@/pages/Compras";
import { Usuarios } from "@/pages/Usuarios";
import { WhatsApp } from "@/pages/WhatsApp";
import { Devoluciones } from "@/pages/Devoluciones";
import { Estaciones } from "@/pages/Estaciones";
import { Boton } from "@/components/ui";

function Layout({ children }: { children: React.ReactNode }) {
  const { usuario, salir } = useAuth();
  const esAdmin = usuario?.role === "ADMIN";
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-line bg-surface px-6 py-3">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-lg font-black tracking-tight">
            Ferrehouse
          </Link>
          {/*
            La pestaña activa se marca con `NavLink`, no con una clase fija.
            Antes "Venta" estaba en negrita siempre: en el kardex la barra decía
            que uno estaba en Venta. Una pantalla que miente sobre dónde estás
            es peor que una sin marca de activo.
          */}
          <nav className="flex gap-4 text-sm">
            {[
              { a: "/venta", texto: "Venta" },
              { a: "/catalogo", texto: "Catálogo" },
              { a: "/caja", texto: "Caja" },
              // Devolver es tarea de mesón, no de administración: la hace
              // quien atiende, con el PIN de un administrador al lado.
              { a: "/devoluciones", texto: "Devoluciones" },
              { a: "/kardex", texto: "Kardex" },
              // El panel y los reportes solo para el administrador: al
              // vendedor no le viaja ninguna cifra de plata del día, así que
              // ofrecerle la pestaña sería ofrecerle una pantalla vacía.
              ...(esAdmin
                ? [
                    { a: "/compras", texto: "Compras" },
                    { a: "/", texto: "Panel" },
                    { a: "/reportes", texto: "Reportes" },
                    { a: "/whatsapp", texto: "WhatsApp" },
                    { a: "/usuarios", texto: "Usuarios" },
                  ]
                : []),
            ].map((i) => (
              <NavLink
                key={i.a}
                to={i.a}
                end={i.a === "/"}
                className={({ isActive }) =>
                  isActive ? "font-semibold text-ink underline underline-offset-8" : "text-ink-soft hover:text-ink"
                }
              >
                {i.texto}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-ink-soft">
            {usuario?.name} · {usuario?.role === "ADMIN" ? "administrador" : "vendedor"}
          </span>
          <Boton variante="fantasma" onClick={salir}>
            Salir
          </Boton>
        </div>
      </header>
      {/*
        La barrera va DENTRO del layout, no afuera: si una pantalla se cae, la
        barra de arriba sigue ahí y con ella la forma de irse a otra parte. Una
        barrera que envuelve todo deja la aplicación en blanco, que es
        exactamente lo que hay que evitar.
      */}
      <main className="mx-auto max-w-6xl p-6">
        <ConBarrera>{children}</ConBarrera>
      </main>
    </div>
  );
}

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
 * No arregla el error: lo contiene. La barra de navegación sobrevive, el
 * vendedor se va a otra pantalla y sigue trabajando, y el detalle técnico queda
 * en la consola para quien lo pueda leer. La pantalla dice qué hacer, no qué
 * pasó (principio 5 del brief).
 *
 * Se remonta al cambiar de ruta (la `key` con el pathname), porque si no, irse
 * a otra pantalla dejaría la barrera puesta y ninguna cargaría.
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
      <div className="rounded-[var(--fh-radio)] border border-error/40 bg-error/10 p-8 text-center">
        <p className="text-lg font-semibold">Esta pantalla se cayó.</p>
        <p className="mt-2 text-ink-soft">
          Lo que estabas haciendo acá se perdió, pero nada de lo ya cobrado se pierde nunca. Anda a otra pantalla desde
          el menú de arriba y vuelve a entrar.
        </p>
        <button
          onClick={() => this.setState({ cayo: false })}
          className="mt-4 underline underline-offset-4 hover:text-ink"
        >
          Intentar de nuevo
        </button>
      </div>
    );
  }
}

function ConBarrera({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return <Barrera key={pathname}>{children}</Barrera>;
}

/** Guard por rol: el vendedor no ve las pantallas de admin (USR-03). */
function Privado({ children, soloAdmin = false }: { children: React.ReactNode; soloAdmin?: boolean }) {
  const { usuario, cargando } = useAuth();
  if (cargando) return <div className="grid min-h-screen place-items-center text-ink-soft">Cargando…</div>;
  if (!usuario) return <Navigate to="/login" replace />;
  if (soloAdmin && usuario.role !== "ADMIN") return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
}

function Inicio() {
  const { usuario } = useAuth();
  return usuario?.role === "ADMIN" ? <Dashboard /> : <Navigate to="/venta" replace />;
}

function Entrada() {
  const { usuario, cargando } = useAuth();
  if (cargando) return <div className="grid min-h-screen place-items-center text-ink-soft">Cargando…</div>;
  return usuario ? <Navigate to="/" replace /> : <Login />;
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Entrada />} />
          {/*
            El vendedor entra directo a Venta (decidido con Cristian el
            2026-07-30): es lo que abre el 100% de las veces, y su panel no
            tendría ninguna cifra que mostrarle.
          */}
          <Route
            path="/"
            element={
              <Privado>
                <Inicio />
              </Privado>
            }
          />
          <Route
            path="/compras"
            element={
              <Privado soloAdmin>
                <Compras />
              </Privado>
            }
          />
          {/*
            Sin pestaña en el menú: se toca al instalar y casi nunca más, y una
            pestaña permanente para eso es ruido en una barra que el vendedor
            mira todo el día. Se llega desde Usuarios.
          */}
          <Route
            path="/estaciones"
            element={
              <Privado soloAdmin>
                <Estaciones />
              </Privado>
            }
          />
          <Route
            path="/usuarios"
            element={
              <Privado soloAdmin>
                <Usuarios />
              </Privado>
            }
          />
          <Route
            path="/reportes"
            element={
              <Privado soloAdmin>
                <Reportes />
              </Privado>
            }
          />
          <Route
            path="/whatsapp"
            element={
              <Privado soloAdmin>
                <WhatsApp />
              </Privado>
            }
          />
          <Route
            path="/catalogo"
            element={
              <Privado>
                <Catalogo />
              </Privado>
            }
          />
          <Route
            path="/caja"
            element={
              <Privado>
                <Caja />
              </Privado>
            }
          />
          <Route
            path="/devoluciones"
            element={
              <Privado>
                <Devoluciones />
              </Privado>
            }
          />
          <Route
            path="/venta"
            element={
              <Privado>
                <Venta />
              </Privado>
            }
          />
          <Route
            path="/kardex"
            element={
              <Privado>
                <Kardex />
              </Privado>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
