/**
 * Devoluciones y anulaciones (tarea 4.6, ADR-002).
 *
 * **La pantalla que faltaba para poder empezar la marcha blanca.** El endpoint
 * existe y está probado desde el Sprint 4, pero digitar una devolución era por
 * API — y una ferretería tiene una devolución en la primera semana.
 *
 * SE ENTRA POR EL NÚMERO DEL TICKET. El comprobante trae impreso «Venta #47»
 * y ese número es la llave. (El ejemplo lleva dos dígitos a propósito: con tres
 * sería una tira hexadecimal válida y `check:tokens` lo leería como un color
 * fuera de `tokens.css`. El guardián no puede distinguirlos, y protege algo que
 * importa más que este ejemplo.) El listado del día es solo del administrador, no
 * por capricho: veinte totales sumados a mano son la venta del día, y esa cifra
 * no le viaja al vendedor porque el arqueo es a ciegas (precisión de la
 * decisión 17). Para atender a alguien no hace falta: el cliente trae su
 * ticket, y si lo perdió, la devolución igual la autoriza un administrador.
 *
 * UNA VENTA NUNCA SE EDITA NI SE BORRA (decisión 5). Devolver escribe una venta
 * CONTRARIA que apunta a la original, y el par suma cero. Por eso acá no hay
 * ningún botón de "corregir": hay devolver y anular, y las dos dejan rastro.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Acciones, Boton, Campo, Chip, Modal, Selector, Tarjeta } from "@/components/ui";
import { formatCLP, formatHora, formatQty, PAYMENT_METHOD_TEXT } from "@ferrehouse/shared";
import { Link } from "react-router-dom";

type Linea = {
  itemId: number;
  productId: number;
  nombre: string;
  unidad: string;
  allowsFraction: boolean;
  qtyMilli: number;
  returnedQtyMilli: number;
  vivoQtyMilli: number;
  /** Precio unitario COBRADO, congelado en la línea. Sirve para el monto. */
  unitPriceGross: number;
  texto: string;
};

type Devolvible = {
  venta: { id: number; createdAt: string; totalGross: number; status: string };
  esReversa: boolean;
  anulada: boolean;
  lineas: Linea[];
};

type VentaDelDia = {
  id: number;
  createdAt: string;
  totalGross: number;
  fiscalFolio: string | null;
  user: { name: string };
  etiquetaTexto: string;
  etiquetaTono: "ok" | "warn" | "error" | "neutral";
};

/**
 * La hora sale de `formatHora`, la de `shared`, y no de un `Intl` escrito acá.
 * El default de `es-CL` es de 12 horas —«07:37 a. m.»— y el resto de la
 * aplicación muestra 24. Dos relojes distintos en la misma pantalla es
 * exactamente lo que esa función existe para evitar.
 */
function fechaYHora(iso: string): string {
  const d = new Date(iso);
  return `${new Intl.DateTimeFormat("es-CL", { day: "numeric", month: "long" }).format(d)}, ${formatHora(d)}`;
}

