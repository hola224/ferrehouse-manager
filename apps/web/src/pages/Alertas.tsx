/**
 * Alertas (ADR 007).
 *
 * Antes vivían dentro del panel, y ahí competían con los cuatro números del
 * día: una lista larga convierte el panel en bandeja de entrada. Ahora el panel
 * muestra las tres más graves y el resto vive acá, con su filtro y —lo que el
 * panel no daba— **desde cuándo está abierta cada una**. Una alerta sin fecha
 * no deja saber si es de hoy o de hace tres semanas, que es exactamente la
 * diferencia entre atenderla y aprender a ignorarla.
 *
 * No hace falta endpoint nuevo: `GET /api/alerts` ya devuelve la lista entera
 * con su severidad. El filtro es de pantalla porque la lista es corta y pedirle
 * al servidor una consulta por pestaña sería tres viajes para no mostrar nada
 * que no estuviera ya en el primero.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Boton } from "@/components/ui";

type Severidad = "CRITICAL" | "WARNING" | "INFO";

type Alerta = {
  id: number | null;
  type: string;
  severity: Severidad;
  message: string;
  createdAt: string;
  ref: { tipo: "PRODUCTO" | "ESPERA"; id: number; texto: string } | null;
};

const FILTROS = [
  { clave: "todas", texto: "Todas" },
  { clave: "CRITICAL", texto: "Críticas" },
  { clave: "WARNING", texto: "Avisos" },
  { clave: "INFO", texto: "Info" },
] as const;

/** Sin esta tabla la pantalla muestra el nombre crudo del tipo, que es jerga de
 *  base de datos en la cara del administrador. */
const TIPO_TEXTO: Record<string, string> = {
  LOW_STOCK: "Stock bajo",
  OUT_OF_STOCK: "Quiebre",
  CASH_DIFFERENCE: "Diferencia de caja",
  STOCK_RECONCILE_DIFF: "Descuadre del libro",
  SUSPENDED_SALE_STALE: "Espera añeja",
  NO_ROTATION: "Sin rotación",
  BACKUP_STALE: "Respaldo atrasado",
  BACKUP_COPY: "Copia del respaldo",
};

const NIVEL: Record<Severidad, { palabra: string; clases: string }> = {
  // Superficie tintada, borde y LA PALABRA. Nunca rojo pleno: en esta interfaz
  // el rojo pleno significa "aprieta acá", y una alerta no se aprieta.
  CRITICAL: { palabra: "Crítica", clases: "border-accent bg-accent-tint text-accent-ink" },
  WARNING: { palabra: "Aviso", clases: "border-warn bg-warn/10 text-warn-ink" },
  INFO: { palabra: "Info", clases: "border-line-field bg-bg text-ink-soft" },
};

/**
 * «Desde cuándo», en las palabras en que se dice. No se usa la fecha entera
 * porque la pregunta que contesta esta línea no es «qué día fue» sino «¿esto
 * lleva mucho?».
 */
function desdeCuando(iso: string): string {
  const minutos = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutos < 60) return minutos <= 1 ? "recién" : `hace ${minutos} minutos`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return horas === 1 ? "hace 1 hora" : `hace ${horas} horas`;
  const dias = Math.round(horas / 24);
  if (dias < 7) return dias === 1 ? "ayer" : `hace ${dias} días`;
  const semanas = Math.round(dias / 7);
  return semanas === 1 ? "hace 1 semana" : `hace ${semanas} semanas`;
}

