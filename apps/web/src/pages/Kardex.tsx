/**
 * Kardex de producto (tarea 4.8, UI-BRIEF §5.4).
 * Wireframe aprobado por Cristian el 2026-07-30.
 *
 * Es la pantalla que contesta **"¿por qué el stock dice esto?"**. Todo lo que
 * hay acá existe para que esa respuesta sea completa y no haya que creerle a
 * un número suelto.
 *
 * LO QUE LA GOBIERNA:
 *
 * - **El orden es el de tecleo, no el de fecha** (decidido con Cristian). El
 *   saldo de cada fila es una foto tomada al escribir el movimiento; si una
 *   factura del viernes se digita el lunes, ordenar por fecha la pondría entre
 *   los movimientos del viernes con un saldo que no calza con la fila de
 *   arriba. La fecha del hecho se lee en su columna, que es donde sirve.
 *
 * - **Las cantidades van en la unidad de VENTA.** El libro guarda milésimas de
 *   unidad base; acá dice "92,5 m". La conversión la hace el servidor.
 *
 * - **Corregir vive en esta pantalla.** Uno abre el kardex porque el saldo no
 *   calza: la corrección tiene que estar donde aparece el problema, no en otro
 *   menú. Ajuste y merma exigen motivo, y el motivo se lee después en la misma
 *   tabla, en la columna de referencia.
 *
 * - **El vendedor la ve sin costos.** No están en gris ni ocultos por CSS: el
 *   servidor no se los manda (decisión sellada 17).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Boton, Campo, Chip } from "@/components/ui";
import {
  formatCLP,
  formatCostoMilli,
  formatQty,
  formatHora,
  atajosDe,
  STOCK_RULES,
  STOCK_MOVEMENT_TYPES,
  roundSym,
  type StockMovementType,
} from "@ferrehouse/shared";

type Movimiento = {
  id: number;
  createdAt: string;
  type: StockMovementType;
  etiqueta: string;
  tono: "ok" | "warn" | "error" | "neutral";
  qtyMilli: number;
  balanceMilli: number;
  /** Solo con token de admin. */
  balanceCostNetMilliPeso?: number;
  totalCostNet?: number;
  user: { id: number; name: string };
  reason: string | null;
  referencia: string | null;
};

type Kardex = {
  producto: {
    id: number;
    sku: string;
    name: string;
    unidad: string;
    factorMilli: number;
    allowsFraction: boolean;
    costNetMilliPeso?: number;
    priceGross: number;
    reorderLevelBaseMilli: number;
  };
  saldoBaseMilli: number;
  /** Si el producto tiene movimientos, sin mirar los filtros. */
  hayHistoria: boolean;
  saldoTexto: string;
  movimientos: Movimiento[];
};

type Hallazgo = { id: number; sku: string; name: string; saleUnit: { symbol: string } };

const RANGOS = [
  { clave: "30", texto: "Últimos 30 días", dias: 30 },
  { clave: "90", texto: "Últimos 90 días", dias: 90 },
  { clave: "todo", texto: "Toda la historia", dias: 0 },
] as const;