export function Devoluciones() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.role === "ADMIN";

  const [numero, setNumero] = useState("");
  const [venta, setVenta] = useState<Devolvible | null>(null);
  const [cantidades, setCantidades] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [confirmar, setConfirmar] = useState<"RETURN" | "VOID" | null>(null);
  const [hecho, setHecho] = useState<{ mensaje: string; aviso: string | null } | null>(null);
  const [delDia, setDelDia] = useState<VentaDelDia[] | null>(null);
  const [cajaAbierta, setCajaAbierta] = useState<boolean | null>(null);
  const [verLista, setVerLista] = useState(true);
  const [reimprimiendo, setReimprimiendo] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => campo.current?.focus(), []);

  /**
   * La caja tiene que estar abierta: el efectivo de la devolución sale del
   * turno de AHORA, no del día de la venta, que puede llevar semanas cerrado.
   * Se avisa al entrar y no al confirmar, con el cliente esperando y el
   * formulario lleno — el mismo criterio que la pantalla de venta.
   */
  useEffect(() => {
    void api<{ abierta: boolean }>("/cash/current")
      .then((r) => setCajaAbierta(r.abierta))
      .catch(() => setCajaAbierta(null));
  }, []);

  const cargarDia = useCallback(async () => {
    if (!esAdmin) return;
    try {
      setDelDia((await api<{ ventas: VentaDelDia[] }>("/sales")).ventas);
    } catch {
      setDelDia([]);
    }
  }, [esAdmin]);

  useEffect(() => {
    void cargarDia();
  }, [cargarDia]);

  /**
   * Reimprimir el ticket (tarea 3.8).
   *
   * Es lo más cotidiano que había quedado sin pantalla: se atascó la impresora,
   * el papel salió en blanco, el cliente quiere una copia. Va acá y no en otro
   * lado porque esta pantalla ya sabe buscar una venta por su número, que es
   * exactamente lo que una reimpresión necesita.
   *
   * **La copia sale marcada como copia y NO abre el cajón.** Lo segundo importa
   * más de lo que parece: un vendedor que crea que reimprimir abre el cajón lo
   * va a usar para abrir el cajón, y un cajón que se abre sin una venta detrás
   * es justo lo que un arqueo no puede explicar.
   */
  async function reimprimir(id: number) {
    setReimprimiendo(true);
    setError(null);
    try {
      const r = await api<{ mensaje: string }>(`/sales/${id}/reprint`, { method: "POST", body: "{}" });
      setHecho({ mensaje: r.mensaje, aviso: null });
    } catch (e) {
      // El caso más probable es una estación sin impresora —un terminal de
      // consulta—, y el servidor lo dice con el nombre de la caja adentro.
      setError(e instanceof ApiError ? e.message : "No se pudo reimprimir");
    } finally {
      setReimprimiendo(false);
    }
  }

  async function buscar(id: number) {
    setBuscando(true);
    setError(null);
    setHecho(null);
    try {
      const d = await api<Devolvible>(`/sales/${id}/returnable`);
      setVenta(d);
      /*
        Elegida la venta, el listado del día es ruido y además empuja la tabla
        bajo el pliegue: a 1366×768 —el presupuesto del brief— con el aviso de
        una devolución recién hecha, las cantidades y los botones quedaban
        fuera de la pantalla. Se puede volver a abrir con un clic.
      */
      setVerLista(false);
      // Se abre con todo en cero: devolver de más es más fácil de hacer sin
      // querer que devolver de menos, y solo una de las dos se puede deshacer.
      setCantidades(Object.fromEntries(d.lineas.map((l) => [l.itemId, ""])));
    } catch (e) {
      setVenta(null);
      setError(e instanceof ApiError ? e.message : "No se pudo buscar esa venta");
    } finally {
      setBuscando(false);
    }
  }

  function todo() {
    if (!venta) return;
    setCantidades(
      Object.fromEntries(
        venta.lineas.map((l) => [l.itemId, l.vivoQtyMilli > 0 ? String(l.vivoQtyMilli / 1000) : ""]),
      ),
    );
  }

  const marcadas = venta
    ? venta.lineas
        .map((l) => ({ l, milli: Math.round((Number(cantidades[l.itemId]?.replace(",", ".")) || 0) * 1000) }))
        .filter((x) => x.milli > 0)
    : [];

  /**
   * El monto estimado, o `null` si no se puede calcular.
   *
   * `null` y no cero: si por lo que sea una línea llega sin precio —un servidor
   * más viejo que esta pantalla, por ejemplo— el botón vuelve a decir «Devolver
   * lo marcado» en vez de «Devolver $NaN». Un botón que mueve plata no puede
   * mostrar basura, y «$NaN» además parece un monto.
   */
  const montoEstimado = marcadas.every((x) => Number.isFinite(x.l.unitPriceGross))
    ? marcadas.reduce((s, x) => s + Math.round((x.l.unitPriceGross * x.milli) / 1000), 0)
    : null;
  const excedida = marcadas.find((x) => x.milli > x.l.vivoQtyMilli);
  const puedeDevolver = marcadas.length > 0 && !excedida;
  const algoVivo = venta ? venta.lineas.some((l) => l.vivoQtyMilli > 0) : false;

  if (cajaAbierta === false) {
    return (
      <div className="rounded-[var(--fh-radio)] border border-line bg-surface p-8 text-center">
        <Chip tono="neutral">caja cerrada</Chip>
        <p className="mt-3 text-lg">
          La caja está cerrada. Ábrela antes de devolver: la plata sale del turno de ahora.
        </p>
        <Link to="/caja" className="mt-4 inline-block">
          <Boton variante="principal">Ir a la caja</Boton>
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-black tracking-tight">Devolver o anular</h1>
        <span className="text-sm text-ink-soft">
          {usuario?.name} · {esAdmin ? "administrador" : "vendedor"}
        </span>
      </div>

      {/*
        La búsqueda ocupa una tarjeta entera mientras es lo único que hay que
        hacer, y se encoge a una línea cuando ya hay una venta en pantalla. Con
        cinco líneas —una compra normal de ferretería— la versión grande
        empujaba los botones a 848 px en una pantalla de 768: se alcanzaban
        desplazando, pero el presupuesto del brief es 1366×768 y una acción que
        hay que ir a buscar se aprende como "no está".
      */}
      <div className={venta ? "flex flex-wrap items-center gap-3 text-sm" : "contents"}>
      {venta ? (
        <>
          <span className="font-semibold uppercase tracking-wide text-ink-soft">Otra venta</span>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const n = Number(numero.replace(/\D/g, ""));
              if (n > 0) void buscar(n);
            }}
          >
            <input
              value={numero}
              inputMode="numeric"
              onChange={(e) => setNumero(e.target.value)}
              placeholder="N°"
              className="fh-num min-h-touch w-24 rounded-[var(--fh-radio)] border border-line bg-surface px-3"
            />
            <Boton type="submit" disabled={buscando}>
              Buscar
            </Boton>
          </form>
          {esAdmin && delDia !== null ? (
            <button
              onClick={() => {
                setVenta(null);
                setVerLista(true);
              }}
              className="underline underline-offset-4 text-ink-soft hover:text-ink"
            >
              Ver las {delDia.length} de hoy
            </button>
          ) : null}
          {error ? <span className="text-error">{error}</span> : null}
        </>
      ) : (
      <Tarjeta titulo="Qué venta">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(numero.replace(/\D/g, ""));
            if (n > 0) void buscar(n);
          }}
        >
          <div className="w-full max-w-[640px]">
            <Campo
              ref={campo}
              etiqueta="Número de la venta"
              hint="Sale en el ticket: «Venta #47»"
              inputMode="numeric"
              protagonista
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="123"
              className="fh-num h-[58px] font-mono text-lg"
            />
          </div>
          <Boton variante="principal" type="submit" disabled={buscando || numero.trim() === ""}>
            {buscando ? "Buscando…" : "Buscar"}
          </Boton>
          {error ? <span className="text-sm text-error">{error}</span> : null}
        </form>

        {esAdmin && delDia !== null ? (
          <div className="mt-4 border-t border-line pt-3">
            {verLista ? (
              <p className="mb-2 text-sm text-ink-soft">
                {delDia.length === 0 ? "Todavía no hay ventas hoy." : "O elige una de hoy:"}
              </p>
            ) : (
              <button
                onClick={() => setVerLista(true)}
                className="text-sm text-ink-soft underline underline-offset-4 hover:text-ink"
              >
                Ver las {delDia.length} ventas de hoy
              </button>
            )}
            <div className={`max-h-40 overflow-y-auto ${verLista ? "" : "hidden"}`}>
              {delDia.map((v) => (
                <button
                  key={v.id}
                  onClick={() => {
                    setNumero(String(v.id));
                    void buscar(v.id);
                  }}
                  className="flex w-full items-center gap-3 rounded-[var(--fh-radio)] px-2 py-1.5 text-left text-sm hover:bg-bg"
                >
                  <span className="fh-num w-14 font-semibold">#{v.id}</span>
                  <span className="fh-num w-14 text-ink-soft">{formatHora(v.createdAt)}</span>
                  <span className="fh-num w-24 text-right">{formatCLP(v.totalGross)}</span>
                  <span className="flex-1 truncate text-ink-soft">{v.user.name}</span>
                  <Chip tono={v.etiquetaTono}>{v.etiquetaTexto}</Chip>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Tarjeta>
      )}
      </div>

      {hecho ? (
        <div className="rounded-[var(--fh-radio)] border border-ok/40 bg-ok/10 p-4">
          <p className="font-semibold">{hecho.mensaje}</p>
          {hecho.aviso ? <p className="mt-1 text-sm text-ink-soft">{hecho.aviso}</p> : null}
        </div>
      ) : null}

      {venta ? (
        <Tarjeta titulo={`Venta #${venta.venta.id}`}>
          <div className="mb-3 flex flex-wrap items-center gap-4 text-sm text-ink-soft">
            <span>{fechaYHora(venta.venta.createdAt)}</span>
            <span className="fh-num text-base font-semibold text-ink">{formatCLP(venta.venta.totalGross)}</span>
            {venta.anulada ? <Chip tono="error">anulada</Chip> : null}
            {venta.esReversa ? <Chip tono="warn">es una devolución</Chip> : null}
            <span className="flex-1" />
            <button
              onClick={() => void reimprimir(venta.venta.id)}
              disabled={reimprimiendo}
              className="underline underline-offset-4 hover:text-ink disabled:opacity-40"
            >
              {reimprimiendo ? "Imprimiendo…" : "Reimprimir ticket"}
            </button>
            <span className="text-xs">sale marcado como copia · no abre el cajón</span>
          </div>

          {/*
            Las dos puertas cerradas se dicen ANTES de mostrar la tabla, no
            después de que alguien llenó las cantidades. Devolver una
            devolución y anular lo ya anulado son los dos errores que el
            modelo no puede permitir, y descubrirlos al confirmar es descubrir
            que se perdió el tiempo.
          */}
          {venta.esReversa ? (
            <p className="text-sm">
              Esta fila <strong>es</strong> una devolución, no una venta. Si hay que corregirla, se hace sobre la venta
              original.
            </p>
          ) : venta.anulada ? (
            <p className="text-sm">Esta venta ya está anulada entera. No queda nada que devolver.</p>
          ) : !algoVivo ? (
            <p className="text-sm">Ya se devolvió todo lo de esta venta.</p>
          ) : (
            <>
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-ink text-left text-[10.5px] uppercase tracking-[0.11em] text-ink-soft">
                    <th className="py-[9px] font-extrabold">Producto</th>
                    <th className="py-[9px] text-right font-extrabold">Vendido</th>
                    <th className="py-[9px] text-right font-extrabold">Ya devuelto</th>
                    <th className="py-[9px] text-right font-extrabold">Queda</th>
                    <th className="py-[9px] text-right font-extrabold">Devolver ahora</th>
                    <th className="py-[9px] text-right font-extrabold">Monto</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {venta.lineas.map((l) => {
                    const valor = cantidades[l.itemId] ?? "";
                    const milli = Math.round((Number(valor.replace(",", ".")) || 0) * 1000);
                    const pasado = milli > l.vivoQtyMilli;
                    const marcada = milli > 0 && !pasado;
                    return (
                      <tr
                        key={l.itemId}
                        /* La fila marcada se tiñe: con seis líneas y dos
                           marcadas, el número tecleado en la penúltima columna
                           no se ve de un vistazo. El tinte sí. */
                        className={`border-b border-line-soft ${marcada ? "bg-accent-tint" : ""}`}
                      >
                        <td className="py-[10px] font-semibold">{l.nombre}</td>
                        <td className="fh-num py-[10px] text-right">
                          {formatQty(l.qtyMilli, l.allowsFraction)} {l.unidad}
                        </td>
                        <td className="fh-num py-[10px] text-right text-ink-soft">
                          {l.returnedQtyMilli === 0
                            ? "—"
                            : `${formatQty(l.returnedQtyMilli, l.allowsFraction)} ${l.unidad}`}
                        </td>
                        <td className="fh-num py-[10px] text-right font-semibold">
                          {/* Con unidad: es el número contra el que se compara lo que se teclea,
                              y en un producto fraccionable «0,5» sin «m» no dice nada. */}
                          {formatQty(l.vivoQtyMilli, l.allowsFraction)} {l.unidad}
                        </td>
                        <td className="py-[10px] text-right">
                          {l.vivoQtyMilli === 0 ? (
                            <span className="text-xs text-ink-soft">nada</span>
                          ) : (
                            <input
                              value={valor}
                              inputMode="decimal"
                              onChange={(e) => setCantidades((c) => ({ ...c, [l.itemId]: e.target.value }))}
                              className={`fh-num min-h-touch w-24 border-2 bg-surface px-2 text-right ${
                                pasado ? "border-accent text-accent-ink" : "border-ink"
                              }`}
                            />
                          )}
                        </td>
                        <td className="fh-num py-[10px] text-right font-semibold">
                          {marcada && Number.isFinite(l.unitPriceGross)
                            ? formatCLP(Math.round((l.unitPriceGross * milli) / 1000))
                            : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {excedida ? (
                <p className="mt-3 text-sm text-error">
                  De «{excedida.l.nombre}» quedan {formatQty(excedida.l.vivoQtyMilli, excedida.l.allowsFraction)}{" "}
                  {excedida.l.unidad} sin devolver. No se puede devolver más de lo que se vendió.
                </p>
              ) : null}

              <div className="mt-4 flex flex-wrap items-center gap-3">
                {/*
                  El botón dice el monto. «Confirmar» no dice nada, y en una
                  acción que saca plata del cajón el número es justamente lo
                  que hay que leer antes de apretar. Es una estimación con el
                  precio congelado de la línea: el monto exacto —con descuento
                  prorrateado y redondeo— lo calcula el servidor.
                */}
                <Boton variante="principal" disabled={!puedeDevolver} onClick={() => setConfirmar("RETURN")}>
                  {puedeDevolver && montoEstimado !== null ? `Devolver ${formatCLP(montoEstimado)}` : "Devolver lo marcado"}
                </Boton>
                <Boton onClick={todo}>Marcar todo lo que queda</Boton>
                <span className="flex-1" />
                {/*
                  Anular está separado y al otro extremo: no es "devolver todo",
                  es otro documento con otro nombre, y el que se equivoca de
                  botón deja escrito algo distinto de lo que pasó.
                */}
                <Boton onClick={() => setConfirmar("VOID")}>Anular la venta entera</Boton>
              </div>
            </>
          )}
        </Tarjeta>
      ) : null}

      {confirmar && venta ? (
        <Confirmar
          tipo={confirmar}
          venta={venta}
          items={marcadas.map((x) => ({ itemId: x.l.itemId, qtyMilli: x.milli }))}
          pideePin={!esAdmin}
          onCerrar={() => setConfirmar(null)}
          onListo={async (mensaje, aviso) => {
            setConfirmar(null);
            /*
              El aviso se pone DESPUÉS de recargar, no antes: `buscar` limpia el
              resultado anterior —tiene que hacerlo, si no el mensaje de una
              devolución quedaría colgado sobre otra venta— y ponerlo primero lo
              borraba en el acto. La devolución quedaba registrada y la pantalla
              no lo decía; había que deducirlo de la tabla.
            */
            await buscar(venta.venta.id);
            await cargarDia();
            setHecho({ mensaje, aviso });
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * El paso que compromete. Lleva cuatro cosas y ninguna es decorativa:
 *
 * - **El motivo** es obligatorio y de al menos 4 letras (lo impone el servidor).
 *   Una devolución sin motivo no se puede explicar tres meses después.
 * - **El medio de reembolso** decide si se abre el cajón: en efectivo hay que
 *   sacar plata, con tarjeta la devuelve el POS.
 * - **El folio de la nota de crédito** es el del documento tributario, que lo
 *   emite el otro equipo. Es opcional acá porque a veces se emite después.
 * - **El PIN del administrador**, si lo digita un vendedor: una devolución mueve
 *   plata hacia afuera y la entrega el mismo que la digita.
 */
function Confirmar({
  tipo,
  venta,
  items,
  pideePin,
  onCerrar,
  onListo,
}: {
  tipo: "RETURN" | "VOID";
  venta: Devolvible;
  items: Array<{ itemId: number; qtyMilli: number }>;
  pideePin: boolean;
  onCerrar: () => void;
  onListo: (mensaje: string, aviso: string | null) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [refundMethod, setRefundMethod] = useState<"CASH" | "DEBIT" | "CREDIT" | "TRANSFER">("CASH");
  const [fiscalFolio, setFiscalFolio] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const primero = useRef<HTMLInputElement>(null);

  useEffect(() => primero.current?.focus(), []);

  async function enviar() {
    setEnviando(true);
    setError(null);
    try {
      const r = await api<{ mensaje: string; avisoImpresion: string | null }>(
        `/sales/${venta.venta.id}/${tipo === "VOID" ? "void" : "return"}`,
        {
          method: "POST",
          body: JSON.stringify({
            ...(tipo === "RETURN" ? { items } : {}),
            reason: reason.trim(),
            refundMethod,
            fiscalFolio: fiscalFolio.trim() || null,
            ...(adminPin ? { adminPin } : {}),
          }),
        },
      );
      await onListo(r.mensaje, r.avisoImpresion);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo registrar");
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo={tipo === "VOID" ? `Anular la venta #${venta.venta.id}` : `Devolver de la venta #${venta.venta.id}`}
      bajada={
        tipo === "VOID" ? (
          <>
            Se devuelve <strong>todo lo que quede vivo</strong> de esta venta y queda como anulada. La venta original no
            se borra: se escribe un documento contrario que apunta a ella.
          </>
        ) : (
          <>
            Se devuelven {items.length} {items.length === 1 ? "línea" : "líneas"}. La venta original no se toca: esto es
            un documento propio, con su propio folio.
          </>
        )
      }
      onCerrar={onCerrar}
    >
      <div className="grid gap-4">
        <Campo
          ref={primero}
          etiqueta="Motivo"
          hint="Queda escrito para siempre. «Falló», «se arrepintió», «era la medida equivocada»."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
        />
        <div className="grid grid-cols-2 gap-4">
          <Selector
            etiqueta="Cómo se devuelve"
            hint="En efectivo se abre el cajón."
            value={refundMethod}
            onChange={(e) => setRefundMethod(e.target.value as typeof refundMethod)}
          >
            {(["CASH", "DEBIT", "CREDIT", "TRANSFER"] as const).map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_TEXT[m]}
              </option>
            ))}
          </Selector>
          <Campo
            etiqueta="Folio de la nota de crédito"
            hint="Opcional: si se emite después, se deja vacío."
            value={fiscalFolio}
            onChange={(e) => setFiscalFolio(e.target.value)}
            className="fh-num"
          />
        </div>

        {pideePin ? (
          <Campo
            etiqueta="PIN del administrador"
            hint="Una devolución la autoriza un administrador. Queda registrado quién."
            type="password"
            inputMode="numeric"
            value={adminPin}
            onChange={(e) => setAdminPin(e.target.value)}
            className="fh-num"
          />
        ) : null}

        {error ? <p className="text-sm text-error">{error}</p> : null}

        <Acciones>
          <Boton variante="secundaria" type="button" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton
            variante="principal"
            type="button"
            disabled={enviando || reason.trim().length < 4 || (pideePin && adminPin.length < 4)}
            onClick={() => void enviar()}
          >
            {enviando ? "Registrando…" : tipo === "VOID" ? "Anular" : "Devolver"}
          </Boton>
        </Acciones>
      </div>
    </Modal>
  );
}
