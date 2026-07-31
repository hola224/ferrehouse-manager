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
import { Acciones, Boton, Campo, Chip, Modal, Tarjeta } from "@/components/ui";
import { formatCLP, formatHora } from "@ferrehouse/shared";

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
/** Lo que trae `/sales` para el panel: las de hoy, más nuevas primero. */
type VentaDelDia = {
  id: number;
  createdAt: string;
  totalGross: number;
  user: { name: string };
  etiquetaTexto: string;
  etiquetaTono: "ok" | "warn" | "error" | "neutral";
};

type Respaldo = {
  antiguedad: string;
  cantidad: number;
  carpeta: string;
  copia: { configurada: boolean; carpeta: string | null; alDia: boolean; problema: string | null };
  ultimo: { archivo: string; bytes: number } | null;
};

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
        className={`fh-num font-black leading-none tracking-[-0.03em] ${
          valor.length > 9 ? "text-[34px]" : "text-[40px]"
        } ${tono === "error" ? "text-accent-ink" : tono === "ok" ? "text-ok-ink" : ""}`}
      >
        {valor}
      </div>
      {children ? <div className="mt-2 text-[12.5px] text-ink-soft">{children}</div> : null}
    </div>
  );
}

export function Dashboard() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolviendo, setResolviendo] = useState<number | null>(null);
  const [respaldo, setRespaldo] = useState<Respaldo | null>(null);
  const [respaldando, setRespaldando] = useState(false);
  const [ultimoAviso, setUltimoAviso] = useState<string | null>(null);
  const [configurando, setConfigurando] = useState(false);
  const [ventas, setVentas] = useState<VentaDelDia[] | null>(null);

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
    /*
     * Las últimas ventas van en su propia consulta y en su propio `try` por lo
     * mismo: son contexto, no el dato por el que se abre el panel.
     */
    try {
      setVentas((await api<{ ventas: VentaDelDia[] }>("/sales")).ventas);
    } catch {
      setVentas([]);
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
      {/*
        Sin encabezado propio: la barra del `AdminShell` ya trae el título y la
        fecha. Repetirlos acá empujaba los cuatro números hacia abajo, que es
        justo lo que esta pantalla no puede permitirse — se mira de reojo.
      */}

      {/* Los cuatro. En 1366×768 caben en una fila; más abajo se apilan. */}
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
        <Tarjeta titulo="Venta del día" borde="ink">
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

        <Tarjeta titulo="Margen del día" borde="ink">
          {/*
            El margen negativo se pinta en rojo y no solo con el signo: es el
            número que hace levantar el teléfono al proveedor.
          */}
          <Numerote valor={dia.margenTexto} tono={dia.margen < 0 ? "error" : undefined}>
            {dia.margenPct === null ? "Sin ventas que medir" : `${dia.margenPct.toFixed(1).replace(".", ",")}% del neto`}
          </Numerote>
        </Tarjeta>

        <Tarjeta titulo="Caja" borde={caja.abierta ? "ok" : "ink"}>
          {caja.abierta ? (
            <Numerote valor={caja.saldoTexto ?? "—"}>
              <span className="text-ok-ink">Abierta</span> desde las {caja.desde}
            </Numerote>
          ) : (
            <Numerote valor="Cerrada">
              <Link to="/caja" className="underline underline-offset-4">
                Abrir caja para empezar el turno
              </Link>
            </Numerote>
          )}
        </Tarjeta>

        <Tarjeta titulo="Alertas" borde={alertas.total > 0 ? "accent" : "ink"}>
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
        <section className="border border-line bg-surface">
          <div className="flex items-center justify-between border-b-2 border-ink px-[18px] py-[11px]">
            <h2 className="text-xs font-extrabold uppercase tracking-[0.14em]">Qué hay que mirar hoy</h2>
            {/*
              Solo las TRES más graves, y el resto detrás de este enlace. No es
              una omisión: el panel es de cuatro números, y una lista larga acá
              lo convierte en bandeja de entrada — se deja de mirar entera.
            */}
            <Link to="/alertas" className="text-[12.5px] underline underline-offset-4">
              {alertas.total === 1 ? "Ver la alerta" : `Ver las ${alertas.total} alertas`}
            </Link>
          </div>
          <ul>
            {alertas.primeras.map((a) => (
              <li
                key={a.id ?? `${a.type}-${a.ref?.id}`}
                className="flex items-center gap-4 border-b border-line-soft px-[18px] py-3 last:border-b-0"
              >
                {/*
                  La PALABRA del nivel, no un punto de color: hay daltonismo en
                  el mesón, y «CRÍTICA» se lee también en la fotocopia del
                  arqueo. Ancho fijo para poder barrer la columna sin leerla.
                */}
                <span
                  className={`w-[78px] shrink-0 border px-2 py-0.5 text-center text-[10px] font-extrabold uppercase tracking-[0.1em] ${
                    a.severity === "CRITICAL"
                      ? "border-accent bg-accent-tint text-accent-ink"
                      : a.severity === "WARNING"
                        ? "border-warn bg-warn/10 text-warn-ink"
                        : "border-line-field bg-bg text-ink-soft"
                  }`}
                >
                  {a.severity === "CRITICAL" ? "Crítica" : a.severity === "WARNING" ? "Aviso" : "Info"}
                </span>
                <span className="flex-1 text-[14.5px]">{a.message}</span>
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
                <div className="w-28 shrink-0">
                  {/*
                    La acción se elige por TIPO y no por «no tiene id».
                    Las derivadas ya son dos clases distintas —la espera añeja
                    y el respaldo— y tratarlas por igual ponía un «Ver espera»
                    que no lleva a ninguna parte debajo de «nunca se ha
                    respaldado la base».
                  */}
                  {a.type === "BACKUP_COPY" && !respaldo?.copia.configurada ? (
                    /*
                     * Acá NO va «Respaldar»: respaldar de nuevo deja el archivo
                     * en el mismo PC, que es exactamente lo que la alerta dice
                     * que está mal. La acción que la cierra es elegir dónde se
                     * copia.
                     */
                    <button
                      onClick={() => setConfigurando(true)}
                      className="h-[34px] w-full border border-line-field text-sm hover:bg-bg"
                    >
                      Configurar
                    </button>
                  ) : a.type.startsWith("BACKUP") ? (
                    <button
                      onClick={() => void respaldarAhora()}
                      disabled={respaldando}
                      className="h-[34px] w-full border border-line-field text-sm hover:bg-bg disabled:opacity-40"
                    >
                      {respaldando ? "…" : "Respaldar"}
                    </button>
                  ) : a.id === null ? (
                    /*
                     * La de venta en espera añeja no se resuelve marcándola:
                     * se resuelve cobrando la espera o descartándola. Un botón
                     * que no cambia nada durable es peor que no tener botón.
                     */
                    <Link
                      to="/venta"
                      className="flex h-[34px] w-full items-center justify-center border border-line-field text-sm hover:bg-bg"
                    >
                      Ver espera
                    </Link>
                  ) : (
                    <button
                      onClick={() => resolver(a.id!)}
                      disabled={resolviendo === a.id}
                      className="h-[34px] w-full border border-line-field text-sm hover:bg-bg disabled:opacity-40"
                    >
                      {resolviendo === a.id ? "…" : "Resolver"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {alertas.total > alertas.primeras.length ? (
            <p className="border-t border-line-soft px-[18px] py-2 text-[12.5px] text-ink-soft">
              Se muestran las {alertas.primeras.length} más graves de {alertas.total}.
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Dos columnas: lo que pasó hoy, y si está respaldado. */}
      <div className="grid gap-3.5 lg:grid-cols-[1.2fr_1fr]">
        <Tarjeta titulo="Últimas ventas">
          {ventas === null ? (
            <p className="text-sm text-ink-soft">Cargando…</p>
          ) : ventas.length === 0 ? (
            <p className="text-sm text-ink-soft">Todavía no se vende nada hoy.</p>
          ) : (
            <ul className="-mx-[18px] -my-4">
              {ventas.slice(0, 5).map((v) => (
                <li key={v.id}>
                  <Link
                    to={`/devoluciones?venta=${v.id}`}
                    className="flex items-center gap-3 border-b border-line-soft px-[18px] py-2 text-sm last:border-b-0 hover:bg-bg"
                  >
                    <span className="fh-num w-12 font-mono text-[12.5px] text-mono-ink">#{v.id}</span>
                    <span className="fh-num w-12 font-mono text-[12.5px] text-mono-ink">{formatHora(v.createdAt)}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-soft">{v.user.name}</span>
                    <Chip tono={v.etiquetaTono}>{v.etiquetaTexto}</Chip>
                    <span className="fh-num w-24 text-right font-semibold">{formatCLP(v.totalGross)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Tarjeta>

        <Tarjeta titulo="Respaldo">
          {respaldo === null ? (
            <p className="text-sm text-ink-soft">No se pudo leer la carpeta de respaldos.</p>
          ) : (
            <>
              <div className="fh-num text-[34px] font-black leading-none tracking-[-0.02em]">{respaldo.antiguedad}</div>
              <div className="mt-1 text-[12.5px] text-ink-soft">
                {respaldo.cantidad} {respaldo.cantidad === 1 ? "guardado" : "guardados"}
              </div>
              {/*
                Sin copia afuera el respaldo protege del «borré algo sin querer»
                pero no del incendio ni del robo, que son los casos por los que
                uno respalda. Se dice acá aunque además sea una alerta: en el
                lugar donde uno mira el respaldo tiene que estar la verdad
                completa. Color Y palabra.
              */}
              <div className="mt-3">
                <Chip tono={respaldo.copia.alDia ? "ok" : respaldo.copia.configurada ? "warn" : "error"}>
                  {respaldo.copia.alDia
                    ? "copia externa al día"
                    : respaldo.copia.configurada
                      ? "copia externa atrasada"
                      : "solo en este PC"}
                </Chip>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {/*
                  «Configurar» va en rojo cuando NO hay copia externa: es la
                  acción que cierra la alerta, y respaldar otra vez solo deja
                  otro archivo en el mismo PC que se puede perder.
                */}
                <Boton
                  variante={respaldo.copia.configurada ? "secundaria" : "principal"}
                  onClick={() => setConfigurando(true)}
                >
                  {respaldo.copia.configurada ? "Cambiar dónde se copia" : "Configurar la copia"}
                </Boton>
                <Boton onClick={() => void respaldarAhora()} disabled={respaldando}>
                  {respaldando ? "Respaldando…" : "Respaldar ahora"}
                </Boton>
              </div>
              {ultimoAviso ? <p className="mt-3 text-[12.5px] text-ink-soft">{ultimoAviso}</p> : null}
            </>
          )}
        </Tarjeta>
      </div>

      {error ? <p className="border border-accent bg-accent-tint p-3 text-sm text-accent-ink">{error}</p> : null}

      {configurando ? (
        <CopiaExterna
          actual={respaldo?.copia.carpeta ?? ""}
          onCerrar={() => setConfigurando(false)}
          onListo={async (mensaje) => {
            setConfigurando(false);
            setUltimoAviso(mensaje);
            await cargar();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Dónde se copia el respaldo.
 *
 * Un solo campo, y la explicación arriba en vez de abajo: el que abre esto no
 * sabe qué escribir, y "E:\Respaldos" dicho como ejemplo enseña más que
 * cualquier etiqueta. El servidor valida escribiendo de verdad en esa carpeta,
 * así que un pendrive que no está puesto se rechaza acá y no dentro de doce
 * horas.
 */
function CopiaExterna({
  actual,
  onCerrar,
  onListo,
}: {
  actual: string;
  onCerrar: () => void;
  onListo: (mensaje: string) => Promise<void>;
}) {
  const [carpeta, setCarpeta] = useState(actual);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const r = await api<{ mensaje: string }>("/backup/copia", {
        method: "PUT",
        body: JSON.stringify({ carpeta: carpeta.trim() }),
      });
      await onListo(r.mensaje);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar");
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo="Dónde se copia el respaldo"
      bajada={
        <>
          El respaldo se guarda siempre en este PC. Si además se copia a un pendrive o a una carpeta de la nube,
          sobrevive a que el equipo se pierda, se lo roben o se le queme el disco — que son los casos por los que uno
          respalda.
        </>
      }
      onCerrar={onCerrar}
    >
      <div className="grid gap-4">
        <Campo
          etiqueta="Carpeta"
          value={carpeta}
          autoFocus
          onChange={(e) => setCarpeta(e.target.value)}
          placeholder="E:\Respaldos Ferrehouse"
        />
        <p className="text-sm text-ink-soft">
          Déjala vacía para no copiar a ninguna parte. Se prueba escribiendo un archivo ahí mismo: si el pendrive no
          está conectado, te lo digo ahora.
        </p>
        {error ? <p className="text-sm text-error">{error}</p> : null}
        <Acciones>
          <Boton variante="secundaria" onClick={onCerrar} type="button">
            Cancelar
          </Boton>
          <Boton variante="principal" onClick={() => void guardar()} disabled={guardando} type="button">
            {guardando ? "Probando…" : "Guardar"}
          </Boton>
        </Acciones>
      </div>
    </Modal>
  );
}
