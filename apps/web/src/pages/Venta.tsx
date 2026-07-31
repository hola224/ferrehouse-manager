/**
 * La venta (tarea 3.10, UI-BRIEF §5.1). Wireframe aprobado el 2026-07-30.
 *
 * Es la pantalla donde se pasan ocho horas al día, de pie y con un cliente al
 * frente. Lo que la gobierna:
 *
 * - **El foco vuelve SIEMPRE a la caja de escaneo.** El lector es un teclado:
 *   si el foco quedó en otra parte, lo escaneado se pierde y el vendedor no
 *   entiende por qué. Después de cerrar un diálogo, de cambiar una cantidad y
 *   de cobrar.
 * - **Escanear algo que ya está en la lista suma a esa línea**, no crea una
 *   segunda. Es lo que hace un vendedor al pasar tres veces el mismo perno.
 * - **El total y el vuelto se leen a 1,5 m.** El vuelto aparece apenas se
 *   escribe el efectivo recibido, no después de cobrar: verlo después no evita
 *   ningún error.
 * - **Los totales se calculan con `calcularVenta` de `shared`**, la MISMA
 *   función que usa el servidor al cobrar. No hay una aritmética "de pantalla"
 *   y otra "de verdad" que puedan separarse.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Boton, Chip } from "@/components/ui";
import {
  calcularVenta,
  formatCLP,
  formatQty,
  atajosDe,
  ErrorDeVenta,
  type VentaCalculada,
} from "@ferrehouse/shared";

type Producto = {
  id: number;
  sku: string;
  name: string;
  priceGross: number;
  saleUnit: { id: number; symbol: string; factorMilli: number; groupId: number };
};

type Linea = {
  producto: Producto;
  qtyMilli: number;
  discountAmount: number;
  /** El grupo admite fracciones. Se resuelve al agregar, no al teclear. */
  fraccionable: boolean;
};

type Config = { taxRatePercent: number; multiploRedondeo: number; topeDescuento: number };

