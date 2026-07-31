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
import { Barcode } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAtajos } from "@/lib/atajos";
import { copiarAlPortapapeles } from "@/lib/portapapeles";
import { Boton, Campo, Chip, Tecla } from "@/components/ui";
import {
  calcularVenta,
  formatCLP,
  formatHora,
  formatQty,
  atajosVisibles,
  normalizarTelefono,
  requiereAutorizacion,
  ErrorDeVenta,
  type VentaCalculada,
} from "@ferrehouse/shared";

type Producto = {
  id: number;
  sku: string;
  name: string;
  priceGross: number;
  saleUnit: { id: number; symbol: string; factorMilli: number; groupId: number };
  /** Viene en la misma respuesta de búsqueda: no cuesta una consulta extra. */
  stockLevels?: Array<{ qtyBaseMilli: number }>;
};

type Linea = {
  producto: Producto;
  qtyMilli: number;
  discountAmount: number;
  /** El grupo admite fracciones. Se resuelve al agregar, no al teclear. */
  fraccionable: boolean;
};

type Config = { taxRatePercent: number; multiploRedondeo: number; topeDescuento: number };

/**
 * El saldo del producto en unidades de VENTA, para la lista de sugerencias.
 *
 * El libro guarda milésimas de unidad BASE; dividir por `factorMilli` lo pasa
 * a la unidad en que el vendedor lo va a cobrar. Un saco de cemento tiene 25
 * en base (kilos) por cada 1 en venta, y decir «1.500 kg» en la sugerencia de
 * un producto que se vende por saco no ayuda a nadie.
 */
function saldoDe(p: Producto): string {
  if (!p.stockLevels || p.stockLevels.length === 0) return "";
  const base = p.stockLevels.reduce((t, n) => t + n.qtyBaseMilli, 0);
  const enVenta = Math.round((base * 1000) / p.saleUnit.factorMilli);
  return `${formatQty(enVenta)} ${p.saleUnit.symbol}`;
}

