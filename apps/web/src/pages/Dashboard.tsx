/**
 * Dashboard del administrador (tarea 5.7, UI-BRIEF §5.5).
 * Wireframe aprobado por Cristian el 2026-07-30: cuatro números arriba,
 * alertas abajo a lo ancho.
 *
 * **Cuatro datos y no cuarenta.** El brief lo pide así y la razón es que un
 * panel con veinte cifras no se mira: se mira el primer día y después se pasa
 * de largo. Los cuatro son los que cambian una decisión de hoy — cuánto se
 * vendió, cuánto de eso quedó, cómo está la caja y qué hay que reponer.
 *
 * **Al vendedor no le llega nada de esto y ni siquiera entra acá**: al iniciar
 * sesión va directo a Venta. No es solo el margen — tampoco la venta del día,
 * porque el arqueo es a ciegas y casi toda la venta es efectivo: decirle
 * cuánto se vendió es decirle cuánto debería tener el cajón.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Tarjeta } from "@/components/ui";

type Alerta = {
  id: number | null;
  type: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  message: string;
  createdAt: string;
  ref: { tipo: "PRODUCTO" | "ESPERA"; id: number; texto: string } | null;
};

type Panel = {
  rol: "ADMIN";
  tienda: string;
  estacion: string;
  productos: number;
  caja: { abierta: boolean; desde: string | null; saldo: number | null; saldoTexto: string | null };
  dia: {
    fecha: string;
    total: number;
    totalTexto: string;
    documentos: number;
    devoluciones: number;
    anulaciones: number;
    margen: number;
    margenTexto: string;
    margenPct: number | null;
  };
  alertas: { total: number; criticas: number; primeras: Alerta[] };
};

/**
 * El respaldo (tarea 7.2). Va abajo, en una línea, y no como un quinto número
 * grande: el brief pide cuatro datos y no cuarenta, y este no cambia ninguna
 * decisión del día — salvo cuando está mal, y entonces aparece arriba como
 * alerta.
 *
 * Pero se muestra SIEMPRE, aunque esté todo bien. Un respaldo del que solo se
 * habla cuando falla se parece demasiado a uno que no existe: la única forma de
 * confiar en él es verlo decir "hoy" todos los días.
 */
type Respaldo = {
  antiguedad: string;
  cantidad: number;
  carpeta: string;
  copia: { configurada: boolean; alDia: boolean; problema: string | null };
  ultimo: { archivo: string; bytes: number } | null;
};

/**
 * "Jueves 30 de julio": la fecha completa, que es la que uno dice en voz alta.
 *
 * `Intl` devuelve "jueves, 30 de julio" y en español esa coma no va — se la
 * saca. Es el mismo criterio que el resto de la aplicación: en pantalla nunca
 * aparece una fecha en formato de cable (2026-07-30).
 */
