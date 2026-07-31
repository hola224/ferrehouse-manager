/**
 * Reportes (tareas 5.1 a 5.4). Solo administrador.
 *
 * Tres cortes de los mismos días, en una sola pantalla con pestañas y no en
 * tres menús: quien mira el total del día quiere después ver de qué producto
 * salió, y hacerlo volver al menú es perder el rango que acababa de elegir.
 *
 * LAS ADVERTENCIAS VAN EN PANTALLA, no en la documentación. Tres números de
 * acá se pueden leer mal si uno no sabe cómo se calcularon —el PMP es global
 * al producto, la devolución le resta al que la atendió, la categoría es la
 * de hoy— y una nota al pie cuesta una línea y evita una decisión equivocada.
 */
import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Boton, Campo, Tarjeta } from "@/components/ui";
import { formatCLP, formatCostoMilli } from "@ferrehouse/shared";

type Ver = "ventas" | "margenes" | "inventario" | "alertas";

type Ventas = {
  desde: string;
  hasta: string;
  documentos: number;
  devoluciones: number;
  total: number;
  totalTexto: string;
  neto: number;
  iva: number;
  margen: number;
  margenPct: number | null;
  descuentos: number;
  redondeos: number;
  porMedio: Array<{ metodo: string; etiqueta: string; monto: number; montoTexto: string; operaciones: number }>;
  porVendedor: Array<{ userId: number; nombre: string; monto: number; montoTexto: string; documentos: number; margen: number }>;
  folios: {
    sinFolio: number;
    series: Array<{
      tipo: string;
      documentos: number;
      desde: number | null;
      hasta: number | null;
      huecos: number[];
      duplicados: Array<{ folio: number; veces: number }>;
      noNumericos: string[];
    }>;
  };
};

type Margenes = {
  por: "producto" | "categoria";
  filas: Array<{
    id: number | null;
    etiqueta: string;
    detalle: string;
    cantidad: string | null;
    neto: number;
    netoTexto: string;
    costo: number;
    margen: number;
    margenTexto: string;
    margenPct: number | null;
  }>;
  neto: number;
  margen: number;
  margenPct: number | null;
};

type Inventario = {
  fecha: string;
  filas: Array<{
    productId: number;
    sku: string;
    name: string;
    categoria: string;
    cantidad: string;
    qtyBaseMilli: number;
    valorNeto: number;
    valorNetoTexto: string;
    costoMilli: number | null;
  }>;
  total: number;
  totalTexto: string;
  bajoCero: number;
  productos: number;
};

const PESTANAS: Array<{ clave: Ver; texto: string }> = [
  { clave: "ventas", texto: "Ventas" },
  { clave: "margenes", texto: "Márgenes" },
  { clave: "inventario", texto: "Inventario valorizado" },
  { clave: "alertas", texto: "Alertas" },
];

type Alerta = {
  id: number | null;
  type: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  message: string;
  createdAt: string;
  ref: { tipo: "PRODUCTO" | "ESPERA"; id: number; texto: string } | null;
};

const TIPO_TEXTO: Record<string, string> = {
  LOW_STOCK: "Stock bajo",
  OUT_OF_STOCK: "Quiebre",
  CASH_DIFFERENCE: "Diferencia de caja",
  STOCK_RECONCILE_DIFF: "Descuadre del libro",
  SUSPENDED_SALE_STALE: "Espera añeja",
  NO_ROTATION: "Sin rotación",
};

/** "30 de julio de 2026". En pantalla nunca va una fecha en formato de cable. */
function fechaTexto(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(a!, m! - 1, d!),
  );
}