function fechaCorta(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${formatHora(d)}`;
}

export function Kardex() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.role === "ADMIN";

  const [texto, setTexto] = useState("");
  const [hallazgos, setHallazgos] = useState<Hallazgo[]>([]);
  /**
   * `?producto=12` abre el kardex directo en ese producto. Lo usa el panel de
   * alertas: una alerta que dice "el cable se agotó" y no lleva al cable
   * obliga a copiar el SKU a mano en la caja de búsqueda de al lado.
   */
  const [params] = useSearchParams();
  const [productoId, setProductoId] = useState<number | null>(() => {
    const p = Number(params.get("producto"));
    return Number.isInteger(p) && p > 0 ? p : null;
  });

  const [kardex, setKardex] = useState<Kardex | null>(null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tipo, setTipo] = useState<"" | StockMovementType>("");
  const [rango, setRango] = useState<(typeof RANGOS)[number]["clave"]>("30");

  const [corrigiendo, setCorrigiendo] = useState<null | "ADJUSTMENT" | "SHRINKAGE">(null);
  const caja = useRef<HTMLInputElement>(null);

  const alFoco = useCallback(() => {
    caja.current?.focus();
    caja.current?.select();
  }, []);

  useEffect(() => {
    alFoco();
  }, [alFoco]);

  // --- Buscar producto: la misma caja del catálogo, con la misma espera ---
  useEffect(() => {
    if (texto.trim().length === 0) {
      setHallazgos([]);
      return;
    }
    let vigente = true;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ exacto: boolean; productos: Hallazgo[] }>(
          `/products/search?q=${encodeURIComponent(texto.trim())}`,
        );
        if (!vigente) return;
        setHallazgos(r.productos);
        // Escaneo con calce exacto: se abre el kardex, no una lista.
        if (r.exacto && r.productos[0]) {
          setProductoId(r.productos[0].id);
          setHallazgos([]);
          setTexto("");
        }
      } catch {
        if (vigente) setHallazgos([]);
      }
    }, 180);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [texto]);

  const cargar = useCallback(async () => {
    if (!productoId) return;
    setCargando(true);
    setError(null);
    try {
      const dias = RANGOS.find((r) => r.clave === rango)!.dias;
      const desde = dias > 0 ? new Date(Date.now() - dias * 86_400_000).toISOString() : null;
      const q = new URLSearchParams();
      if (desde) q.set("desde", desde);
      if (tipo) q.set("tipo", tipo);
      setKardex(await api<Kardex>(`/stock/${productoId}/kardex?${q.toString()}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar el kardex");
      setKardex(null);
    } finally {
      setCargando(false);
    }
  }, [productoId, rango, tipo]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const atajos = atajosDe("kardex").filter((a) => esAdmin || a.tecla === "F2");

  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === "F2") {
        e.preventDefault();
        alFoco();
      } else if (esAdmin && kardex && e.key === "F4") {
        e.preventDefault();
        setCorrigiendo("ADJUSTMENT");
      } else if (esAdmin && kardex && e.key === "F6") {
        e.preventDefault();
        setCorrigiendo("SHRINKAGE");
      }
    }
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [alFoco, esAdmin, kardex]);

  /**
   * El valor de lo que hay en repisa. Se calcula con el costo promedio VIGENTE
   * sobre el saldo actual, que es exactamente lo que hace el inventario
   * valorizado del servidor: dos fórmulas distintas para el mismo número
   * terminan mostrando dos valores en dos pantallas.
   */
  const valorNeto =
    kardex && kardex.producto.costNetMilliPeso !== undefined
      ? roundSym((kardex.saldoBaseMilli * kardex.producto.costNetMilliPeso) / 1_000_000)
      : null;

  /*
    El saldo y el mínimo se guardan en unidad BASE y se muestran en unidad de
    VENTA. Es la misma conversión que hace el catálogo, y hacerla con el mismo
    factor es lo que evita que dos pantallas digan cosas distintas del mismo
    producto: 1.500 kg y 60 sacos son el mismo saco de cemento.
  */
  const saldoEnVenta = kardex ? roundSym((kardex.saldoBaseMilli * 1000) / kardex.producto.factorMilli) : 0;
  const minimoEnVenta = kardex
    ? roundSym((kardex.producto.reorderLevelBaseMilli * 1000) / kardex.producto.factorMilli)
    : 0;
  const bajoMinimo = minimoEnVenta > 0 && saldoEnVenta <= minimoEnVenta;

  return (
    <div className="flex flex-col gap-4">
      {/* --- Buscador --- */}
      <div>
        <label className="sr-only" htmlFor="buscador-kardex">
          Buscar producto
        </label>
        <input
          id="buscador-kardex"
          ref={caja}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          placeholder="Escanea, o escribe nombre o código"
          autoComplete="off"
          className="min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-4 text-lg text-ink placeholder:text-ink-soft/60"
        />
        {hallazgos.length > 0 ? (
          <ul className="mt-1 divide-y divide-line rounded-[var(--fh-radio)] border border-line bg-surface">
            {hallazgos.slice(0, 8).map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="flex min-h-touch w-full items-center justify-between px-4 text-left hover:bg-bg"
                  onClick={() => {
                    setProductoId(h.id);
                    setHallazgos([]);
                    setTexto("");
                  }}
                >
                  <span className="text-ink">{h.name}</span>
                  <span className="font-mono text-sm text-mono-ink">{h.sku}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {!productoId ? (
        <p className="rounded-[var(--fh-radio)] border border-line bg-surface p-6 text-ink-soft">
          Busca un producto para ver su historia de stock: cada compra, venta, devolución y ajuste, en orden, con
          el saldo que dejó.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-4 text-error">
          {error}
        </p>
      ) : null}

      {kardex ? (
        <>
          {/* --- Cabecera del producto --- */}
          <div className="flex items-stretch gap-4">
            {/*
              Tarjeta partida: a la izquierda quién es el producto, a la derecha
              los tres números que se vienen a mirar. La raya de 1px entre las
              celdas hace que se lean como tres cosas y no como una frase.
            */}
            <section className="flex flex-1 items-stretch border border-line bg-surface">
              <div className="min-w-0 flex-1 p-5">
                <div className="fh-num font-mono text-xs text-mono-ink">{kardex.producto.sku}</div>
                <h1 className="mt-1 text-[26px] font-black leading-tight tracking-[-0.02em]">
                  {kardex.producto.name}
                </h1>
                <div className="mt-1 text-[13.5px] text-ink-soft">Se vende por {kardex.producto.unidad}</div>
              </div>

              <div className="flex shrink-0">
                {/*
                  El saldo se pinta en ámbar cuando está bajo el mínimo. Es el
                  número por el que se abre esta pantalla, y «8» no dice nada
                  hasta que se sabe contra qué se compara — por eso el mínimo va
                  debajo y no en otra pantalla.
                */}
                <div className="w-[150px] border-l border-line-soft p-5">
                  <div className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
                    Saldo hoy
                  </div>
                  <div
                    className={`fh-num mt-1 text-[38px] font-black leading-none tracking-[-0.03em] ${
                      bajoMinimo ? "text-warn-ink" : ""
                    }`}
                  >
                    {formatQty(saldoEnVenta, kardex.producto.allowsFraction)}
                  </div>
                  <div className="mt-1 text-[12.5px] text-ink-soft">
                    {kardex.producto.unidad}
                    {minimoEnVenta > 0 ? ` · mín. ${formatQty(minimoEnVenta, kardex.producto.allowsFraction)}` : ""}
                  </div>
                </div>

                <div className="w-[150px] border-l border-line-soft p-5">
                  <div className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">Precio</div>
                  <div className="fh-num mt-1 text-[30px] font-black leading-none tracking-[-0.02em]">
                    {formatCLP(kardex.producto.priceGross)}
                  </div>
                  <div className="mt-1 text-[12.5px] text-ink-soft">por {kardex.producto.unidad}</div>
                </div>

                {esAdmin && kardex.producto.costNetMilliPeso !== undefined ? (
                  <div className="w-[150px] border-l border-line-soft p-5">
                    <div className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
                      Costo prom.
                    </div>
                    <div className="fh-num mt-1 text-[30px] font-black leading-none tracking-[-0.02em]">
                      {formatCostoMilli(kardex.producto.costNetMilliPeso)}
                    </div>
                    <div className="mt-1 text-[12.5px] text-ink-soft">
                      neto · valor {formatCLP(valorNeto ?? 0)}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>

            {esAdmin ? (
              <section className="flex w-56 flex-col gap-2 rounded-[var(--fh-radio)] border border-line bg-surface p-5">
                <h2 className="text-xs uppercase tracking-wide text-ink-soft">Corregir</h2>
                <Boton onClick={() => setCorrigiendo("ADJUSTMENT")}>Ajustar</Boton>
                <Boton onClick={() => setCorrigiendo("SHRINKAGE")}>Merma</Boton>
                <p className="text-xs text-ink-soft">Los dos piden motivo y quedan en esta misma tabla.</p>
              </section>
            ) : null}
          </div>

          {/* --- Filtros --- */}
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-soft">Movimientos</h2>
            <select
              aria-label="Tipo de movimiento"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as "" | StockMovementType)}
              className="min-h-touch rounded-[var(--fh-radio)] border border-line bg-surface px-3 text-ink"
            >
              <option value="">Todos</option>
              {STOCK_MOVEMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {STOCK_RULES[t].etiqueta}
                </option>
              ))}
            </select>
            <select
              aria-label="Rango de fechas"
              value={rango}
              onChange={(e) => setRango(e.target.value as (typeof RANGOS)[number]["clave"])}
              className="min-h-touch rounded-[var(--fh-radio)] border border-line bg-surface px-3 text-ink"
            >
              {RANGOS.map((r) => (
                <option key={r.clave} value={r.clave}>
                  {r.texto}
                </option>
              ))}
            </select>
            <span className="ml-auto text-sm text-ink-soft">
              {kardex.movimientos.length} {kardex.movimientos.length === 1 ? "movimiento" : "movimientos"}
            </span>
          </div>

          {/* --- La tabla --- */}
          {kardex.movimientos.length === 0 ? (
            <p className="rounded-[var(--fh-radio)] border border-line bg-surface p-6 text-ink-soft">
              {/*
                El mensaje depende de si HAY historia, no de si hay filtro. Al
                revés —que es como estaba— un producto recién creado invitaba a
                "probar con toda la historia", y toda la historia tampoco tenía
                nada: la pantalla mandaba a buscar algo que no existe.
              */}
              {kardex.hayHistoria
                ? "No hay movimientos con ese filtro. Prueba con toda la historia, o con otro tipo de movimiento."
                : "Este producto todavía no tiene historia. Su stock inicial entra por el importador de Excel, en la columna «Stock inicial», o registrando la compra al proveedor."}
            </p>
          ) : (
            <div className="overflow-x-auto border border-line bg-surface">
              <table className="w-full">
                <thead className="border-b-2 border-ink text-[10.5px] uppercase tracking-[0.11em] text-ink-soft">
                  <tr>
                    <th className="w-[150px] px-[14px] py-[9px] text-left font-extrabold">Cuándo</th>
                    <th className="px-[14px] py-[9px] text-left font-extrabold">Movimiento</th>
                    <th className="px-[14px] py-[9px] text-right font-extrabold">Cantidad ({kardex.producto.unidad})</th>
                    <th className="px-[14px] py-[9px] text-right font-extrabold">Saldo ({kardex.producto.unidad})</th>
                    {/* Es el promedio DESPUÉS del movimiento, no lo que costó
                        este movimiento: la columna es una foto del saldo, igual
                        que la de al lado. Decir "Costo u." invitaba a leer
                        "compré a $486" en una compra que fue a $550. */}
                    {esAdmin ? <th className="px-[14px] py-[9px] text-right font-extrabold">Promedio</th> : null}
                    <th className="px-[14px] py-[9px] text-left font-extrabold">Quién</th>
                    <th className="px-[14px] py-[9px] text-left font-extrabold">Referencia / motivo</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {kardex.movimientos.map((m) => (
                    <tr key={m.id} className="border-b border-line-soft last:border-0">
                      <td className="fh-num whitespace-nowrap px-[14px] py-[10px] font-mono text-[12.5px] text-mono-ink">
                        {fechaCorta(m.createdAt)}
                      </td>
                      <td className="px-[14px] py-[10px]">
                        <Chip tono={m.tono}>{m.etiqueta}</Chip>
                      </td>
                      {/* El signo va explícito Y el color: "+100" y "−7,5" se
                          distinguen de un vistazo, y el color solo no basta
                          (brief §2.4). Lo que entra en verde, lo que sale en
                          rojo legible — nunca en rojo pleno. */}
                      <td
                        className={`fh-num px-[14px] py-[10px] text-right text-base font-extrabold ${
                          m.qtyMilli > 0 ? "text-ok-ink" : "text-accent-ink"
                        }`}
                      >
                        {m.qtyMilli > 0 ? "+" : "−"}
                        {formatQty(Math.abs(m.qtyMilli), kardex.producto.allowsFraction)}
                      </td>
                      <td className="fh-num px-[14px] py-[10px] text-right font-semibold">
                        {formatQty(m.balanceMilli, kardex.producto.allowsFraction)}
                      </td>
                      {esAdmin ? (
                        <td className="fh-num px-[14px] py-[10px] text-right text-ink-soft">
                          {m.balanceCostNetMilliPeso !== undefined
                            ? formatCostoMilli(m.balanceCostNetMilliPeso)
                            : "—"}
                        </td>
                      ) : null}
                      <td className="whitespace-nowrap px-[14px] py-[10px] text-ink-soft">{m.user.name}</td>
                      <td className="fh-num px-[14px] py-[10px] font-mono text-[12px] text-mono-ink">
                        {m.referencia ?? m.reason ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {cargando ? <p className="text-sm text-ink-soft">Cargando…</p> : null}
        </>
      ) : null}

      {atajos.length > 0 ? (
        <p className="text-xs text-ink-soft">
          {atajos.map((a) => `${a.etiqueta} ${a.accion}`).join("  ·  ")}
        </p>
      ) : null}

      {corrigiendo && kardex ? (
        <Correccion
          tipo={corrigiendo}
          producto={kardex.producto}
          saldoMilli={roundSym((kardex.saldoBaseMilli * 1000) / kardex.producto.factorMilli)}
          saldoTexto={kardex.saldoTexto}
          onCerrar={() => {
            setCorrigiendo(null);
            alFoco();
          }}
          onListo={async () => {
            setCorrigiendo(null);
            await cargar();
            alFoco();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Ajuste o merma. Es el mismo formulario porque es el mismo movimiento con
 * distinta dirección; separarlos en dos pantallas duplicaría la validación del
 * motivo, que es lo único que de verdad importa acá.
 */
function Correccion({
  tipo,
  producto,
  saldoMilli,
  saldoTexto,
  onCerrar,
  onListo,
}: {
  tipo: "ADJUSTMENT" | "SHRINKAGE";
  producto: Kardex["producto"];
  /** Saldo actual en milésimas de la unidad de VENTA. */
  saldoMilli: number;
  saldoTexto: string;
  onCerrar: () => void;
  onListo: () => void | Promise<void>;
}) {
  const esMerma = tipo === "SHRINKAGE";
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const primero = useRef<HTMLInputElement>(null);

  useEffect(() => {
    primero.current?.focus();
  }, []);

  const numero = Number(cantidad.replace(",", "."));
  const valida = Number.isFinite(numero) && numero !== 0 && motivo.trim().length >= 4;

  /**
   * EN CUÁNTO QUEDA, calculado mientras se escribe.
   *
   * Es la defensa contra el error que este formulario invita a cometer: se
   * cuenta la repisa, hay 275 m, y se teclea 275 donde va la diferencia. El
   * campo pide −3. Sin esta línea, el ajuste entra y el saldo salta a 553 m sin
   * que nada chille; con ella, el número absurdo aparece antes de confirmar.
   */
  const resultado =
    Number.isFinite(numero) && cantidad.trim() !== ""
      ? saldoMilli + (esMerma ? -Math.abs(numero) : numero) * 1000
      : null;

  async function enviar() {
    if (!valida || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      await api("/stock/adjustments", {
        method: "POST",
        body: JSON.stringify({
          productId: producto.id,
          type: tipo,
          // La merma siempre resta: el servidor toma el valor absoluto, y acá
          // se manda en positivo para que el campo no pida un menos que después
          // se ignora.
          qtyMilli: Math.round(numero * 1000),
          reason: motivo.trim(),
        }),
      });
      await onListo();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo registrar");
      setEnviando(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={esMerma ? "Registrar merma" : "Ajustar inventario"}
      className="fixed inset-0 z-10 grid place-items-center bg-ink/40 p-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCerrar();
      }}
    >
      <div className="w-full max-w-md rounded-[var(--fh-radio)] border border-line bg-surface p-6">
        <h2 className="text-lg font-bold text-ink">{esMerma ? "Registrar merma" : "Ajustar inventario"}</h2>
        <p className="mt-1 text-sm text-ink-soft">
          {producto.name} · se cuenta en {producto.unidad}
        </p>

        <div className="mt-4 flex flex-col gap-3">
          <Campo
            ref={primero}
            etiqueta={esMerma ? `Cuánto se perdió (${producto.unidad})` : `Diferencia (${producto.unidad})`}
            hint={
              esMerma
                ? "Va en positivo: una merma siempre resta."
                : "Con signo: −3 si hay menos de lo que dice el sistema, 3 si hay más."
            }
            value={cantidad}
            inputMode="decimal"
            onChange={(e) => setCantidad(e.target.value)}
          />
          {resultado !== null ? (
            <p className={resultado < 0 ? "text-sm font-semibold text-error" : "text-sm text-ink-soft"}>
              Queda en{" "}
              <strong className="tabular-nums">
                {formatQty(resultado, producto.allowsFraction)} {producto.unidad}
              </strong>
              {resultado < 0 ? " — bajo cero, revisa el número que escribiste." : ` (ahora hay ${saldoTexto})`}
            </p>
          ) : null}

          <Campo
            etiqueta="Motivo"
            hint="Lo va a leer alguien que no estaba: «se mojó un tramo en la bodega», no «ajuste»."
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>

        {error ? (
          <p role="alert" className="mt-3 rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-error">
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Boton variante="fantasma" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton variante="principal" disabled={!valida || enviando} onClick={() => void enviar()}>
            {enviando ? "Registrando…" : esMerma ? "Registrar merma" : "Registrar ajuste"}
          </Boton>
        </div>
      </div>
    </div>
  );
}