export function Venta() {
  const [config, setConfig] = useState<Config | null>(null);
  const [cajaAbierta, setCajaAbierta] = useState<boolean | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [seleccion, setSeleccion] = useState(0);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"nada" | "cobrar" | "cantidad" | "esperas">("nada");
  const [ultimoCobro, setUltimoCobro] = useState<{ mensaje: string; aviso: string | null } | null>(null);

  const caja = useRef<HTMLInputElement>(null);

  const volverAlFoco = useCallback(() => {
    caja.current?.focus();
    caja.current?.select();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setConfig(await api<Config>("/pos/config"));
        const c = await api<{ abierta: boolean }>("/cash/current");
        setCajaAbierta(c.abierta);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "No se pudo preparar la venta");
      }
    })();
  }, []);

  useEffect(() => {
    if (panel === "nada") volverAlFoco();
  }, [panel, volverAlFoco]);

  /** Los totales, con la misma función que va a usar el servidor al cobrar. */
  const total: VentaCalculada | null = useMemo(() => {
    if (!config || lineas.length === 0) return null;
    try {
      return calcularVenta({
        lineas: lineas.map((l) => ({
          productId: l.producto.id,
          qtyMilli: l.qtyMilli,
          unitPriceGross: l.producto.priceGross,
          discountAmount: l.discountAmount,
        })),
        // Sin pagos todavía: se usa una pata en efectivo ficticia para ver el
        // total redondeado, que es el que el vendedor va a decir en voz alta.
        pagos: [{ method: "CASH", receivedAmount: 100_000_000 }],
        taxRatePercent: config.taxRatePercent,
        multiploRedondeo: config.multiploRedondeo,
      });
    } catch {
      return null;
    }
  }, [lineas, config]);

  async function buscarYAgregar(q: string) {
    if (!q.trim()) return;
    setError(null);
    try {
      const r = await api<{ exacto: boolean; productos: Producto[] }>(
        `/products/search?q=${encodeURIComponent(q.trim())}`,
      );
      const p = r.productos[0];
      if (!p) {
        setError(`Nada calza con «${q.trim()}».`);
        return;
      }
      const grupos = await api<{ grupos: { id: number; allowsFraction: boolean }[] }>("/catalog/units");
      const fraccionable = grupos.grupos.find((g) => g.id === p.saleUnit.groupId)?.allowsFraction ?? true;
      agregar(p, fraccionable);
      setTexto("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo buscar");
    }
  }

  function agregar(p: Producto, fraccionable: boolean) {
    setLineas((prev) => {
      // Escanear algo que ya está suma a esa línea, no crea una segunda.
      const i = prev.findIndex((l) => l.producto.id === p.id);
      if (i >= 0) {
        const copia = [...prev];
        copia[i] = { ...copia[i]!, qtyMilli: copia[i]!.qtyMilli + 1000 };
        setSeleccion(i);
        return copia;
      }
      setSeleccion(prev.length);
      return [...prev, { producto: p, qtyMilli: 1000, discountAmount: 0, fraccionable }];
    });
  }

  function quitar(i: number) {
    setLineas((prev) => prev.filter((_, j) => j !== i));
    setSeleccion((s) => Math.max(0, Math.min(s, lineas.length - 2)));
  }

  function alTeclado(e: React.KeyboardEvent) {
    if (panel !== "nada") return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setSeleccion((s) => (e.key === "ArrowDown" ? Math.min(s + 1, lineas.length - 1) : Math.max(s - 1, 0)));
    } else if (e.key === "Delete" && lineas[seleccion]) {
      e.preventDefault();
      quitar(seleccion);
    } else if (e.key === "F2" && lineas.length > 0) {
      e.preventDefault();
      setPanel("cobrar");
    } else if (e.key === "F8") {
      e.preventDefault();
      setPanel("esperas");
    }
  }

  if (cajaAbierta === false) {
    // Se avisa desde el principio, no al cobrar: descubrirlo con el cliente
    // esperando y la venta armada es peor que no poder empezarla.
    return (
      <div className="rounded-[var(--fh-radio)] border border-line bg-surface p-8 text-center">
        <Chip tono="neutral">caja cerrada</Chip>
        <p className="mt-3 text-lg">La caja está cerrada. Ábrela antes de vender.</p>
        <Link to="/caja" className="mt-4 inline-block">
          <Boton variante="principal">Ir a la caja</Boton>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex gap-4" onKeyDown={alTeclado}>
      {/* ---------- Izquierda: la lista ---------- */}
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <input
          ref={caja}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void buscarYAgregar(texto);
            }
          }}
          placeholder="Escanea o escribe"
          autoComplete="off"
          className="min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-4 text-lg"
        />

        {error ? (
          <div className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        ) : null}
        {ultimoCobro ? (
          <div className="rounded-[var(--fh-radio)] border border-ok/30 bg-ok/10 p-3 text-sm text-ok">
            {ultimoCobro.mensaje}
          </div>
        ) : null}
        {/* Si prometí un ticket y no salió, hay que decirlo en el momento. */}
        {ultimoCobro?.aviso ? (
          <div className="rounded-[var(--fh-radio)] border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
            {ultimoCobro.aviso}
          </div>
        ) : null}

        <div className="min-h-[24rem] overflow-x-auto rounded-[var(--fh-radio)] border border-line bg-surface">
          {lineas.length === 0 ? (
            <p className="p-8 text-center text-ink-soft">
              Escanea el primer producto, o escribe su nombre y aprieta Enter.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
                  <th className="px-3 py-2 text-left font-semibold">Producto</th>
                  <th className="px-3 py-2 text-right font-semibold">Cant.</th>
                  <th className="px-3 py-2 text-right font-semibold">P. unit.</th>
                  <th className="px-3 py-2 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr
                    key={l.producto.id}
                    onClick={() => setSeleccion(i)}
                    onDoubleClick={() => setPanel("cantidad")}
                    className={
                      "cursor-default border-b border-line/60 last:border-0 " + (i === seleccion ? "bg-bg" : "")
                    }
                  >
                    <td className="px-3 py-2">
                      {i === seleccion ? <span className="mr-1 text-ink-soft">▸</span> : null}
                      {l.producto.name}
                    </td>
                    <td className="fh-num px-3 py-2 text-right">
                      {formatQty(l.qtyMilli, l.fraccionable)} {l.producto.saleUnit.symbol}
                    </td>
                    <td className="fh-num px-3 py-2 text-right text-ink-soft">{formatCLP(l.producto.priceGross)}</td>
                    <td className="fh-num px-3 py-2 text-right font-semibold">
                      {formatCLP(
                        Math.round((l.producto.priceGross * l.qtyMilli) / 1000) - l.discountAmount,
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="flex gap-5 text-sm text-ink-soft">
          <span>
            <span className="fh-num font-semibold text-ink">↑↓</span> moverse
          </span>
          <span>
            <span className="fh-num font-semibold text-ink">Enter</span> cantidad
          </span>
          <span>
            <span className="fh-num font-semibold text-ink">Supr</span> quitar línea
          </span>
        </div>
      </div>

      {/* ---------- Derecha: el total y el cobro ---------- */}
      <aside className="flex w-80 shrink-0 flex-col gap-3 rounded-[var(--fh-radio)] border border-line bg-surface p-4">
        <div className="text-center">
          <div className="text-xs uppercase tracking-wide text-ink-soft">Total</div>
          {/* 48px: se lee a 1,5 m del mesón (brief §2.3). */}
          <div className="fh-num text-[3rem] font-black leading-none tracking-tight">
            {formatCLP(total?.totalGross ?? 0)}
          </div>
        </div>

        <dl className="border-t border-line pt-3 text-sm">
          <Fila etiqueta="Subtotal" valor={formatCLP(total?.subtotalGross ?? 0)} />
          {total && total.roundingAmount !== 0 ? (
            <Fila etiqueta="Redondeo" valor={formatCLP(total.roundingAmount)} />
          ) : null}
          {/* El desglose se muestra siempre, no solo al cobrar: es lo que se
              consulta cuando el cliente pide factura. */}
          <Fila etiqueta="Neto" valor={formatCLP(total?.netAmount ?? 0)} suave />
          <Fila etiqueta={`IVA ${config?.taxRatePercent ?? 19}%`} valor={formatCLP(total?.taxAmount ?? 0)} suave />
        </dl>

        <Boton variante="principal" disabled={lineas.length === 0} onClick={() => setPanel("cobrar")}>
          Cobrar <span className="fh-num opacity-70">F2</span>
        </Boton>

        <div className="flex flex-col gap-1 text-sm text-ink-soft">
          {atajosDe("venta")
            .filter((a) => a.accion !== "Cobrar")
            .map((a) => (
              <span key={a.tecla}>
                <span className="fh-num font-semibold text-ink">{a.etiqueta}</span> {a.accion.toLowerCase()}
              </span>
            ))}
        </div>
      </aside>

      {panel === "cantidad" && lineas[seleccion] ? (
        <Cantidad
          linea={lineas[seleccion]!}
          onCerrar={() => setPanel("nada")}
          onAceptar={(q) => {
            setLineas((prev) => prev.map((l, i) => (i === seleccion ? { ...l, qtyMilli: q } : l)));
            setPanel("nada");
          }}
        />
      ) : null}

      {panel === "cobrar" && total && config ? (
        <Cobrar
          total={total}
          lineas={lineas}
          config={config}
          onCerrar={() => setPanel("nada")}
          onCobrada={(mensaje, aviso) => {
            setLineas([]);
            setPanel("nada");
            setUltimoCobro({ mensaje, aviso });
          }}
        />
      ) : null}
    </div>
  );
}

function Fila({ etiqueta, valor, suave }: { etiqueta: string; valor: string; suave?: boolean }) {
  return (
    <div className={"flex justify-between py-0.5 " + (suave ? "text-ink-soft" : "")}>
      <dt>{etiqueta}</dt>
      <dd className="fh-num">{valor}</dd>
    </div>
  );
}

// ============================================================
// Cantidad
// ============================================================

function Cantidad({
  linea,
  onCerrar,
  onAceptar,
}: {
  linea: Linea;
  onCerrar: () => void;
  onAceptar: (qtyMilli: number) => void;
}) {
  const [valor, setValor] = useState(formatQty(linea.qtyMilli, linea.fraccionable));
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    campo.current?.focus();
    campo.current?.select();
  }, []);

  /** Coma decimal, como se escribe en Chile. */
  const parsear = (v: string): number | null => {
    const limpio = v.trim().replace(/\./g, "").replace(",", ".");
    if (!/^\d+(\.\d+)?$/.test(limpio)) return null;
    const n = Math.round(Number(limpio) * 1000);
    if (n <= 0) return null;
    if (!linea.fraccionable && n % 1000 !== 0) return null;
    return n;
  };

  const parsed = parsear(valor);

  return (
    <Dialogo onCerrar={onCerrar}>
      <h2 className="text-lg font-bold">{linea.producto.name}</h2>
      <p className="mt-1 text-sm text-ink-soft">
        {formatCLP(linea.producto.priceGross)} por {linea.producto.saleUnit.symbol}
      </p>
      <div className="mt-4 flex items-center gap-3">
        <input
          ref={campo}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && parsed) onAceptar(parsed);
          }}
          className="fh-num min-h-touch w-40 rounded-[var(--fh-radio)] border border-line bg-bg px-3 text-3xl font-bold"
        />
        <span className="text-lg text-ink-soft">{linea.producto.saleUnit.symbol}</span>
      </div>
      <p className="mt-2 text-sm text-ink-soft">
        {linea.fraccionable ? "Acepta decimales con coma." : "Se vende por unidad: sin decimales."}
      </p>
      <div className="mt-5 flex gap-3">
        <Boton variante="principal" disabled={!parsed} onClick={() => parsed && onAceptar(parsed)}>
          Aceptar <span className="fh-num opacity-70">Enter</span>
        </Boton>
        <Boton variante="fantasma" onClick={onCerrar}>
          Esc cancelar
        </Boton>
      </div>
    </Dialogo>
  );
}