function hoyTexto(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1).replace(".", ",")}%`);

/** Nota al pie: lo que hay que saber para no leer mal el número de arriba. */
function Nota({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-xs leading-relaxed text-ink-soft">{children}</p>;
}

export function Reportes() {
  const [params, setParams] = useSearchParams();
  const ver = (PESTANAS.find((p) => p.clave === params.get("ver"))?.clave ?? "ventas") as Ver;

  const [desde, setDesde] = useState(hoyTexto());
  const [hasta, setHasta] = useState(hoyTexto());
  const [por, setPor] = useState<"producto" | "categoria">("producto");

  const [ventas, setVentas] = useState<Ventas | null>(null);
  const [margenes, setMargenes] = useState<Margenes | null>(null);
  const [inventario, setInventario] = useState<Inventario | null>(null);
  const [alertas, setAlertas] = useState<{ alertas: Alerta[]; criticas: number } | null>(null);
  const [resolviendo, setResolviendo] = useState<number | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      if (ver === "ventas") setVentas(await api<Ventas>(`/reports/sales?desde=${desde}&hasta=${hasta}`));
      else if (ver === "margenes")
        setMargenes(await api<Margenes>(`/reports/margins?desde=${desde}&hasta=${hasta}&por=${por}`));
      else if (ver === "inventario") setInventario(await api<Inventario>(`/reports/inventory?fecha=${hasta}`));
      else setAlertas(await api<{ alertas: Alerta[]; criticas: number }>("/alerts"));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar el reporte");
    } finally {
      setCargando(false);
    }
  }, [ver, desde, hasta, por]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-black tracking-tight">Reportes</h1>

      <div className="flex flex-wrap items-end gap-4">
        <nav className="flex gap-2">
          {PESTANAS.map((p) => (
            <Boton
              key={p.clave}
              variante={p.clave === ver ? "principal" : "secundaria"}
              onClick={() => setParams(p.clave === "ventas" ? {} : { ver: p.clave })}
            >
              {p.texto}
            </Boton>
          ))}
        </nav>
        <div className={`flex items-end gap-2 ${ver === "alertas" ? "hidden" : ""}`}>
          {ver !== "inventario" ? (
            <Campo etiqueta="Desde" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          ) : null}
          <Campo
            etiqueta={ver === "inventario" ? "A la fecha" : "Hasta"}
            type="date"
            value={hasta}
            onChange={(e) => setHasta(e.target.value)}
          />
        </div>
      </div>

      {error ? <p className="text-error">{error}</p> : null}
      {cargando ? <p className="text-ink-soft">Cargando…</p> : null}

      {/* ---------------- Ventas (5.1) y folios (5.4) ---------------- */}
      {ver === "ventas" && ventas ? (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tarjeta titulo="Total">
              <div className="fh-num text-3xl font-black">{ventas.totalTexto}</div>
              <div className="mt-1 text-sm text-ink-soft">
                {ventas.documentos} documentos · {ventas.devoluciones} de reversa
              </div>
            </Tarjeta>
            <Tarjeta titulo="Neto e IVA">
              <div className="fh-num text-xl font-bold">{formatCLP(ventas.neto)}</div>
              <div className="text-sm text-ink-soft">+ {formatCLP(ventas.iva)} de IVA</div>
            </Tarjeta>
            <Tarjeta titulo="Margen">
              <div className={`fh-num text-xl font-bold ${ventas.margen < 0 ? "text-error" : ""}`}>
                {formatCLP(ventas.margen)}
              </div>
              <div className="text-sm text-ink-soft">{pct(ventas.margenPct)} del neto</div>
            </Tarjeta>
            <Tarjeta titulo="Ajustes">
              <div className="text-sm">
                Descuentos <span className="fh-num">{formatCLP(ventas.descuentos)}</span>
              </div>
              <div className="text-sm">
                Redondeo <span className="fh-num">{formatCLP(ventas.redondeos)}</span>
              </div>
            </Tarjeta>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Tarjeta titulo="Por medio de pago">
              <table className="w-full text-sm">
                <tbody>
                  {ventas.porMedio.map((m) => (
                    <tr key={m.metodo} className="border-t border-line first:border-0">
                      <td className="py-1.5">{m.etiqueta}</td>
                      <td className="py-1.5 text-right text-ink-soft">{m.operaciones}</td>
                      <td className="fh-num py-1.5 text-right font-semibold">{m.montoTexto}</td>
                    </tr>
                  ))}
                  {ventas.porMedio.length === 0 ? <tr><td className="py-1.5 text-ink-soft">Sin pagos en el rango</td></tr> : null}
                </tbody>
              </table>
            </Tarjeta>

            <Tarjeta titulo="Por vendedor">
              <table className="w-full text-sm">
                <tbody>
                  {ventas.porVendedor.map((v) => (
                    <tr key={v.userId} className="border-t border-line first:border-0">
                      <td className="py-1.5">{v.nombre}</td>
                      <td className="py-1.5 text-right text-ink-soft">{v.documentos} doc.</td>
                      <td className="fh-num py-1.5 text-right font-semibold">{v.montoTexto}</td>
                    </tr>
                  ))}
                  {ventas.porVendedor.length === 0 ? <tr><td className="py-1.5 text-ink-soft">Sin ventas en el rango</td></tr> : null}
                </tbody>
              </table>
              <Nota>
                Una devolución le resta a quien la atendió, no a quien vendió: se suman todas las filas del día, y la
                nota de crédito es una fila propia.
              </Nota>
            </Tarjeta>
          </div>

          <Tarjeta titulo="Cuadratura de folios">
            {ventas.folios.series.length === 0 ? (
              <p className="text-sm text-ink-soft">Ninguna venta del rango lleva documento tributario.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-ink-soft">
                  <tr>
                    <th className="pb-2">Serie</th>
                    <th className="pb-2">Desde</th>
                    <th className="pb-2">Hasta</th>
                    <th className="pb-2">Huecos</th>
                    <th className="pb-2">Repetidos</th>
                  </tr>
                </thead>
                <tbody>
                  {ventas.folios.series.map((s) => (
                    <tr key={s.tipo} className="border-t border-line">
                      <td className="py-1.5">{s.tipo}</td>
                      <td className="fh-num py-1.5">{s.desde ?? "—"}</td>
                      <td className="fh-num py-1.5">{s.hasta ?? "—"}</td>
                      <td className={`fh-num py-1.5 ${s.huecos.length ? "text-error font-semibold" : "text-ink-soft"}`}>
                        {s.huecos.length ? s.huecos.join(", ") : "ninguno"}
                      </td>
                      <td className={`fh-num py-1.5 ${s.duplicados.length ? "text-error font-semibold" : "text-ink-soft"}`}>
                        {s.duplicados.length ? s.duplicados.map((d) => `${d.folio} (×${d.veces})`).join(", ") : "ninguno"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Nota>
              Cada tipo de documento numera aparte, así que la boleta 120 y la factura 120 no son un repetido. Solo se
              buscan huecos entre el primer folio y el último del rango elegido.
              {ventas.folios.sinFolio > 0 ? ` ${ventas.folios.sinFolio} venta(s) sin documento tributario.` : ""}
            </Nota>
          </Tarjeta>
        </div>
      ) : null}

      {/* ---------------- Márgenes (5.2) ---------------- */}
      {ver === "margenes" && margenes ? (
        <div className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {(["producto", "categoria"] as const).map((p) => (
              <Boton key={p} variante={por === p ? "principal" : "secundaria"} onClick={() => setPor(p)}>
                {p === "producto" ? "Por producto" : "Por categoría"}
              </Boton>
            ))}
            <span className="ml-auto text-sm text-ink-soft">
              Neto <span className="fh-num font-semibold text-ink">{formatCLP(margenes.neto)}</span> · Margen{" "}
              <span className="fh-num font-semibold text-ink">{formatCLP(margenes.margen)}</span> ({pct(margenes.margenPct)})
            </span>
          </div>

          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr className="border-b border-line">
                <th className="pb-2">{por === "producto" ? "Producto" : "Categoría"}</th>
                <th className="pb-2">Cantidad</th>
                <th className="pb-2 text-right">Venta neta</th>
                <th className="pb-2 text-right">Costo</th>
                <th className="pb-2 text-right">Margen</th>
                <th className="pb-2 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {margenes.filas.map((f) => (
                <tr key={`${f.id}-${f.etiqueta}`} className="border-b border-line/60">
                  <td className="py-2">
                    <div className="font-medium">{f.etiqueta}</div>
                    {f.detalle ? <div className="fh-num text-xs text-ink-soft">{f.detalle}</div> : null}
                  </td>
                  <td className="fh-num py-2 text-ink-soft">{f.cantidad ?? "—"}</td>
                  <td className="fh-num py-2 text-right">{f.netoTexto}</td>
                  <td className="fh-num py-2 text-right text-ink-soft">{formatCLP(f.costo)}</td>
                  <td className={`fh-num py-2 text-right font-semibold ${f.margen < 0 ? "text-error" : ""}`}>
                    {f.margenTexto}
                  </td>
                  <td className="fh-num py-2 text-right">{pct(f.margenPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {margenes.filas.length === 0 ? <p className="text-ink-soft">No se vendió nada en el rango.</p> : null}

          <Nota>
            El margen es el realizado: sale del costo congelado el día de la venta y del precio efectivamente cobrado,
            con su descuento repartido. No es el margen de lista que muestra el catálogo, que va a precio de repisa.
            {por === "categoria"
              ? " La categoría es la que el producto tiene HOY: si se recategoriza, la historia se mueve con él."
              : " Un producto descontinuado sigue apareciendo: el histórico no cambia porque se limpie el catálogo."}
          </Nota>
        </div>
      ) : null}

      {/* ---------------- Inventario valorizado (5.3) ---------------- */}
      {ver === "inventario" && inventario ? (
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Tarjeta titulo="Valor del inventario">
              <div className="fh-num text-3xl font-black">{inventario.totalTexto}</div>
              <div className="mt-1 text-sm text-ink-soft">neto, al {fechaTexto(inventario.fecha)}</div>
            </Tarjeta>
            <Tarjeta titulo="Productos con saldo">
              <div className="fh-num text-3xl font-black">{inventario.productos}</div>
            </Tarjeta>
            <Tarjeta titulo="Bajo cero">
              <div className={`fh-num text-3xl font-black ${inventario.bajoCero ? "text-error" : "text-ok"}`}>
                {inventario.bajoCero}
              </div>
              <div className="mt-1 text-sm text-ink-soft">
                {inventario.bajoCero ? "Se vendió más de lo cargado" : "Ningún saldo negativo"}
              </div>
            </Tarjeta>
          </div>

          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-ink-soft">
              <tr className="border-b border-line">
                <th className="pb-2">Producto</th>
                <th className="pb-2">Categoría</th>
                <th className="pb-2 text-right">Cantidad</th>
                <th className="pb-2 text-right">Costo unitario</th>
                <th className="pb-2 text-right">Valor neto</th>
              </tr>
            </thead>
            <tbody>
              {inventario.filas.map((f) => (
                <tr key={f.productId} className="border-b border-line/60">
                  <td className="py-2">
                    <div className="font-medium">{f.name}</div>
                    <div className="fh-num text-xs text-ink-soft">{f.sku}</div>
                  </td>
                  <td className="py-2 text-ink-soft">{f.categoria}</td>
                  <td className={`fh-num py-2 text-right ${f.qtyBaseMilli < 0 ? "text-error font-semibold" : ""}`}>
                    {f.cantidad}
                  </td>
                  <td className="fh-num py-2 text-right text-ink-soft">
                    {f.costoMilli === null ? "—" : formatCostoMilli(f.costoMilli)}
                  </td>
                  <td className="fh-num py-2 text-right font-semibold">{f.valorNetoTexto}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {inventario.filas.length === 0 ? <p className="text-ink-soft">No hay movimientos hasta esa fecha.</p> : null}

          <Nota>
            Se reconstruye sumando el libro de stock hasta esa fecha, con la fecha del HECHO: una factura digitada hoy
            con recepción de la semana pasada cuenta en la semana pasada. El costo promedio es global al producto, no
            por bodega.
          </Nota>
        </div>
      ) : null}

      {/* ---------------- Panel de alertas (5.5 y 5.6) ---------------- */}
      {ver === "alertas" && alertas ? (
        <div className="grid gap-4">
          {alertas.alertas.length === 0 ? (
            <Tarjeta titulo="Sin alertas">
              <p className="text-sm text-ink-soft">
                Nada bajo el mínimo, nada agotado y ninguna venta en espera olvidada. El panel vacío es la buena
                noticia.
              </p>
            </Tarjeta>
          ) : (
            <ul className="divide-y divide-line rounded-[var(--fh-radio)] border border-line bg-surface">
              {alertas.alertas.map((a) => (
                <li key={a.id ?? `${a.type}-${a.ref?.id}`} className="flex items-center gap-3 px-4 py-3">
                  <span
                  aria-hidden
                  className={`w-3 shrink-0 text-center ${a.severity === "CRITICAL" ? "text-error" : "text-warn"}`}
                >
                    {a.severity === "CRITICAL" ? "●" : "▲"}
                  </span>
                  <span className="w-40 shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-soft">
                    {TIPO_TEXTO[a.type] ?? a.type}
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
                  <div className="w-28 shrink-0 text-right">
                    {a.id === null ? (
                      <Link to="/venta" className="text-sm underline underline-offset-4">
                        Ver espera
                      </Link>
                    ) : (
                      <button
                        onClick={async () => {
                          setResolviendo(a.id!);
                          try {
                            await api(`/alerts/${a.id}/resolve`, { method: "POST", body: "{}" });
                            await cargar();
                          } catch (e) {
                            setError(e instanceof ApiError ? e.message : "No se pudo resolver la alerta");
                          } finally {
                            setResolviendo(null);
                          }
                        }}
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
          )}
          <Nota>
            Las de stock se cierran solas cuando el producto vuelve a estar sobre su mínimo: no hay que acordarse de
            limpiarlas. Resolverlas a mano sirve para callarlas hasta el próximo movimiento de ese producto — «ya lo
            pedí». La de venta en espera no se resuelve marcándola: se resuelve cobrando la espera o descartándola.
          </Nota>
        </div>
      ) : null}
    </div>
  );
}