export function Alertas() {
  const [alertas, setAlertas] = useState<Alerta[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<(typeof FILTROS)[number]["clave"]>("todas");
  const [resolviendo, setResolviendo] = useState<number | null>(null);
  const [reconciliando, setReconciliando] = useState(false);
  const [reconciliacion, setReconciliacion] = useState<{ mensaje: string; divergencias: number } | null>(null);

  async function cargar() {
    try {
      const r = await api<{ alertas: Alerta[] }>("/alerts");
      setAlertas(r.alertas);
      setError(null);
    } catch {
      setError("No se pudieron traer las alertas.");
    }
  }

  useEffect(() => {
    void cargar();
  }, []);

  async function resolver(id: number) {
    setResolviendo(id);
    try {
      await api(`/alerts/${id}/resolve`, { method: "POST", body: "{}" });
      await cargar();
    } catch {
      setError("No se pudo marcar esa alerta.");
    } finally {
      setResolviendo(null);
    }
  }

  /**
   * La reconciliación vive acá y no en un menú de mantención escondido: su
   * resultado ES una alerta, y este es el lugar donde el administrador viene a
   * ver si algo anda mal.
   */
  async function reconciliar() {
    setReconciliando(true);
    try {
      const r = await api<{ mensaje: string; divergencias: number }>("/stock/reconcile", {
        method: "POST",
        body: "{}",
      });
      setReconciliacion(r);
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo reconciliar");
    } finally {
      setReconciliando(false);
    }
  }

  const cuenta = useMemo(() => {
    const t = { todas: alertas?.length ?? 0, CRITICAL: 0, WARNING: 0, INFO: 0 };
    for (const a of alertas ?? []) t[a.severity]++;
    return t;
  }, [alertas]);

  const visibles = (alertas ?? []).filter((a) => filtro === "todas" || a.severity === filtro);

  if (error && !alertas) {
    return (
      <div className="border-2 border-accent bg-accent-tint p-6">
        <p className="font-bold">{error}</p>
        <Boton className="mt-3" onClick={() => void cargar()}>
          Reintentar
        </Boton>
      </div>
    );
  }

  if (!alertas) return <p className="text-ink-soft">Cargando…</p>;

  return (
    <div className="max-w-5xl">
      <div className="mb-4 flex gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.clave}
            onClick={() => setFiltro(f.clave)}
            className={[
              "flex h-[38px] items-center gap-2 border px-4 text-sm font-semibold",
              filtro === f.clave
                ? "border-ink bg-ink text-surface"
                : "border-line-field bg-surface text-ink hover:bg-bg",
            ].join(" ")}
          >
            {f.texto}
            <span className="fh-num font-mono text-[11px] opacity-70">{cuenta[f.clave]}</span>
          </button>
        ))}
      </div>

      {error ? <p className="mb-3 text-sm text-accent-ink">{error}</p> : null}

      {visibles.length === 0 ? (
        <div className="border border-line bg-surface p-8 text-center">
          <p className="font-bold">
            {filtro === "todas" ? "No hay ninguna alerta abierta." : "Ninguna de esta clase."}
          </p>
          <p className="mt-1 text-sm text-ink-soft">
            {filtro === "todas"
              ? "La caja cuadró, el stock está sobre el mínimo y el respaldo está al día."
              : "Prueba con «Todas»."}
          </p>
        </div>
      ) : (
        <ul className="border border-line bg-surface">
          {visibles.map((a) => (
            <li
              key={a.id ?? `${a.type}-${a.ref?.id ?? "x"}`}
              className="flex items-start gap-4 border-b border-line-soft px-4 py-3 last:border-b-0"
            >
              <span
                className={`mt-0.5 w-[78px] shrink-0 border px-2 py-0.5 text-center text-[10px] font-extrabold uppercase tracking-[0.1em] ${NIVEL[a.severity].clases}`}
              >
                {NIVEL[a.severity].palabra}
              </span>

              <div className="min-w-0 flex-1">
                <p className="text-[14.5px]">{a.message}</p>
                <p className="mt-1 font-mono text-[11px] text-mono-ink">
                  {TIPO_TEXTO[a.type] ?? a.type} · abierta {desdeCuando(a.createdAt)}
                  {a.ref ? (
                    <>
                      {" · "}
                      {a.ref.tipo === "PRODUCTO" ? (
                        <Link to={`/kardex?producto=${a.ref.id}`} className="underline underline-offset-4">
                          {a.ref.texto}
                        </Link>
                      ) : (
                        a.ref.texto
                      )}
                    </>
                  ) : null}
                </p>
              </div>

              {/*
                Las acciones ocupan todas el mismo ancho: en una lista, una
                acción que cambia de tamaño fila por fila obliga a leerla en vez
                de barrerla.

                La acción se elige por TIPO, no por «no tiene id». Las derivadas
                ya son dos clases distintas —la espera añeja y el respaldo— y
                tratarlas por igual ponía un «Ver espera» debajo de «el respaldo
                se guarda en el mismo PC».
              */}
              <div className="w-28 shrink-0">
                {a.type.startsWith("BACKUP") ? (
                  <Link
                    to="/"
                    className="flex h-[34px] w-full items-center justify-center border border-line-field text-sm hover:bg-bg"
                  >
                    Ver respaldo
                  </Link>
                ) : a.ref?.tipo === "ESPERA" ? (
                  <Link
                    to="/venta"
                    className="flex h-[34px] w-full items-center justify-center border border-line-field text-sm hover:bg-bg"
                  >
                    Ver espera
                  </Link>
                ) : a.id !== null ? (
                  <button
                    onClick={() => void resolver(a.id!)}
                    disabled={resolviendo === a.id}
                    className="h-[34px] w-full border border-line-field text-sm hover:bg-bg disabled:opacity-40"
                  >
                    {resolviendo === a.id ? "…" : "Resolver"}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[12.5px] text-ink-soft">
        Las de stock se cierran solas cuando el producto vuelve a estar sobre su mínimo: no hay que acordarse de
        limpiarlas. Resolverlas a mano sirve para callarlas hasta el próximo movimiento de ese producto — «ya lo pedí».
        La de venta en espera no se resuelve marcándola: se resuelve cobrando la espera o descartándola. Marcar una
        alerta tampoco la borra: queda con su fecha de resuelta y sale de esta lista.
      </p>

      <div className="mt-6 border border-line bg-surface">
        <h2 className="border-b-2 border-ink px-[18px] py-[11px] text-xs font-extrabold uppercase tracking-[0.14em]">
          Libro de stock
        </h2>
        <div className="flex flex-wrap items-center gap-3 px-[18px] py-4 text-sm">
          <span className="flex-1 text-ink-soft">
            Compara el saldo guardado contra la suma del libro de movimientos, que es la verdad. Si no cuadran, corrige
            el saldo y deja una alerta por cada producto.
          </span>
          <Boton onClick={() => void reconciliar()} disabled={reconciliando}>
            {reconciliando ? "Revisando…" : "Revisar el libro"}
          </Boton>
        </div>
        {reconciliacion ? (
          <p
            className={`mx-[18px] mb-4 border p-3 text-sm ${
              reconciliacion.divergencias === 0
                ? "border-ok bg-ok/[0.08] text-ok-ink"
                : "border-accent bg-accent-tint text-accent-ink"
            }`}
          >
            {reconciliacion.mensaje}
          </p>
        ) : null}
      </div>
    </div>
  );
}
