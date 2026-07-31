import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Catalogo } from "@/pages/Catalogo";
import { Caja } from "@/pages/Caja";
import { Venta } from "@/pages/Venta";
import { Boton } from "@/components/ui";

function Layout({ children }: { children: React.ReactNode }) {
  const { usuario, salir } = useAuth();
  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-line bg-surface px-6 py-3">
        <div className="flex items-center gap-6">
          <Link to="/" className="text-lg font-black tracking-tight">
            Ferrehouse
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link to="/venta" className="font-semibold text-ink">
              Venta
            </Link>
            <Link to="/catalogo" className="text-ink-soft hover:text-ink">
              Catálogo
            </Link>
            <Link to="/caja" className="text-ink-soft hover:text-ink">
              Caja
            </Link>
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
      <main className="mx-auto max-w-6xl p-6">{children}</main>
    </div>
  );
}

/** Guard por rol: el vendedor no ve las pantallas de admin (USR-03). */
function Privado({ children, soloAdmin = false }: { children: React.ReactNode; soloAdmin?: boolean }) {
  const { usuario, cargando } = useAuth();
  if (cargando) return <div className="grid min-h-screen place-items-center text-ink-soft">Cargando…</div>;
  if (!usuario) return <Navigate to="/login" replace />;
  if (soloAdmin && usuario.role !== "ADMIN") return <Navigate to="/" replace />;
  return <Layout>{children}</Layout>;
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
          <Route
            path="/"
            element={
              <Privado>
                <Dashboard />
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
            path="/venta"
            element={
              <Privado>
                <Venta />
              </Privado>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