function fechaLarga(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  const texto = new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long" })
    .format(new Date(a!, m! - 1, d!))
    .replace(",", "");
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/**
 * Un número grande y su explicación debajo. La cifra en `fh-num` —tabular— y
 * en 40px, que es el mínimo para leerse de pie frente al mesón.
 *
 * **Baja a 32px cuando el número pasa de 9 caracteres.** A 40px, un sábado de
 * `$1.234.567` mide 236px dentro de una tarjeta que tiene 232px de espacio
 * útil: no se sale del borde, pero se come el padding y queda pegado al filo.
 * Los separadores de miles son puntos y no dan punto de corte, así que el
 * texto no se parte solo — sigue creciendo hacia afuera. Un millón de pesos en
 * un sábado no es un caso raro, y 1366×768 es el presupuesto que fija el
 * brief, no una aspiración.
 */
function Numerote({ valor, tono, children }: { valor: string; tono?: "ok" | "error"; children?: React.ReactNode }) {
  return (
    <div>
      <div
        className={`fh-num font-black leading-none ${valor.length > 9 ? "text-[2rem]" : "text-[2.5rem]"} ${
          tono === "error" ? "text-error" : tono === "ok" ? "text-ok" : ""
        }`}
      >
        {valor}
      </div>
      {children ? <div className="mt-2 text-sm text-ink-soft">{children}</div> : null}
    </div>
  );
}

export function Dashboard() {
  const { usuario } = useAuth();
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolviendo, setResolviendo] = useState<number | null>(null);
  const [respaldo, setRespaldo] = useState<Respaldo | null>(null);
  const [respaldando, setRespaldando] = useState(false);
  const [ultimoAviso, setUltimoAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      setPanel(await api<Panel>("/dashboard"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar el panel");
    }
    /*
     * En su propio `try`: que no se pueda leer la carpeta de respaldos no
     * puede dejar al administrador sin la venta del día.
     */
    try {
      setRespaldo(await api<Respaldo>("/backup"));
    } catch {
      setRespaldo(null);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function respaldarAhora() {
    setRespaldando(true);
    try {
      const r = await api<{ mensaje: string }>("/backup", { method: "POST", body: "{}" });
      setError(null);
      await cargar();
      // El mensaje del servidor dice si la copia externa salió o no.
      if (r.mensaje) setUltimoAviso(r.mensaje);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo respaldar");
    } finally {
      setRespaldando(false);
    }
  }

  async function resolver(id: number) {
    setResolviendo(id);
    try {
      await api(`/alerts/${id}/resolve`, { method: "POST", body: "{}" });
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo resolver la alerta");
    } finally {
      setResolviendo(null);
    }
  }

  if (error && !panel) return <p className="text-error">{error}</p>;
  if (!panel) return <p className="text-ink-soft">Cargando…</p>;

  const { dia, caja, alertas } = panel;

  return (
    <div className="grid gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-black tracking-tight">{fechaLarga(dia.fecha)}</h1>
        <span className="text-sm text-ink-soft">
          {usuario?.name} · {panel.estacion}
        </span>
      </div>

      {/* Los cuatro. En 1366×768 caben en una fila; más abajo se apilan. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tarjeta titulo="Venta del día">
          <Numerote valor={dia.totalTexto}>
            {dia.documentos === 0 ? (
              "Todavía no se vende nada hoy"
            ) : (
              <>
                {dia.documentos} {dia.documentos === 1 ? "documento" : "documentos"}
                {/*
                  Una anulación no es una devolución: el proyecto separa las
                  dos palabras en todas partes, y juntarlas acá obligaría a
                  llamarlas de una sola forma que estaría mal la mitad de las
                  veces.
                */}
                {dia.devoluciones > 0
                  ? ` · ${dia.devoluciones} ${dia.devoluciones === 1 ? "devolución" : "devoluciones"}`
                  : ""}
                {dia.anulaciones > 0
                  ? ` · ${dia.anulaciones} ${dia.anulaciones === 1 ? "anulación" : "anulaciones"}`
                  : ""}
              </>
            )}
          </Numerote>
        </Tarjeta>

        <Tarjeta titulo="Margen del día">
          {/*
            El margen negativo se pinta en rojo y no solo con el signo: es el
            número que hace levantar el teléfono al proveedor.
          */}
          <Numerote valor={dia.margenTexto} tono={dia.margen < 0 ? "error" : undefined}>
            {dia.margenPct === null ? "Sin ventas que medir" : `${dia.margenPct.toFixed(1).replace(".", ",")}% del neto`}
          </Numerote>
        </Tarjeta>

        <Tarjeta titulo="Caja">
          {caja.abierta ? (
            <Numerote valor={caja.saldoTexto ?? "—"}>
              <span className="text-ok">Abierta</span> desde las {caja.desde}
            </Numerote>
          ) : (
            <Numerote valor="Cerrada">
              <Link to="/caja" className="underline underline-offset-4">
                Abrir caja para empezar el turno
              </Link>
            </Numerote>
          )}
        </Tarjeta>

        <Tarjeta titulo="Alertas">
          <Numerote valor={String(alertas.total)} tono={alertas.criticas > 0 ? "error" : alertas.total === 0 ? "ok" : undefined}>
            {alertas.total === 0
              ? "Nada que mirar hoy"
              : alertas.criticas > 0
                ? `${alertas.criticas} ${alertas.criticas === 1 ? "crítica" : "críticas"}`
                : "Ninguna crítica"}
          </Numerote>
        </Tarjeta>
      </div>

      {alertas.total > 0 ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">Qué hay que mirar hoy</h2>
          <ul className="divide-y divide-line rounded-[var(--fh-radio)] border border-line bg-surface">
            {alertas.primeras.map((a) => (
              <li key={a.id ?? `${a.type}-${a.ref?.id}`} className="flex items-center gap-3 px-4 py-3">
                {/* Color Y forma: hay daltonismo en el mesón (UI-BRIEF §2.3). */}
                <span
                  aria-hidden
                  className={`w-3 shrink-0 text-center ${a.severity === "CRITICAL" ? "text-error" : "text-warn"}`}
                >
                  {a.severity === "CRITICAL" ? "●" : "▲"}
                </span>
                <span className="flex-1 text-sm">{a.message}</span>
                {a.ref?.tipo === "PRODUCTO" ? (
                  <Link
                    to={`/kardex?producto=${a.ref.id}`}
                    className="fh-num text-xs text-ink-soft underline underline-offset-4"
                  >
                    {a.ref.texto}
                  </Link>
                ) : null}
                {/*
                  Las dos acciones ocupan el mismo ancho y llevan el mismo
                  peso: en una lista, una acción que cambia de tamaño y de
                  posición fila por fila obliga a leerla en vez de barrerla.
                */}
                <div className="w-28 shrink-0 text-right">
                  {/*
                    La acción se elige por TIPO y no por «no tiene id».
                    Las derivadas ya son dos clases distintas —la espera añeja
                    y el respaldo— y tratarlas por igual ponía un «Ver espera»
                    que no lleva a ninguna parte debajo de «nunca se ha
                    respaldado la base».
                  */}
                  {a.type.startsWith("BACKUP") ? (
                    <button
                      onClick={() => void respaldarAhora()}
                      disabled={respaldando}
                      className="text-sm underline underline-offset-4 hover:text-ink disabled:opacity-40"
                    >
                      {respaldando ? "…" : "Respaldar"}
                    </button>
                  ) : a.id === null ? (
                    /*
                     * La de venta en espera añeja no se resuelve marcándola:
                     * se resuelve cobrando la espera o descartándola. Un botón
                     * que no cambia nada durable es peor que no tener botón.
                     */
                    <Link to="/venta" className="text-sm underline underline-offset-4">
                      Ver espera
                    </Link>
                  ) : (
                    <button
                      onClick={() => resolver(a.id!)}
                      disabled={resolviendo === a.id}
                      className="text-sm underline underline-offset-4 hover:text-ink disabled:opacity-40"
                    >
                      {resolviendo === a.id ? "…" : "Resolver"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-soft">
            {alertas.total > alertas.primeras.length
              ? `Se muestran las ${alertas.primeras.length} más graves de ${alertas.total}. `
              : ""}
            <Link to="/reportes?ver=alertas" className="underline underline-offset-4">
              Ver el panel completo
            </Link>
          </p>
        </section>
      ) : null}

      <section className="flex flex-wrap items-center gap-4 border-t border-line pt-4 text-sm">
        <span className="font-semibold uppercase tracking-wide text-ink-soft">Reportes</span>
        <Link to="/reportes" className="underline underline-offset-4">
          Ventas del día
        </Link>
        <Link to="/reportes?ver=margenes" className="underline underline-offset-4">
          Márgenes
        </Link>
        <Link to="/reportes?ver=inventario" className="underline underline-offset-4">
          Inventario valorizado
        </Link>
        {error ? <span className="text-error">{error}</span> : null}
      </section>

      <section className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4 text-sm">
        <span className="font-semibold uppercase tracking-wide text-ink-soft">Respaldo</span>
        {respaldo === null ? (
          <span className="text-ink-soft">No se pudo leer la carpeta de respaldos.</span>
        ) : (
          <>
            <span>
              Último: <span className="fh-num">{respaldo.antiguedad}</span>
            </span>
            <span className="text-ink-soft">
              {respaldo.cantidad} {respaldo.cantidad === 1 ? "guardado" : "guardados"}
            </span>
            {/*
              Sin copia afuera el respaldo protege del «borré algo sin querer»
              pero no del incendio ni del robo, que son los casos por los que
              uno respalda. Se dice acá aunque además sea una alerta: en el
              lugar donde uno mira el respaldo tiene que estar la verdad
              completa.
            */}
            <span className={respaldo.copia.alDia ? "text-ok" : "text-warn"}>
              {respaldo.copia.alDia
                ? "copia externa al día"
                : respaldo.copia.configurada
                  ? "copia externa atrasada"
                  : "solo en este PC"}
            </span>
            <button
              onClick={() => void respaldarAhora()}
              disabled={respaldando}
              className="underline underline-offset-4 hover:text-ink disabled:opacity-40"
            >
              {respaldando ? "Respaldando…" : "Respaldar ahora"}
            </button>
            {ultimoAviso ? <span className="text-ink-soft">{ultimoAviso}</span> : null}
          </>
        )}
      </section>
    </div>
  );
}
