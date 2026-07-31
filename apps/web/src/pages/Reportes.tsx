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
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Boton, Campo, Chip, Tarjeta } from "@/components/ui";
import { formatCLP, formatCostoMilli, formatHora } from "@ferrehouse/shared";

type Ver = "ventas" | "margenes" | "inventario" | "cajas";

type Ventas = {
  desde: string;
  hasta: string;
  documentos: number;
  devoluciones: number;
  anulaciones: number;
  reversas: number;
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

/**
 * Una sesión de caja cerrada —o la que está abierta ahora—. El `estado` lo
 * deriva el SERVIDOR con la misma función que usa la pantalla de cierre y el
 * papel: si lo calculara la pantalla, tarde o temprano el historial y el
 * comprobante impreso dirían cosas distintas del mismo arqueo.
 */
type Sesion = {
  id: number;
  openedAt: string;
  closedAt: string | null;
  openingAmount: number;
  expectedAmount: number | null;
  countedAmount: number | null;
  differenceAmount: number | null;
  notes: string | null;
  station: { name: string };
  user: { name: string };
  estado: { tono: "ok" | "warn" | "error" | "neutral"; palabra: string; mensaje: string } | null;
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
  { clave: "cajas", texto: "Cajas" },
];

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
/**
 * «31-07 17:27» y no la fecha completa: la columna se lee de un vistazo y el
 * año no aporta nada cuando se están mirando los últimos sesenta turnos. La
 * hora sale de `formatHora`, la misma del resto de la aplicación —escribirla
 * a mano acá daría «5:27 p. m.» en una pantalla donde todo lo demás es 24h.
 */
function fechaYHora(iso: string): string {
  const d = new Date(iso);
  const dia = String(d.getDate()).padStart(2, "0");
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  return `${dia}-${mes} ${formatHora(d)}`;
}

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
  const [cargando, setCargando] = useState(false);
  const [sesiones, setSesiones] = useState<Sesion[] | null>(null);
  const [avisoCaja, setAvisoCaja] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * Reconciliar el libro de stock (tarea 4.8).
   *
   * Compara el saldo guardado en `StockLevel` —que es CACHÉ— contra la suma del
   * libro de movimientos, que es la verdad (decisión 4). Donde no cuadran,
   * corrige el caché y deja una alerta crítica por cada producto.
   *
   * **Es el único chequeo que puede acusar una corrupción silenciosa.** Todo lo
   * demás del sistema mira el saldo, así que un saldo mal escrito no da ningún
   * síntoma: los números simplemente son otros. Correrlo de nuevo después de
   * corregir devuelve cero, así que apretarlo dos veces no ensucia nada.
   */
  /**
   * Vuelve a encolar el comprobante de cierre de ese turno. Usa la misma ruta
   * que el botón de la pantalla de caja: el papel se guarda tal como salió, no
   * se recalcula, porque un cierre reimpreso con números distintos a los del
   * día sería exactamente lo contrario de un comprobante.
   */
  async function reimprimirCierre(id: number): Promise<void> {
    setAvisoCaja(null);
    try {
      const r = await api<{ mensaje: string }>(`/cash/sessions/${id}/report`, { method: "POST", body: "{}" });
      setAvisoCaja(r.mensaje);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo reimprimir el cierre");
    }
  }

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      if (ver === "ventas") setVentas(await api<Ventas>(`/reports/sales?desde=${desde}&hasta=${hasta}`));
      else if (ver === "margenes")
        setMargenes(await api<Margenes>(`/reports/margins?desde=${desde}&hasta=${hasta}&por=${por}`));
      else if (ver === "inventario") setInventario(await api<Inventario>(`/reports/inventory?fecha=${hasta}`));
      // Sin rango de fechas: el historial de cajas se mira hacia atrás desde
      // hoy, y quien lo abre busca «el cierre del martes», no un período.
      else setSesiones((await api<{ sesiones: Sesion[] }>("/cash/sessions?limit=60")).sesiones);
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
        <div className={`flex items-end gap-2 ${ver === "cajas" ? "hidden" : ""}`}>
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
                {ventas.documentos} documentos
                {ventas.devoluciones > 0 ? ` · ${ventas.devoluciones} devolución(es)` : ""}
                {ventas.anulaciones > 0 ? ` · ${ventas.anulaciones} anulación(es)` : ""}
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

      {/* ---------------- Historial de cajas ---------------- */}
      {ver === "cajas" && sesiones ? (
        <div className="grid gap-4">
          {avisoCaja ? (
            <p className="rounded-[var(--fh-radio)] border border-ok/40 bg-ok/10 p-3 text-sm">{avisoCaja}</p>
          ) : null}

          {sesiones.length === 0 ? (
            <Tarjeta titulo="Todavía no hay ninguna caja">
              <p className="text-sm text-ink-soft">
                Acá van a quedar todas las aperturas y cierres, con quién las hizo y en cuánto cuadró cada arqueo.
              </p>
            </Tarjeta>
          ) : (
            <div className="overflow-x-auto rounded-[var(--fh-radio)] border border-line bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
                    <th className="px-3 py-2 text-left font-semibold">Abrió</th>
                    <th className="px-3 py-2 text-left font-semibold">Cerró</th>
                    <th className="px-3 py-2 text-left font-semibold">Caja</th>
                    <th className="px-3 py-2 text-left font-semibold">Quién</th>
                    <th className="px-3 py-2 text-right font-semibold">Fondo</th>
                    <th className="px-3 py-2 text-right font-semibold">Esperado</th>
                    <th className="px-3 py-2 text-right font-semibold">Contado</th>
                    <th className="px-3 py-2 text-right font-semibold">Diferencia</th>
                    <th className="px-3 py-2 text-left font-semibold">Arqueo</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {sesiones.map((s) => (
                    <tr key={s.id} className="border-b border-line/60 last:border-0 align-top">
                      <td className="px-3 py-2 whitespace-nowrap">{fechaYHora(s.openedAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {s.closedAt ? (
                          fechaYHora(s.closedAt)
                        ) : (
                          <Chip tono="neutral">abierta ahora</Chip>
                        )}
                      </td>
                      <td className="px-3 py-2">{s.station.name}</td>
                      <td className="px-3 py-2">{s.user.name}</td>
                      <td className="fh-num px-3 py-2 text-right">{formatCLP(s.openingAmount)}</td>
                      {/*
                        En la sesión abierta estas tres columnas van vacías a
                        propósito, no en cero: el arqueo es a ciegas (decisión
                        del Sprint 2) y mostrar el esperado mientras la caja
                        está abierta le entregaría al vendedor justo el número
                        que no debe ver antes de contar.
                      */}
                      <td className="fh-num px-3 py-2 text-right">
                        {s.expectedAmount === null ? <span className="text-ink-soft">—</span> : formatCLP(s.expectedAmount)}
                      </td>
                      <td className="fh-num px-3 py-2 text-right">
                        {s.countedAmount === null ? <span className="text-ink-soft">—</span> : formatCLP(s.countedAmount)}
                      </td>
                      <td className="fh-num px-3 py-2 text-right">
                        {s.differenceAmount === null ? (
                          <span className="text-ink-soft">—</span>
                        ) : (
                          <span className={s.differenceAmount === 0 ? "" : s.differenceAmount < 0 ? "text-error" : "text-warn"}>
                            {s.differenceAmount > 0 ? "+" : ""}
                            {formatCLP(s.differenceAmount)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {s.estado ? <Chip tono={s.estado.tono}>{s.estado.palabra}</Chip> : <span className="text-ink-soft">—</span>}
                        {s.notes ? <p className="mt-1 max-w-[18rem] text-xs text-ink-soft">{s.notes}</p> : null}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {s.closedAt ? (
                          <button
                            type="button"
                            onClick={() => void reimprimirCierre(s.id)}
                            className="text-xs text-ink-soft underline underline-offset-4"
                          >
                            Reimprimir
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Nota>
            Se muestran los últimos 60 turnos. La diferencia es lo contado menos lo esperado: negativa falta plata,
            positiva sobra. «Reimprimir» vuelve a encolar el mismo comprobante de cierre que salió ese día —no lo
            recalcula—, y sale marcado como copia.
          </Nota>
        </div>
      ) : null}

    </div>
  );
}