export function Venta() {
  const [config, setConfig] = useState<Config | null>(null);
  const [cajaAbierta, setCajaAbierta] = useState<boolean | null>(null);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [seleccion, setSeleccion] = useState(0);
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<"nada" | "cobrar" | "cantidad" | "descuento" | "guardar" | "esperas">("nada");
  /** Descuento sobre el TOTAL (F4). El de línea existe en el modelo pero no se digita acá. */
  const [descuento, setDescuento] = useState(0);
  /**
   * El PIN con que un administrador autorizó un descuento sobre el tope. Viaja
   * con la venta, porque es el servidor el que decide si hacía falta: acá solo
   * se pide cuando la misma cuenta dice que sí, con la misma función.
   */
  const [pinDescuento, setPinDescuento] = useState<string | null>(null);
  /** La espera que se está cobrando, si estas líneas vinieron de una (F8). */
  const [espera, setEspera] = useState<{ id: number; label: string } | null>(null);
  const [ultimoCobro, setUltimoCobro] = useState<{ mensaje: string; aviso: string | null } | null>(null);
  /**
   * Las ventas en espera, para mostrarlas en el panel derecho.
   *
   * Antes solo existían detrás de F8, y una venta esperando que no se ve es
   * una venta que se olvida: el cliente vuelve por su saco de cemento y el
   * vendedor de turno no sabe que hay algo guardado a su nombre. Ahora si hay
   * alguna, se ve; si no hay ninguna, el bloque no aparece.
   */
  const [esperas, setEsperas] = useState<EsperaFila[]>([]);
  /**
   * Las sugerencias que se van mostrando mientras el vendedor escribe.
   * `sugerido` es cuál está marcada; **-1 es «ninguna»**, y eso importa: con
   * -1, Enter vuelve a buscar en el servidor en vez de agregar la primera de
   * la lista. Marcar la primera automáticamente sería repetir el error que
   * esta pantalla tenía —tomaba `productos[0]` a ciegas—, y en una caja eso
   * significa cobrar un destornillador cuando pidieron un tornillo.
   */
  const [sugerencias, setSugerencias] = useState<Producto[]>([]);
  const [sugerido, setSugerido] = useState(-1);
  /** groupId → admite fracción. Se pide una vez, no en cada producto agregado. */
  const [fraccionables, setFraccionables] = useState<Map<number, boolean>>(new Map());

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
        const g = await api<{ grupos: { id: number; allowsFraction: boolean }[] }>("/catalog/units");
        setFraccionables(new Map(g.grupos.map((x) => [x.id, x.allowsFraction])));
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "No se pudo preparar la venta");
      }
    })();
  }, []);

  useEffect(() => {
    if (panel === "nada") volverAlFoco();
  }, [panel, volverAlFoco]);

  /**
   * Las esperas se releen cada vez que se cierra un panel: guardar una, cobrar
   * una o recuperar una cambia la lista, y las tres cosas pasan detrás de un
   * diálogo. Volver al mesón con la lista vieja sería peor que no mostrarla.
   */
  const cargarEsperas = useCallback(async () => {
    try {
      setEsperas((await api<{ esperas: EsperaFila[] }>("/suspended")).esperas);
    } catch {
      // Una lista de esperas que no carga no puede impedir vender.
      setEsperas([]);
    }
  }, []);

  useEffect(() => {
    if (panel === "nada") void cargarEsperas();
  }, [panel, cargarEsperas]);

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
        descuentoVenta: descuento,
        // Sin pagos todavía: se usa una pata en efectivo ficticia para ver el
        // total redondeado, que es el que el vendedor va a decir en voz alta.
        pagos: [{ method: "CASH", receivedAmount: 100_000_000 }],
        taxRatePercent: config.taxRatePercent,
        multiploRedondeo: config.multiploRedondeo,
      });
    } catch {
      return null;
    }
  }, [lineas, config, descuento]);

  /**
   * Sugerencias mientras se escribe, desde la tercera letra.
   *
   * EL ESCÁNER MANDA EN ESTA PANTALLA y por eso esto es solo una ayuda visual:
   * el escáner escribe el código entero y aprieta Enter en menos de lo que
   * dura este retardo, así que quien decide qué se agrega sigue siendo Enter
   * con una búsqueda fresca contra el servidor. Si la respuesta viene marcada
   * `exacto` —código de barras o SKU— no se sugiere nada: no hay nada que
   * elegir, y una lista de uno solo estorba.
   *
   * Desde la TERCERA letra y no la primera: con una o dos calza medio catálogo
   * y la lista es ruido. Con 160 ms de espera, escribir corrido no dispara una
   * consulta por tecla.
   */
  useEffect(() => {
    const q = texto.trim();
    if (q.length < 3 || panel !== "nada") {
      setSugerencias([]);
      setSugerido(-1);
      return;
    }
    let vigente = true;
    const t = setTimeout(() => {
      void (async () => {
        try {
          const r = await api<{ exacto: boolean; productos: Producto[] }>(
            `/products/search?q=${encodeURIComponent(q)}&limit=8`,
          );
          if (!vigente) return;
          setSugerencias(r.exacto ? [] : r.productos);
          setSugerido(-1);
        } catch {
          // Una sugerencia que no llega no es un error que mostrar: el vendedor
          // sigue pudiendo apretar Enter, que es el camino que sí avisa.
          if (vigente) setSugerencias([]);
        }
      })();
    }, 160);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [texto, panel]);

  function agregarProducto(p: Producto) {
    agregar(p, fraccionables.get(p.saleUnit.groupId) ?? true);
    setTexto("");
    setSugerencias([]);
    setSugerido(-1);
    setError(null);
    volverAlFoco();
  }

  /**
   * Enter. Vuelve a preguntarle al servidor —no usa la lista— porque puede no
   * haber alcanzado a cargarse.
   *
   * Antes tomaba `productos[0]` pasara lo que pasara: escribir «tor» y apretar
   * Enter agregaba «Juego de destornilladores» porque va primero en orden
   * alfabético, sin decir que había otras siete opciones. Ahora, si calza más
   * de una, no se agrega ninguna: se muestran y se elige con ↑↓.
   */
  async function buscarYAgregar(q: string) {
    if (!q.trim()) return;
    setError(null);
    try {
      const r = await api<{ exacto: boolean; productos: Producto[] }>(
        `/products/search?q=${encodeURIComponent(q.trim())}&limit=8`,
      );
      if (r.productos.length === 0) {
        setError(`Nada calza con «${q.trim()}».`);
        setSugerencias([]);
        return;
      }
      if (r.exacto || r.productos.length === 1) {
        agregarProducto(r.productos[0]!);
        return;
      }
      setSugerencias(r.productos);
      setSugerido(0);
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

  /**
   * Los atajos van en `window`, no en el contenedor. Colgados de un
   * `onKeyDown` del div morían apenas el vendedor hacía clic en un botón o en
   * el aire: el foco se iba al `body` y la pantalla seguía prometiendo
   * «F2 Cobrar» sin hacer nada. Medido, no supuesto — ver lib/atajos.ts.
   *
   * `Delete` va en la misma tabla pero el hook lo trata distinto: mientras el
   * foco está en un campo de texto es del campo. Antes no lo era, y borrar un
   * carácter mal escrito en el buscador borraba una LÍNEA DE LA VENTA.
   */
  useAtajos(
    {
      ArrowDown: () => setSeleccion((s) => Math.min(s + 1, lineas.length - 1)),
      ArrowUp: () => setSeleccion((s) => Math.max(s - 1, 0)),
      Delete: lineas[seleccion] ? () => quitar(seleccion) : undefined,
      F2: lineas.length > 0 ? () => setPanel("cobrar") : undefined,
      F4: lineas.length > 0 ? () => setPanel("descuento") : undefined,
      F6: lineas.length > 0 ? () => setPanel("guardar") : undefined,
      F8: () => setPanel("esperas"),
    },
    panel === "nada",
  );

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

  const unidades = lineas.reduce((s, l) => s + l.qtyMilli, 0);

  return (
    /*
      `-m-4` cancela el padding del cascarón: el panel del total tiene que
      llegar hasta el borde derecho de la pantalla, con su regla de 2px, y una
      franja de fondo entre el panel y el borde lo convierte en una tarjeta
      flotante. La columna izquierda pone su propio padding.

      El alto va atado a ESE MISMO padding —`100%` de la caja de contenido más
      los 2rem que acabo de cancelar— y no al alto de la barra del cascarón.
      Decía `calc(100vh-3.5rem)`, o sea los 56px de `PosShell` escritos a mano
      en otro archivo: cambiar esa barra habría descuadrado esta pantalla sin
      que nada fallara.
    */
    <div className="-m-4 flex h-[calc(100%+2rem)]">
      {/* ---------- Izquierda: la lista ---------- */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 overflow-hidden p-4 pr-0">
        <div className="relative">
          <div className="flex h-16 items-center gap-3 border-2 border-ink bg-surface px-4">
            <Barcode size={22} strokeWidth={2} strokeLinecap="square" className="shrink-0 text-ink" />
          <input
            ref={caja}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              /*
                Las flechas y Enter se manejan ACÁ y no en el atajo global: con
                el foco en un campo de texto, `useAtajos` deja las teclas de
                edición a quien está escribiendo. Es la misma regla que impide
                que Delete borre una línea de la venta mientras se teclea.
              */
              if (e.key === "ArrowDown" && sugerencias.length > 0) {
                e.preventDefault();
                setSugerido((i) => Math.min(i + 1, sugerencias.length - 1));
              } else if (e.key === "ArrowUp" && sugerencias.length > 0) {
                e.preventDefault();
                setSugerido((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                const elegido = sugerido >= 0 ? sugerencias[sugerido] : undefined;
                if (elegido) agregarProducto(elegido);
                else void buscarYAgregar(texto);
              } else if (e.key === "Escape" && sugerencias.length > 0) {
                e.preventDefault();
                setSugerencias([]);
                setSugerido(-1);
              }
            }}
            placeholder="Escanea el código, o escribe el nombre"
            autoComplete="off"
            role="combobox"
            aria-expanded={sugerencias.length > 0}
            aria-controls="sugerencias"
            className="min-w-0 flex-1 bg-transparent text-[19px] font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-soft/70"
          />
            {/*
              No es decoración: es la promesa que hace que el vendedor no
              persiga el cursor por la pantalla. Está escrita porque se cumple.
            */}
            <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.06em] text-mono-ink">
              El foco vuelve solo acá
            </span>
          </div>

          {sugerencias.length > 0 ? (
            <ul
              id="sugerencias"
              role="listbox"
              className="absolute left-0 right-0 top-full z-20 max-h-80 overflow-y-auto border-2 border-t-0 border-ink bg-surface shadow-flotante"
            >
              {sugerencias.map((p, i) => (
                <li key={p.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === sugerido}
                    onMouseEnter={() => setSugerido(i)}
                    onClick={() => agregarProducto(p)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left ${i === sugerido ? "bg-bg" : ""}`}
                  >
                    <span className="fh-num w-[78px] shrink-0 font-mono text-[11.5px] text-mono-ink">{p.sku}</span>
                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{p.name}</span>
                    {/*
                      El saldo va en la sugerencia porque es la pregunta que
                      sigue: el cliente pide algo y lo primero es si hay. Verlo
                      acá evita ir al catálogo y volver con el cliente esperando.
                    */}
                    <span className="fh-num shrink-0 font-mono text-xs text-ink-soft">{saldoDe(p)}</span>
                    <span className="fh-num w-[92px] shrink-0 text-right text-[15px] font-extrabold">
                      {formatCLP(p.priceGross)}
                    </span>
                  </button>
                </li>
              ))}
              <li className="border-t border-line-soft bg-bg px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-mono-ink">
                ↑↓ elegir · Enter agregar · Esc cerrar
              </li>
            </ul>
          ) : null}
        </div>

        {error ? <div className="border border-accent bg-accent-tint p-3 text-sm text-accent-ink">{error}</div> : null}
        {ultimoCobro ? (
          <div className="border border-ok bg-ok/[0.08] p-3 text-sm text-ok-ink">{ultimoCobro.mensaje}</div>
        ) : null}
        {/* Si prometí un ticket y no salió, hay que decirlo en el momento. */}
        {ultimoCobro?.aviso ? (
          <div className="border border-warn bg-warn/10 p-3 text-sm text-warn-ink">{ultimoCobro.aviso}</div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto border border-line bg-surface">
          {lineas.length === 0 ? (
            <p className="p-8 text-center text-ink-soft">
              Escanea el primer producto, o escribe su nombre y aprieta Enter.
            </p>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b-2 border-ink text-[10.5px] uppercase tracking-[0.11em] text-ink-soft">
                  <th className="px-[14px] py-[9px] text-left font-extrabold">Producto</th>
                  <th className="w-[130px] px-[14px] py-[9px] text-right font-extrabold">Cantidad</th>
                  <th className="w-[118px] px-[14px] py-[9px] text-right font-extrabold">P. unit.</th>
                  <th className="w-[130px] px-[14px] py-[9px] text-right font-extrabold">Total</th>
                </tr>
              </thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr
                    key={l.producto.id}
                    onClick={() => setSeleccion(i)}
                    onDoubleClick={() => setPanel("cantidad")}
                    /* La fila elegida se marca con tinte Y con la barra roja de
                       la izquierda. Solo con el tinte, a 1,5 m del mesón y con
                       la pantalla algo sucia, no se distingue de la de al lado. */
                    className={
                      "cursor-default border-b border-line-soft last:border-0 " +
                      (i === seleccion ? "bg-accent-tint shadow-[inset_4px_0_0_rgb(var(--fh-accent))]" : "")
                    }
                  >
                    <td className="px-[14px] py-[11px]">
                      <div className="text-base font-semibold">{l.producto.name}</div>
                      <div className="fh-num font-mono text-[11px] text-mono-ink">
                        {l.producto.sku} · {l.producto.saleUnit.symbol}
                      </div>
                    </td>
                    <td className="fh-num px-[14px] py-[11px] text-right text-[17px] font-bold">
                      {formatQty(l.qtyMilli, l.fraccionable)} {l.producto.saleUnit.symbol}
                    </td>
                    <td className="fh-num px-[14px] py-[11px] text-right text-[15px] text-ink-soft">
                      {formatCLP(l.producto.priceGross)}
                    </td>
                    <td className="fh-num px-[14px] py-[11px] text-right text-[17px] font-extrabold">
                      {formatCLP(Math.round((l.producto.priceGross * l.qtyMilli) / 1000) - l.discountAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/*
          La barra de ayuda. Va acá abajo, a la vista, y no en un menú: las
          teclas que no están escritas en la pantalla no las usa nadie.
        */}
        <div className="flex h-[42px] shrink-0 items-center gap-4 text-[12.5px] text-ink-soft">
          {/*
            Las teclas F salen de `@ferrehouse/shared`, no de una lista escrita
            acá: son las mismas que registra `useAtajos` más arriba, y tenerlas
            en dos lados es la forma garantizada de que la pantalla anuncie una
            tecla que ya no hace nada.

            Se APAGAN cuando no pueden actuar. Con la venta vacía, F4 y F6 se
            imprimían igual de negras que las que sí funcionan: el vendedor
            aprieta, no pasa nada, y a partir de ahí no le cree a ninguna.
          */}
          {atajosVisibles("venta").map((a) => {
            const vivo = a.tecla === "F8" || lineas.length > 0;
            return (
              <span key={a.tecla} className={`flex items-center gap-1.5 ${vivo ? "" : "opacity-40"}`}>
                <Tecla>{a.etiqueta}</Tecla> {a.accion.toLowerCase()}
              </span>
            );
          })}
          {/* Estas dos no son atajos de pantalla sino de la tabla, y por eso no
              están en la tabla compartida: dependen de que haya una fila. */}
          <span className={`flex items-center gap-1.5 ${lineas.length > 0 ? "" : "opacity-40"}`}>
            <Tecla>↑↓</Tecla> moverse
          </span>
          <span className={`flex items-center gap-1.5 ${lineas.length > 0 ? "" : "opacity-40"}`}>
            <Tecla>Supr</Tecla> quitar línea
          </span>
        </div>
      </div>

      {/* ---------- Derecha: el total y el cobro ---------- */}
      <aside className="flex w-[372px] shrink-0 flex-col border-l-2 border-ink bg-surface">
        <div className="p-5">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink-soft">Total a pagar</div>
          {/* 66px: se lee a 1,5 m del mesón, que es donde está el cliente. */}
          <div className="fh-num text-[66px] font-black leading-none tracking-[-0.035em]">
            {formatCLP(total?.totalGross ?? 0)}
          </div>
          <div className="mt-1.5 text-[12.5px] text-ink-soft">
            {lineas.length === 0
              ? "Sin líneas todavía"
              : `${lineas.length} ${lineas.length === 1 ? "línea" : "líneas"} · ${formatQty(unidades, true)} unidades`}
          </div>

          <dl className="mt-4 border-t border-line pt-3 text-sm">
            <Fila etiqueta="Subtotal" valor={formatCLP(total?.subtotalGross ?? 0)} />
            {/* El descuento se ve SIEMPRE que exista, no solo al cobrar: es la
                diferencia entre el precio de la repisa y lo que se está cobrando,
                y esa diferencia hay que poder explicársela al cliente. */}
            {descuento > 0 ? <Fila etiqueta="Descuento" valor={formatCLP(-descuento)} /> : null}
            {total && total.roundingAmount !== 0 ? (
              <Fila
                etiqueta={`Redondeo a $${config?.multiploRedondeo ?? 10}`}
                valor={formatCLP(total.roundingAmount)}
              />
            ) : null}
            {/* El desglose se muestra siempre, no solo al cobrar: es lo que se
                consulta cuando el cliente pide factura. */}
            <Fila etiqueta="Neto" valor={formatCLP(total?.netAmount ?? 0)} suave />
            <Fila etiqueta={`IVA ${config?.taxRatePercent ?? 19}%`} valor={formatCLP(total?.taxAmount ?? 0)} suave />
          </dl>

          {espera ? (
            <div className="mt-3 border border-line bg-bg px-3 py-2 text-sm">
              Cobrando la espera <strong>«{espera.label}»</strong>
            </div>
          ) : null}

          <Boton
            variante="principal"
            disabled={lineas.length === 0}
            onClick={() => setPanel("cobrar")}
            tecla="F2"
            className="mt-4 h-[78px] w-full text-2xl font-black"
          >
            Cobrar
          </Boton>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <Boton
              disabled={lineas.length === 0}
              onClick={() => setPanel("descuento")}
              tecla="F4"
              className="h-12 w-full"
            >
              Descuento
            </Boton>
            <Boton disabled={lineas.length === 0} onClick={() => setPanel("guardar")} tecla="F6" className="h-12 w-full">
              Espera
            </Boton>
          </div>
        </div>

        {/*
          Las esperas dejan de vivir escondidas detrás de F8. Si hay una venta
          guardada, se ve desde el mesón — y si no hay ninguna, este bloque no
          existe en vez de ocupar espacio diciendo «no hay nada».
        */}
        {esperas.length > 0 ? (
          <div className="mt-auto border-t-2 border-ink bg-bg">
            <div className="flex items-baseline justify-between px-5 py-2.5">
              <span className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink-soft">
                Ventas en espera
              </span>
              <Tecla>F8</Tecla>
            </div>
            <ul className="max-h-56 overflow-y-auto border-t border-line">
              {esperas.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => setPanel("esperas")}
                    className="flex w-full items-center gap-3 border-b border-line-soft px-5 py-2 text-left last:border-0 hover:bg-surface"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{e.label}</span>
                    <span className="fh-num shrink-0 font-mono text-[11px] text-mono-ink">
                      {e.lineas} {e.lineas === 1 ? "línea" : "líneas"} · {formatHora(e.touchedAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
          descuento={descuento}
          adminPin={pinDescuento}
          esperaId={espera?.id ?? null}
          onCerrar={() => setPanel("nada")}
          onCobrada={(mensaje, aviso) => {
            setLineas([]);
            // Todo lo que colgaba de ESTA venta se va con ella: dejar el
            // descuento puesto para la siguiente sería regalar plata en
            // silencio, y dejar la espera atada haría que el próximo cobro
            // intentara consumir una que ya no existe.
            setDescuento(0);
            setPinDescuento(null);
            setEspera(null);
            setPanel("nada");
            setUltimoCobro({ mensaje, aviso });
          }}
        />
      ) : null}

      {panel === "descuento" && total && config ? (
        <Descuento
          subtotal={total.subtotalGross}
          actual={descuento}
          topePorciento={config.topeDescuento}
          onCerrar={() => setPanel("nada")}
          onAplicar={(monto, pin) => {
            setDescuento(monto);
            setPinDescuento(pin);
            setPanel("nada");
          }}
        />
      ) : null}

      {panel === "guardar" ? (
        <GuardarEspera
          lineas={lineas}
          espera={espera}
          onCerrar={() => setPanel("nada")}
          onGuardada={(mensaje) => {
            // El mesón queda libre: de eso se trata dejar algo en espera.
            setLineas([]);
            setDescuento(0);
            setPinDescuento(null);
            setEspera(null);
            setPanel("nada");
            setUltimoCobro({ mensaje, aviso: null });
          }}
        />
      ) : null}

      {panel === "esperas" ? (
        <Esperas
          hayLineas={lineas.length > 0}
          onCerrar={() => setPanel("nada")}
          onRecuperada={(id, label, nuevas, aviso) => {
            setLineas(nuevas);
            setEspera({ id, label });
            setDescuento(0);
            setPinDescuento(null);
            setPanel("nada");
            if (aviso) setError(aviso);
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
        <Boton variante="principal" disabled={!parsed} onClick={() => parsed && onAceptar(parsed)} tecla="Enter">
          Aceptar
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
  descuento,
  adminPin,
  esperaId,
  onCerrar,
  onCobrada,
}: {
  total: VentaCalculada;
  lineas: Linea[];
  config: Config;
  /** Descuento sobre el total, ya aplicado con F4. */
  descuento: number;
  /** El PIN con que se autorizó ese descuento, si hizo falta. */
  adminPin: string | null;
  /** La espera que esta venta viene a cobrar, para que el servidor la consuma. */
  esperaId: number | null;
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
  const botonCobrar = useRef<HTMLButtonElement>(null);
  /**
   * Los dos campos de monto arrancan PLEGADOS. La venta corriente es «todo
   * con débito» o «todo en efectivo justo», y para esas dos no hay nada que
   * digitar: un botón deja el monto puesto. Los campos aparecen al elegir
   * pago mixto, o al usar un botón —para que se VEA lo que va a cobrar antes
   * de confirmar—.
   */
  const [mostrarCampos, setMostrarCampos] = useState(false);
  /** El Nº de comprobante de la tarjeta, plegado: casi nadie lo anota. */
  const [pideReferencia, setPideReferencia] = useState(false);
  const [copiado, setCopiado] = useState(false);

  /**
   * 6.1 — el cliente para el WhatsApp, PLEGADO por omisión.
   *
   * Este diálogo es el camino más rápido de toda la aplicación: se abre, se
   * digita lo que puso el cliente sobre el mesón y se cobra. Tres campos más
   * siempre visibles le cuestan tiempo a cada venta, y la mayoría de las
   * ventas de una ferretería no lleva cliente. Plegado, la venta de siempre no
   * cambia en nada; desplegado, son dos campos y una casilla.
   *
   * No lleva tecla de función: las cuatro que Chrome deja libres ya están
   * tomadas en esta pantalla (ver `atajos.ts`), y reasignar una que el
   * vendedor ya aprendió cuesta más de lo que ahorra. Se llega con Tab, que es
   * lo que el brief exige —el flujo completo sin mouse—, sin romper la tabla.
   */
  const [pideCliente, setPideCliente] = useState(false);
  const [nombreCliente, setNombreCliente] = useState("");
  const [telefonoCliente, setTelefonoCliente] = useState("");
  const [consiente, setConsiente] = useState(false);
  const campoTelefono = useRef<HTMLInputElement>(null);

  /**
   * El teléfono se valida MIENTRAS se escribe, con la misma función que el
   * servidor usa para guardarlo. Dos implementaciones de "qué es un teléfono
   * chileno" terminan discrepando, y la que se ve en pantalla no sería la que
   * decide si el mensaje sale.
   */
  const tel = telefonoCliente.trim() === "" ? null : normalizarTelefono(telefonoCliente);

  /**
   * LOS DOS TOTALES NO SON EL MISMO NÚMERO, y confundirlos cobra de menos o de
   * más en cada venta:
   *
   *   - En efectivo se cobra REDONDEADO al múltiplo configurado, porque no
   *     existe la moneda de $1.
   *   - Con tarjeta se cobra AL PESO EXACTO: no hay vuelto que dar, así que no
   *     hay nada que redondear.
   *
   * `totalGross` viene calculado con una pata en efectivo ficticia, o sea ya
   * trae el redondeo sumado; restarle `roundingAmount` devuelve el exacto.
   */
  const montoEfectivo = total.totalGross;
  const montoTarjeta = total.totalGross - total.roundingAmount;

  /**
   * El foco arranca en «Todo en efectivo», no en «Cobrar».
   *
   * Cobrar nace DESHABILITADO —todavía no se indicó cómo paga el cliente— y un
   * botón deshabilitado no recibe foco: el intento se perdía en silencio y el
   * foco se quedaba en el `body`, o sea que Enter no hacía nada. Se enfoca lo
   * primero que sí se puede apretar, y desde ahí Tab llega a débito.
   */
  const botonEfectivo = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    botonEfectivo.current?.focus();
  }, []);

  function todoEn(medio: "efectivo" | "debito"): void {
    if (medio === "efectivo") {
      setEfectivo(String(montoEfectivo));
      setDebito("");
    } else {
      setDebito(String(montoTarjeta));
      setEfectivo("");
    }
    // Se muestran los campos con el monto ya puesto: el vendedor ve lo que va
    // a cobrar antes de confirmar, y puede corregirlo sin volver atrás.
    setMostrarCampos(true);
    setTimeout(() => botonCobrar.current?.focus(), 0);
  }

  async function copiarTotal(): Promise<void> {
    // Solo los dígitos: es lo que se teclea en el POS de la tarjeta, y un
    // "$6.515" pegado ahí no sirve. Se copia el EXACTO, que es el de tarjeta.
    const ok = await copiarAlPortapapeles(String(montoTarjeta));
    setCopiado(ok);
    if (ok) setTimeout(() => setCopiado(false), 2000);
  }

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
          descuentoVenta: descuento,
          pagos,
          taxRatePercent: config.taxRatePercent,
          multiploRedondeo: config.multiploRedondeo,
        }),
        problema: null,
      };
    } catch (e) {
      return { venta: null, problema: e instanceof ErrorDeVenta ? e.message : "Los montos no cuadran." };
    }
  }, [nDebito, nEfectivo, efectivo, referencia, lineas, config, descuento]);

  async function cobrar() {
    setEnviando(true);
    setError(null);
    try {
      const pagos: unknown[] = [];
      if (nDebito > 0) pagos.push({ method: "DEBIT", amount: nDebito, reference: referencia || null });
      if (efectivo !== "") pagos.push({ method: "CASH", receivedAmount: nEfectivo });

      const r = await api<{
        mensaje: string;
        cambio: number;
        avisoImpresion: string | null;
        avisoCliente: string | null;
        whatsapp: { encolado: boolean; motivo?: string };
      }>("/sales", {
        method: "POST",
        body: JSON.stringify({
          items: lineas.map((l) => ({ productId: l.producto.id, qtyMilli: l.qtyMilli, discountAmount: l.discountAmount })),
          discountAmount: descuento,
          payments: pagos,
          /*
            La espera la consume el SERVIDOR, dentro de la misma transacción que
            escribe la venta. Borrarla acá después de cobrar dejaría una ventana
            en la que dos cajas la tienen recuperada y las dos cobran.
          */
          suspendedSaleId: esperaId,
          ...(adminPin ? { adminPin } : {}),
          fiscalDocType: docType,
          fiscalFolio: folio || null,
          /*
            El teléfono viaja como lo escribieron. Normalizarlo es del
            servidor: es lo que decide si dos ventas son del mismo cliente, y
            eso no puede depender de qué pantalla lo mandó.
          */
          cliente: telefonoCliente.trim()
            ? { nombre: nombreCliente.trim() || null, telefono: telefonoCliente.trim(), consentimiento: consiente }
            : undefined,
        }),
      });

      /*
        Los dos avisos van juntos y ninguno se pierde: el vendedor le dijo al
        cliente "te llega un mensaje", así que si NO va a llegar tiene que
        enterarse ahora, no cuando el cliente reclame.
      */
      const avisos = [r.avisoImpresion, r.avisoCliente].filter(Boolean).join(" ");
      onCobrada(r.whatsapp.encolado ? `${r.mensaje} El WhatsApp sale en unos minutos.` : r.mensaje, avisos || null);
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
        <div className="flex items-baseline gap-3">
          <span className="fh-num text-3xl font-black">{formatCLP(previa.venta?.totalGross ?? total.totalGross)}</span>
          {/*
            Copiar el monto de TARJETA —el exacto— porque es el que hay que
            teclear en la máquina del banco, que es el paso lento de una venta
            con débito. Solo los dígitos: un "$6.515" pegado ahí no sirve.
          */}
          <button
            type="button"
            onClick={() => void copiarTotal()}
            className="text-xs text-ink-soft underline underline-offset-4"
          >
            {copiado ? "copiado ✓" : "copiar"}
          </button>
        </div>
      </div>

      {/*
        Los dos caminos de siempre, sin teclear un peso. El monto de cada botón
        va IMPRESO en el botón: elegir a ciegas entre dos cifras parecidas es
        justo lo que hace que se cobre la equivocada.
      */}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          ref={botonEfectivo}
          onClick={() => todoEn("efectivo")}
          className="min-h-touch rounded-[var(--fh-radio)] border border-line bg-surface p-3 text-left hover:bg-bg"
        >
          <span className="block text-sm font-medium text-ink-soft">Todo en efectivo</span>
          <span className="fh-num block text-2xl font-black">{formatCLP(montoEfectivo)}</span>
          <span className="block text-xs text-ink-soft">justo, sin vuelto</span>
        </button>
        <button
          type="button"
          onClick={() => todoEn("debito")}
          className="min-h-touch rounded-[var(--fh-radio)] border border-line bg-surface p-3 text-left hover:bg-bg"
        >
          <span className="block text-sm font-medium text-ink-soft">Todo con débito o crédito</span>
          <span className="fh-num block text-2xl font-black">{formatCLP(montoTarjeta)}</span>
          <span className="block text-xs text-ink-soft">
            {total.roundingAmount !== 0 ? "al peso exacto, sin redondeo" : "al peso exacto"}
          </span>
        </button>
      </div>

      {!mostrarCampos ? (
        <button
          type="button"
          onClick={() => {
            setMostrarCampos(true);
            setTimeout(() => campo.current?.focus(), 0);
          }}
          className="mt-2 text-sm text-ink-soft underline underline-offset-4"
        >
          Pago mixto, o efectivo con vuelto
        </button>
      ) : null}

      {mostrarCampos ? (
        <div className="mt-4 grid grid-cols-2 gap-4">
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
            {/*
              El Nº de comprobante NO es el folio: el folio es el número del
              documento tributario y este es el voucher que imprime la máquina
              de la tarjeta. Se usa para cuadrar contra la liquidación del
              banco. Como la mayoría no lo anota, va plegado.
            */}
            {nDebito > 0 ? (
              pideReferencia ? (
                <input
                  value={referencia}
                  onChange={(e) => setReferencia(e.target.value)}
                  autoFocus
                  placeholder="Nº de comprobante de la tarjeta"
                  className="mt-1 min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-3 text-sm"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setPideReferencia(true)}
                  className="mt-1 text-xs text-ink-soft underline underline-offset-4"
                >
                  + Nº de comprobante de la tarjeta
                </button>
              )
            ) : null}
          </label>
        </div>
      ) : null}

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

      {/* --- 6.1: el cliente para el WhatsApp --- */}
      <div className="mt-4 border-t border-line pt-3">
        {!pideCliente ? (
          <button
            type="button"
            onClick={() => {
              setPideCliente(true);
              // El foco va al teléfono, no al nombre: el nombre es opcional y
              // el teléfono es el dato sin el cual esto no sirve de nada.
              setTimeout(() => campoTelefono.current?.focus(), 0);
            }}
            className="min-h-touch text-sm text-ink-soft underline decoration-dotted underline-offset-4 hover:text-ink"
          >
            + Agregar cliente para enviarle un WhatsApp
          </button>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-soft">Nombre (opcional)</span>
                <input
                  value={nombreCliente}
                  onChange={(e) => setNombreCliente(e.target.value)}
                  placeholder="Como lo saluda"
                  className="min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-3 text-sm"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-ink-soft">Teléfono</span>
                <input
                  ref={campoTelefono}
                  value={telefonoCliente}
                  onChange={(e) => setTelefonoCliente(e.target.value)}
                  inputMode="tel"
                  placeholder="9 1234 5678"
                  className="fh-num min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-3 text-sm"
                />
              </label>
            </div>

            {/*
              Se muestra el número YA NORMALIZADO mientras se escribe. No es
              adorno: es lo que se va a guardar, y verlo es la única forma de
              cachar un dígito de más antes de cobrar.
            */}
            {tel ? (
              <p className={`text-xs ${tel.ok ? "text-ink-soft" : "text-warn"}`}>
                {tel.ok ? `Se guarda como ${tel.legible}` : tel.error}
              </p>
            ) : null}

            <label className="flex min-h-touch cursor-pointer items-start gap-2 text-sm">
              {/*
                Arranca DESMARCADA y no se recuerda de la venta anterior: un
                checkbox que viene marcado no es consentimiento, es una casilla
                que alguien no desmarcó (WA-01).
              */}
              <input
                type="checkbox"
                checked={consiente}
                onChange={(e) => setConsiente(e.target.checked)}
                className="mt-1 h-4 w-4 accent-ink"
              />
              <span>
                El cliente acepta recibir un WhatsApp de esta compra.
                {tel?.ok && !consiente ? (
                  <span className="block text-xs text-warn">Sin marcar esto, el mensaje no se envía.</span>
                ) : null}
              </span>
            </label>
          </div>
        )}
      </div>

      {previa.problema ? <p className="mt-4 text-sm text-warn">{previa.problema}</p> : null}
      {error ? (
        <div className="mt-4 rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      ) : null}

      <div className="mt-5 flex gap-3">
        <Boton ref={botonCobrar} variante="principal" disabled={enviando || !previa.venta} onClick={cobrar} tecla="F2">
          Cobrar e imprimir
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
  titulo,
}: {
  children: React.ReactNode;
  onCerrar: () => void;
  ancho?: string;
  /** Opcional: los dos diálogos viejos pintan su propia cabecera, con el total al lado. */
  titulo?: string;
}) {
  useEffect(() => {
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
    };
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [onCerrar]);

  return (
    /*
      El fondo se desplaza y la caja tiene tope de alto con scroll propio.
      NO es precaución teórica: a 1366×768 —el presupuesto que fija el brief—
      el diálogo de cobro con el bloque de cliente abierto y un error del
      servidor de tres líneas mide 798 px. Sin esto, esas tres líneas quedaban
      fuera de la pantalla **sin forma de llegar a ellas**, y el error que el
      vendedor necesita leer para corregir es justo el que no puede ver.

      `Modal` (components/ui.tsx) ya tenía esta protección; este diálogo está
      escrito a mano desde el Sprint 3 y no la heredó.
    */
    <div
      className="fixed inset-0 z-10 grid place-items-center overflow-y-auto bg-ink/40 p-6"
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`my-auto max-h-[calc(100vh-3rem)] w-full ${ancho} overflow-y-auto rounded-[var(--fh-radio)] border border-line bg-surface p-6`}
      >
        {titulo ? <h2 className="mb-4 text-lg font-bold">{titulo}</h2> : null}
        {children}
      </div>
    </div>
  );
}

/**
 * El descuento sobre el total (tarea 3.6, tecla F4).
 *
 * **Se digita en pesos, no en porcentaje**, porque así se negocia en el mesón:
 * "te lo dejo en 20 lucas", no "te hago un 7,3%". El porcentaje se muestra al
 * lado porque es lo que decide si hace falta autorización.
 *
 * El tope lo impone el servidor con la MISMA función que se usa acá
 * (`requiereAutorizacion`): la pantalla pide el PIN cuando corresponde en vez
 * de dejar que el cobro reviente con el cliente al frente y la plata en la
 * mano. Si las dos discreparan, gana el servidor y el vendedor se lleva un
 * error a destiempo — por eso es la misma función y no dos cuentas parecidas.
 */
function Descuento({
  subtotal,
  actual,
  topePorciento,
  onCerrar,
  onAplicar,
}: {
  subtotal: number;
  actual: number;
  topePorciento: number;
  onCerrar: () => void;
  onAplicar: (monto: number, pin: string | null) => void;
}) {
  const [monto, setMonto] = useState(actual > 0 ? String(actual) : "");
  const [pin, setPin] = useState("");
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => campo.current?.focus(), []);

  const n = Math.max(0, Math.round(Number(monto.replace(/\D/g, "")) || 0));
  const excede = n > subtotal;
  const pide = requiereAutorizacion({ subtotalGross: subtotal, descuentoTotal: n, topeVendedorPorciento: topePorciento });
  const porciento = subtotal > 0 ? (n / subtotal) * 100 : 0;

  return (
    <Dialogo titulo="Descuento" onCerrar={onCerrar}>
      <div className="grid gap-4">
        <div className="flex items-end gap-4">
          <div className="w-44">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink-soft">Descuento en pesos</span>
              <input
                ref={campo}
                value={monto}
                inputMode="numeric"
                onChange={(e) => setMonto(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !excede && (!pide || pin.length >= 4)) {
                    e.preventDefault();
                    onAplicar(n, pide ? pin : null);
                  }
                }}
                className="fh-num min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-3 text-lg"
              />
            </label>
          </div>
          <div className="pb-2 text-sm text-ink-soft">
            sobre {formatCLP(subtotal)} ={" "}
            <span className="fh-num font-semibold text-ink">{porciento.toFixed(1).replace(".", ",")}%</span>
          </div>
        </div>

        {excede ? (
          <p className="text-sm text-error">El descuento no puede ser mayor que el subtotal.</p>
        ) : pide ? (
          <>
            <p className="text-sm text-warn">
              Pasa del {topePorciento}% que puedes autorizar. Pide el PIN de un administrador: queda registrado quién lo
              autorizó.
            </p>
            <div className="w-52">
              <Campo
                etiqueta="PIN del administrador"
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                className="fh-num"
              />
            </div>
          </>
        ) : null}

        <div className="flex justify-end gap-3">
          {actual > 0 ? (
            <Boton variante="fantasma" onClick={() => onAplicar(0, null)}>
              Quitar el descuento
            </Boton>
          ) : null}
          <Boton variante="secundaria" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton
            variante="principal"
            disabled={excede || (pide && pin.length < 4)}
            onClick={() => onAplicar(n, pide ? pin : null)}
           tecla="Enter">
            Aplicar
          </Boton>
        </div>
      </div>
    </Dialogo>
  );
}

/**
 * Dejar la venta en espera (ADR-001, tecla F6).
 *
 * El caso real: el cliente se acordó de que le faltaba algo y se fue a buscarlo
 * con el mesón lleno atrás. Se guarda con un nombre que sirva para gritarlo
 * —«el de la camioneta azul»— y la caja queda libre.
 *
 * **La espera no reserva stock ni toca la caja.** Es una tabla aparte, sin
 * ninguna relación con las dos: el aislamiento es estructural, no de
 * disciplina. Por eso guardar no descuenta nada y recuperar no garantiza que
 * todavía haya.
 */
function GuardarEspera({
  lineas,
  espera,
  onCerrar,
  onGuardada,
}: {
  lineas: Linea[];
  espera: { id: number; label: string } | null;
  onCerrar: () => void;
  onGuardada: (mensaje: string) => void;
}) {
  const [label, setLabel] = useState(espera?.label ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => campo.current?.focus(), []);

  async function guardar() {
    setEnviando(true);
    setError(null);
    const items = lineas.map((l) => ({ productId: l.producto.id, qtyMilli: l.qtyMilli }));
    try {
      /*
        Si estas líneas vinieron de una espera, se ACTUALIZA esa misma en vez de
        crear otra. Crear una nueva dejaría dos «Don Luis» en la lista, una con
        lo de antes y otra con lo de ahora, y nadie sabría cuál cobrar.
      */
      const r = espera
        ? await api<{ ok: true }>(`/suspended/${espera.id}`, {
            method: "PATCH",
            body: JSON.stringify({ label: label.trim(), note: note.trim() || null, items }),
          })
        : await api<{ mensaje: string; aviso: string | null }>("/suspended", {
            method: "POST",
            body: JSON.stringify({ label: label.trim(), note: note.trim() || null, items }),
          });
      const mensaje = "mensaje" in r ? r.mensaje : `Actualizada «${label.trim()}».`;
      const aviso = "aviso" in r && r.aviso ? ` ${r.aviso}` : "";
      onGuardada(mensaje + aviso);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar");
      setEnviando(false);
    }
  }

  return (
    <Dialogo titulo={espera ? `Actualizar «${espera.label}»` : "Dejar en espera"} onCerrar={onCerrar}>
      <div className="grid gap-4">
        <Campo
          ref={campo}
          etiqueta="Con qué nombre"
          hint="El que sirva para encontrarla después: «el de la camioneta azul», «Don Luis»."
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={60}
          onKeyDown={(e) => {
            if (e.key === "Enter" && label.trim().length >= 2) {
              e.preventDefault();
              void guardar();
            }
          }}
        />
        <Campo
          etiqueta="Nota (opcional)"
          hint="«Fue a buscar la medida», «vuelve después de almuerzo»."
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
        />
        <p className="text-sm text-ink-soft">
          {lineas.length} {lineas.length === 1 ? "línea" : "líneas"}. La espera <strong>no reserva stock</strong>: si
          alguien se lleva lo último, al recuperarla no va a estar.
        </p>
        {error ? <p className="text-sm text-error">{error}</p> : null}
        <div className="flex justify-end gap-3">
          <Boton variante="secundaria" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton variante="principal" disabled={enviando || label.trim().length < 2} onClick={() => void guardar()} tecla="Enter">
            {enviando ? "Guardando…" : "Guardar"}
          </Boton>
        </div>
      </div>
    </Dialogo>
  );
}

type EsperaFila = {
  id: number;
  label: string;
  note: string | null;
  lineas: number;
  touchedAt: string;
  user: { name: string };
};

type LineaRecuperada = {
  productId: number;
  nombre: string;
  sku: string;
  qtyMilli: number;
  unidadActual: string;
  saleUnit: Producto["saleUnit"];
  allowsFraction: boolean;
  precioAhora: number;
  precioAlSuspender: number;
  disponible: boolean;
  aviso: string | null;
};

/**
 * Recuperar una venta en espera (tecla F8).
 *
 * Al recuperar, **el precio que se cobra es el de hoy**, no el del momento en
 * que se guardó: la espera no es una cotización. Pero el precio viejo viaja
 * igual y se muestra, porque el cliente se acuerda del que le dijeron y el
 * vendedor tiene que enterarse antes de cobrar, no cuando le reclamen.
 */
function Esperas({
  hayLineas,
  onCerrar,
  onRecuperada,
}: {
  hayLineas: boolean;
  onCerrar: () => void;
  onRecuperada: (id: number, label: string, lineas: Linea[], aviso: string | null) => void;
}) {
  const [filas, setFilas] = useState<EsperaFila[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<number | null>(null);

  const cargar = useCallback(async () => {
    try {
      setFilas((await api<{ esperas: EsperaFila[] }>("/suspended")).esperas);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudieron leer las esperas");
      setFilas([]);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function recuperar(f: EsperaFila) {
    setOcupado(f.id);
    setError(null);
    try {
      const r = await api<{ lineas: LineaRecuperada[]; hayCambios: boolean }>(`/suspended/${f.id}`);
      const faltan = r.lineas.filter((l) => !l.disponible);
      const avisos = r.lineas.filter((l) => l.aviso).map((l) => `${l.nombre}: ${l.aviso}`);
      const lineas: Linea[] = r.lineas
        .filter((l) => l.disponible)
        .map((l) => ({
          /*
            El producto se arma con la MISMA forma que devuelve la búsqueda,
            `saleUnit` incluida. Antes se armaba a mano con un cast y sin
            `saleUnit`: la tabla se caía al pintar la primera línea y la
            pantalla de venta entera desaparecía —pantalla en blanco, sin
            forma de volver, con la venta a medio armar—.
          */
          producto: {
            id: l.productId,
            sku: l.sku,
            name: l.nombre,
            priceGross: l.precioAhora,
            saleUnit: l.saleUnit,
          },
          qtyMilli: l.qtyMilli,
          discountAmount: 0,
          fraccionable: l.allowsFraction,
        }));
      const aviso =
        [
          faltan.length ? `${faltan.length} ${faltan.length === 1 ? "producto ya no está" : "productos ya no están"} y no se recuperaron.` : "",
          ...avisos,
        ]
          .filter(Boolean)
          .join(" ") || null;
      onRecuperada(f.id, f.label, lineas, aviso);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo recuperar");
      setOcupado(null);
      void cargar();
    }
  }

  async function descartar(f: EsperaFila) {
    setOcupado(f.id);
    try {
      await api(`/suspended/${f.id}`, { method: "DELETE" });
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo descartar");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <Dialogo titulo="Ventas en espera" ancho="max-w-2xl" onCerrar={onCerrar}>
      <div className="grid gap-3">
        {/*
          El aviso va ARRIBA y no al recuperar: recuperar reemplaza lo que hay
          en pantalla, y descubrirlo después de perder ocho líneas tecleadas es
          descubrirlo tarde.
        */}
        {hayLineas ? (
          <p className="rounded-[var(--fh-radio)] border border-warn/40 bg-warn/10 p-3 text-sm">
            Hay una venta empezada en pantalla. Recuperar una espera la reemplaza: si no querías perderla, déjala en
            espera primero con F6.
          </p>
        ) : null}

        {filas === null ? (
          <p className="text-ink-soft">Cargando…</p>
        ) : filas.length === 0 ? (
          <p className="text-ink-soft">No hay ninguna venta en espera.</p>
        ) : (
          <ul className="divide-y divide-line rounded-[var(--fh-radio)] border border-line">
            {filas.map((f) => (
              <li key={f.id} className="flex items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{f.label}</div>
                  <div className="truncate text-sm text-ink-soft">
                    {f.lineas} {f.lineas === 1 ? "línea" : "líneas"} · {f.user.name} · {formatHora(f.touchedAt)}
                    {f.note ? ` · ${f.note}` : ""}
                  </div>
                </div>
                <Boton variante="principal" disabled={ocupado === f.id} onClick={() => void recuperar(f)}>
                  Recuperar
                </Boton>
                <Boton variante="fantasma" disabled={ocupado === f.id} onClick={() => void descartar(f)}>
                  Descartar
                </Boton>
              </li>
            ))}
          </ul>
        )}
        {error ? <p className="text-sm text-error">{error}</p> : null}
        <div className="flex justify-end">
          <Boton variante="secundaria" onClick={onCerrar}>
            Cerrar
          </Boton>
        </div>
      </div>
    </Dialogo>
  );
}