// ============================================================
// Cobrar
// ============================================================

function Cobrar({
  total,
  lineas,
  config,
  onCerrar,
  onCobrada,
}: {
  total: VentaCalculada;
  lineas: Linea[];
  config: Config;
  onCerrar: () => void;
  onCobrada: (mensaje: string, aviso: string | null) => void;
}) {
  const [efectivo, setEfectivo] = useState("");
  const [debito, setDebito] = useState("");
  const [referencia, setReferencia] = useState("");
  const [folio, setFolio] = useState("");
  const [docType, setDocType] = useState<"BOLETA" | "FACTURA" | "NONE">("BOLETA");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => campo.current?.focus(), []);

  const soloDigitos = (v: string) => v.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  const nDebito = Number(debito || 0);
  const nEfectivo = Number(efectivo || 0);

  /**
   * La vista previa del cobro usa la MISMA función del servidor. Si los montos
   * todavía no cuadran, `calcularVenta` lanza y acá se muestra el motivo — que
   * es exactamente el mensaje que daría el servidor.
   */
  const previa = useMemo(() => {
    const pagos: Parameters<typeof calcularVenta>[0]["pagos"] = [];
    if (nDebito > 0) pagos.push({ method: "DEBIT", amount: nDebito, reference: referencia || null });
    if (efectivo !== "") pagos.push({ method: "CASH", receivedAmount: nEfectivo });
    if (pagos.length === 0) return { venta: null, problema: "Indica cómo paga el cliente." };
    try {
      return {
        venta: calcularVenta({
          lineas: lineas.map((l) => ({
            productId: l.producto.id,
            qtyMilli: l.qtyMilli,
            unitPriceGross: l.producto.priceGross,
            discountAmount: l.discountAmount,
          })),
          pagos,
          taxRatePercent: config.taxRatePercent,
          multiploRedondeo: config.multiploRedondeo,
        }),
        problema: null,
      };
    } catch (e) {
      return { venta: null, problema: e instanceof ErrorDeVenta ? e.message : "Los montos no cuadran." };
    }
  }, [nDebito, nEfectivo, efectivo, referencia, lineas, config]);

  async function cobrar() {
    setEnviando(true);
    setError(null);
    try {
      const pagos: unknown[] = [];
      if (nDebito > 0) pagos.push({ method: "DEBIT", amount: nDebito, reference: referencia || null });
      if (efectivo !== "") pagos.push({ method: "CASH", receivedAmount: nEfectivo });

      const r = await api<{ mensaje: string; cambio: number; avisoImpresion: string | null }>("/sales", {
        method: "POST",
        body: JSON.stringify({
          items: lineas.map((l) => ({ productId: l.producto.id, qtyMilli: l.qtyMilli, discountAmount: l.discountAmount })),
          payments: pagos,
          fiscalDocType: docType,
          fiscalFolio: folio || null,
        }),
      });
      onCobrada(r.mensaje, r.avisoImpresion);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cobrar");
    } finally {
      setEnviando(false);
    }
  }

  const efectivoACobrar = previa.venta?.pagos.find((p) => p.method === "CASH")?.amount ?? null;
  const vuelto = previa.venta?.changeAmount ?? 0;

  return (
    <Dialogo onCerrar={onCerrar} ancho="max-w-2xl">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-bold">A cobrar</h2>
        <span className="fh-num text-3xl font-black">{formatCLP(previa.venta?.totalGross ?? total.totalGross)}</span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">Efectivo recibido</span>
          <input
            ref={campo}
            value={efectivo === "" ? "" : "$" + new Intl.NumberFormat("es-CL").format(nEfectivo)}
            onChange={(e) => setEfectivo(soloDigitos(e.target.value))}
            inputMode="numeric"
            placeholder="$0"
            className="fh-num min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-bg px-3 text-2xl font-bold"
          />
          <span className="mt-1 block text-xs text-ink-soft">Lo que puso el cliente sobre el mesón.</span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">Débito o crédito</span>
          <input
            value={debito === "" ? "" : "$" + new Intl.NumberFormat("es-CL").format(nDebito)}
            onChange={(e) => setDebito(soloDigitos(e.target.value))}
            inputMode="numeric"
            placeholder="$0"
            className="fh-num min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-bg px-3 text-2xl font-bold"
          />
          <input
            value={referencia}
            onChange={(e) => setReferencia(e.target.value)}
            placeholder="Nº de comprobante"
            className="mt-1 min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-3 text-sm"
          />
        </label>
      </div>

      {efectivoACobrar !== null && previa.venta ? (
        <p className="mt-3 text-sm text-ink-soft">
          Efectivo a cobrar <span className="fh-num font-semibold text-ink">{formatCLP(efectivoACobrar)}</span>
          {previa.venta.roundingAmount !== 0
            ? ` — se redondeó ${formatCLP(previa.venta.roundingAmount)}: la tarjeta va al peso exacto.`
            : ""}
        </p>
      ) : null}

      {/* El vuelto aparece apenas se escribe el efectivo, no después de cobrar. */}
      <div className="mt-4 border-t border-line pt-4 text-center">
        <div className="text-xs uppercase tracking-wide text-ink-soft">Vuelto</div>
        <div className="fh-num text-[3rem] font-black leading-none tracking-tight">{formatCLP(vuelto)}</div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4">
        <fieldset>
          {/*
            Radios de verdad, no botones con un borde distinto. En la primera
            versión los tres se veían idénticos y "Boleta" ya estaba elegido:
            un estado seleccionado que no se distingue es exactamente el estado
            confundible que el brief prohíbe (§2.4). El punto del radio no
            depende del color, y además se recorre con las flechas, que en una
            pantalla que se opera sin mouse no es un detalle.
          */}
          <legend className="mb-1 block text-sm font-medium text-ink-soft">Documento</legend>
          <div className="flex gap-4">
            {(["BOLETA", "FACTURA", "NONE"] as const).map((d) => (
              <label key={d} className="flex min-h-touch cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="documento"
                  checked={docType === d}
                  onChange={() => setDocType(d)}
                  className="h-4 w-4 accent-ink"
                />
                <span className={docType === d ? "font-semibold" : "text-ink-soft"}>
                  {d === "NONE" ? "Ninguno" : d === "BOLETA" ? "Boleta" : "Factura"}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">Folio</span>
          <input
            value={folio}
            onChange={(e) => setFolio(e.target.value)}
            placeholder="del POS tributario"
            className="fh-num min-h-touch w-40 rounded-[var(--fh-radio)] border border-line bg-surface px-3"
          />
        </label>
      </div>

      {previa.problema ? <p className="mt-4 text-sm text-warn">{previa.problema}</p> : null}
      {error ? (
        <div className="mt-4 rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      ) : null}

      <div className="mt-5 flex gap-3">
        <Boton variante="principal" disabled={enviando || !previa.venta} onClick={cobrar}>
          Cobrar e imprimir <span className="fh-num opacity-70">F2</span>
        </Boton>
        <Boton variante="fantasma" onClick={onCerrar}>
          Esc volver
        </Boton>
      </div>
      {/*
        Solo se afirma algo cuando el cálculo es válido. Con los montos sin
        cuadrar, `previa.venta` es null y no se sabe si va a entrar efectivo:
        decir "el cajón no se abre" ahí es afirmar algo que nadie verificó, que
        es el mismo error del chip de caja del Sprint 0.
      */}
      {previa.venta ? (
        <p className="mt-2 text-xs text-ink-soft">
          {previa.venta.pagos.some((p) => p.method === "CASH")
            ? "Al cobrar sale el ticket y se abre el cajón."
            : "Al cobrar sale el ticket. El cajón no se abre: esta venta va toda con tarjeta."}
        </p>
      ) : null}
    </Dialogo>
  );
}

function Dialogo({
  children,
  onCerrar,
  ancho = "max-w-lg",
}: {
  children: React.ReactNode;
  onCerrar: () => void;
  ancho?: string;
}) {
  useEffect(() => {
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [onCerrar]);

  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-ink/40 p-6" role="dialog" aria-modal="true">
      <div className={`w-full ${ancho} rounded-[var(--fh-radio)] border border-line bg-surface p-6`}>{children}</div>
    </div>
  );
}
