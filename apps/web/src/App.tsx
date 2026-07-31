import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { AuthProvider, useAuth } from "@/lib/auth";
import { Login } from "@/pages/Login";
import { Dashboard } from "@/pages/Dashboard";
import { Alertas } from "@/pages/Alertas";
import { Catalogo } from "@/pages/Catalogo";
import { Caja } from "@/pages/Caja";
import { Venta } from "@/pages/Venta";
import { Kardex } from "@/pages/Kardex";
import { Reportes } from "@/pages/Reportes";
import { Compras } from "@/pages/Compras";
import { Usuarios } from "@/pages/Usuarios";
import { WhatsApp } from "@/pages/WhatsApp";
import { ProveedorNuevo } from "@/pages/ProveedorNuevo";
import { Devoluciones } from "@/pages/Devoluciones";
import { Estaciones } from "@/pages/Estaciones";
import { PosShell, AdminShell, leerModo } from "@/components/cascarones";

/**
 * Qué cascarón dibuja cada ruta (ADR 007).
 *
 * El vendedor siempre ve el POS: no tiene otro. Para el administrador hay tres
 * clases de ruta, y la tercera es la que obliga a que esto exista:
 *
 * - **Solo del mesón.** Vender y devolver se hacen de pie, con alguien al
 *   frente. Aunque las abra un administrador, se abren en el POS.
 * - **Solo del backoffice.** Panel, reportes, usuarios: no están en el riel y
 *   no tendría cómo volver de ellas.
 * - **De los dos.** Catálogo y Caja. El riel las llama «Buscar» y «Caja»; la
 *   barra lateral, «Catálogo» y «Caja y turnos». La misma ruta, dos maneras de
 *   mirarla, y cuál corresponde depende de dónde venía el administrador — eso
 *   es lo que guarda el modo.
 */
const SOLO_MESON = ["/venta", "/devoluciones"];
const COMPARTIDAS = ["/catalogo", "/caja"];

function cascaronDe(pathname: string, esAdmin: boolean): typeof PosShell {
  if (!esAdmin) return PosShell;
  if (SOLO_MESON.some((r) => pathname.startsWith(r))) return PosShell;
  if (COMPARTIDAS.some((r) => pathname.startsWith(r))) return leerModo() === "pos" ? PosShell : AdminShell;
  return AdminShell;
}

/** Guard por rol: el vendedor no ve las pantallas de admin (USR-03). */
function Privado({ children, soloAdmin = false }: { children: React.ReactNode; soloAdmin?: boolean }) {
  const { usuario, cargando } = useAuth();
  // `useLocation` y no `window.location`: el segundo no es reactivo, y elegir
  // el cascarón con un valor que React no observa es pedir que una navegación
  // deje la barra de la pantalla anterior.
  const { pathname } = useLocation();
  if (cargando) return <div className="grid min-h-screen place-items-center text-ink-soft">Cargando…</div>;
  if (!usuario) return <Navigate to="/login" replace />;
  if (soloAdmin && usuario.role !== "ADMIN") return <Navigate to="/" replace />;

  const Cascaron = cascaronDe(pathname, usuario.role === "ADMIN");
  return <Cascaron>{children}</Cascaron>;
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
            path="/alertas"
            element={
              <Privado soloAdmin>
                <Alertas />
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
            Sin ítem en la barra lateral: se toca al instalar y casi nunca más.
            Se llega desde Usuarios.
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
          {/*
            El kardex pasa a ser del administrador (ADR 007). El vendedor
            consulta saldo desde «Buscar», que es esta misma aplicación sin las
            columnas de plata; el LIBRO de movimientos —quién sacó qué y cuándo—
            es material de administración. Antes la ruta era compartida y el
            riel del POS ya no la ofrece: dejarla abierta significaría que se
            llega tecleando la URL, a una pantalla sin forma de volver.
          */}
          <Route
            path="/kardex"
            element={
              <Privado soloAdmin>
                <Kardex />
              </Privado>
            }
          />
          {/*
            Sin ítem en el menú: se llega desde el botón «+ nuevo» del
            formulario de producto, que la abre en una pestaña aparte para no
            hacer perder un producto a medio escribir.
          */}
          <Route
            path="/proveedores/nuevo"
            element={
              <Privado soloAdmin>
                <ProveedorNuevo />
              </Privado>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
