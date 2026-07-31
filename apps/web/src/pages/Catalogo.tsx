/**
 * Pantalla de búsqueda / catálogo (tarea 1.7b, UI-BRIEF §5.3).
 * Wireframe aprobado por Cristian el 2026-07-30.
 *
 * Es una de las cinco pantallas que definen el producto. Lo que la gobierna:
 *
 * - **Una sola caja de búsqueda**, sin selector de modo. Escaneo, nombre
 *   parcial y SKU entran por el mismo campo: un "buscar por…" es un clic más
 *   en cada venta y una forma de equivocarse.
 * - **El foco vuelve solo a la caja** después de cerrar cualquier cosa. El
 *   lector de códigos ES un teclado: si el foco está en otra parte, lo que se
 *   escanea se pierde y el vendedor no entiende por qué.
 * - **Si el escaneo calza exacto, no se muestra una lista para elegir**: se
 *   abre el producto. El servidor ya lo dice con `exacto: true`.
 * - **El vendedor no ve las columnas de costo ni margen.** No están en gris:
 *   no existen — ni en el DOM ni en el JSON, que el servidor ya filtra.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, getToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAtajos } from "@/lib/atajos";
import { Boton, Chip } from "@/components/ui";
import { ProductoForm } from "./ProductoForm";
import { ImportarProductos } from "./ImportarProductos";
import {
  formatCLP,
  formatCostoMilli,
  formatQty,
  atajosVisibles,
  costoMilliPorUnidadDeVenta,
  margenDeListaPct,
} from "@ferrehouse/shared";

type Unidad = { id: number; name: string; symbol: string; factorMilli: number };
type Nivel = { locationId: number; qtyBaseMilli: number; location: { id: number; name: string } };

export type Producto = {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  priceGross: number;
  /** Solo llega si el token es de admin. Al vendedor el servidor lo omite. */
  costNetMilliPeso?: number;
  reorderLevelBaseMilli: number;
  active: boolean;
  category: { id: number; name: string } | null;
  brand: { id: number; name: string } | null;
  saleUnit: Unidad;
  purchaseUnit: Unidad;
  barcodes: { id: number; code: string; note: string | null }[];
  stockLevels: Nivel[];
};

/** Saldo total en milésimas de unidad BASE, sumando ubicaciones. */
function saldoBaseMilli(p: Producto): number {
  return p.stockLevels.reduce((t, n) => t + n.qtyBaseMilli, 0);
}

/** El saldo se muestra en la unidad de VENTA: el vendedor piensa en metros. */
function saldoEnUnidadDeVenta(p: Producto): number {
  return Math.round((saldoBaseMilli(p) * 1000) / p.saleUnit.factorMilli);
}

/**
 * Estado del stock con COLOR Y PALABRA (brief §2.4). Solo con color, un
 * vendedor daltónico no distingue "quedan 3" de "no queda ninguno".
 */
function estadoStock(p: Producto): { tono: "ok" | "warn" | "error"; palabra: string } | null {
  const saldo = saldoBaseMilli(p);
  if (saldo <= 0) return { tono: "error", palabra: "sin stock" };
  if (p.reorderLevelBaseMilli > 0 && saldo <= p.reorderLevelBaseMilli) {
    return {
      tono: "warn",
      palabra: `bajo mínimo (${formatQty(Math.round((p.reorderLevelBaseMilli * 1000) / p.saleUnit.factorMilli))})`,
    };
  }
  return null;
}

/**
 * El costo y el margen se muestran POR UNIDAD DE VENTA, que es la misma base
 * sobre la que se lee el precio de al lado.
 *
 * La conversión vive en `shared` y no acá a propósito: en la primera versión
 * de esta pantalla la columna COSTO mostraba pesos por unidad BASE junto a un
 * precio por unidad de VENTA, y el cemento —$180 el kilo, $6.490 el saco de
 * 25— aparecía con 96,7% de margen. El real es 17,5%. Los dos números se ven
 * perfectamente sanos hasta que se convierten.
 */
function textoCosto(p: Producto): string {
  if (p.costNetMilliPeso === undefined) return "—";
  // Con decimales: el costo por unidad es una RAZÓN, no un monto (decisión
  // sellada 2). "$486" donde dice $485,59 es el mismo error que el kardex tuvo.
  return formatCostoMilli(costoMilliPorUnidadDeVenta({ costNetMilliPeso: p.costNetMilliPeso, saleUnit: p.saleUnit }));
}

function textoMargen(p: Producto): string {
  const m = margenDeListaPct(p);
  if (m === null) return "—";
  return `${m.toFixed(1)}%`.replace(".", ",");
}

export function Catalogo() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.role === "ADMIN";

  const [texto, setTexto] = useState("");
  const [productos, setProductos] = useState<Producto[]>([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState(0);
  const [abierto, setAbierto] = useState<Producto | null>(null);
  /** `undefined` = cerrado, `null` = alta, número = editar ese producto. */
  const [formulario, setFormulario] = useState<number | null | undefined>(undefined);
  const [importando, setImportando] = useState(false);
  /** Sube cada vez que algo cambia el catálogo: obliga a la lista a releer. */
  const [version, setVersion] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);

  const caja = useRef<HTMLInputElement>(null);
  const filas = useRef<(HTMLTableRowElement | null)[]>([]);

  /** El foco vuelve acá SIEMPRE. Es lo que hace que el lector sirva. */
  const volverAlFoco = useCallback(() => {
    caja.current?.focus();
    caja.current?.select();
  }, []);

  useEffect(() => {
    volverAlFoco();
  }, [volverAlFoco]);

  // La búsqueda espera 180 ms desde la última tecla. El lector escribe muy
  // rápido y termina con Enter: sin la espera, cada código dispararía una
  // consulta por carácter.
  useEffect(() => {
    let vigente = true;
    const t = setTimeout(async () => {
      setCargando(true);
      setError(null);
      try {
        if (texto.trim().length === 0) {
          const r = await api<{ productos: Producto[]; total: number }>("/products?limit=50");
          if (!vigente) return;
          setProductos(r.productos);
          setTotal(r.total);
        } else {
          const r = await api<{ exacto: boolean; productos: Producto[] }>(
            `/products/search?q=${encodeURIComponent(texto.trim())}`,
          );
          if (!vigente) return;
          setProductos(r.productos);
          setTotal(r.productos.length);
          // Escaneo con calce exacto: se abre el producto, no una lista.
          if (r.exacto && r.productos[0]) setAbierto(r.productos[0]);
        }
        setSeleccion(0);
      } catch (e) {
        if (vigente) setError(e instanceof ApiError ? e.message : "No se pudo buscar");
      } finally {
        if (vigente) setCargando(false);
      }
    }, 180);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [texto, version]);

  /**
   * Al vendedor no se le imprime ningún atajo de admin. Todos los del catálogo
   * —incluido imprimir etiqueta— son operaciones que el servidor exige con
   * token de administrador; mostrárselos sería prometer una tecla que le va a
   * responder "no autorizado". Le quedan ↑↓ y Enter, que es lo que necesita
   * para consultar un precio.
   */
  const atajos = useMemo(() => (esAdmin ? atajosVisibles("catalogo") : []), [esAdmin]);

  /**
   * Enter y Escape se quedan en el contenedor a propósito: significan cosas
   * distintas según dónde esté el foco —Enter abre el producto marcado, Escape
   * limpia la búsqueda— y son las dos únicas teclas que dependen del contexto.
   * Todo lo demás vive en `window`, ver abajo.
   */
  function alTeclear(e: React.KeyboardEvent) {
    if (e.key === "Enter" && productos[seleccion]) {
      e.preventDefault();
      setAbierto(productos[seleccion]!);
    } else if (e.key === "Escape") {
      setTexto("");
    }
  }

  /**
   * Antes esto estaba partido en dos: F2 y F4 colgaban de `window` y F8 solo
   * del `onKeyDown` del div. Resultado medido: F8 «Editar» no hacía nada
   * apenas el foco se iba del buscador, mientras la leyenda la seguía
   * anunciando. Una sola tabla, un solo oyente.
   */
  const moverSeleccion = useCallback(
    (paso: number) =>
      setSeleccion((s) => {
        const siguiente = Math.max(0, Math.min(s + paso, productos.length - 1));
        filas.current[siguiente]?.scrollIntoView({ block: "nearest" });
        return siguiente;
      }),
    [productos.length],
  );

  useAtajos(
    {
      ArrowDown: () => moverSeleccion(1),
      ArrowUp: () => moverSeleccion(-1),
      F2: esAdmin ? () => setFormulario(null) : undefined,
      F4: esAdmin ? () => setImportando(true) : undefined,
      F8: esAdmin && productos[seleccion] ? () => setFormulario(productos[seleccion]!.id) : undefined,
    },
    // Con un diálogo abierto las teclas son suyas: el detalle del producto
    // tiene su propio F6/F8, y el formulario no quiere ninguno.
    formulario === undefined && !importando && !abierto,
  );

  function cerrarFormulario() {
    setFormulario(undefined);
    volverAlFoco();
  }

  return (
    <div className="flex flex-col gap-4" onKeyDown={alTeclear}>
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <label className="sr-only" htmlFor="buscador">
            Buscar productos
          </label>
          <input
            id="buscador"
            ref={caja}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Escanea, o escribe nombre o código"
            autoComplete="off"
            className="min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-4 text-lg text-ink placeholder:text-ink-soft/60"
          />
          <p className="mt-1 text-xs text-ink-soft">
            Escaneo, nombre parcial o SKU: todo entra por la misma caja.
          </p>
        </div>
        {esAdmin ? (
          <Boton variante="principal" className="shrink-0" onClick={() => setFormulario(null)} tecla="F2">
            + Producto nuevo
          </Boton>
        ) : null}
      </div>

      <div className="text-sm text-ink-soft">
        {cargando ? "Buscando…" : `${total} producto${total === 1 ? "" : "s"}`}
      </div>

      {error ? (
        <div className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>
      ) : null}

      {aviso ? (
        <div className="flex items-center justify-between rounded-[var(--fh-radio)] border border-ok/30 bg-ok/10 p-3 text-sm text-ok">
          {aviso}
          <button onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="px-2">
            ×
          </button>
        </div>
      ) : null}

      {!cargando && productos.length === 0 ? (
        <Vacio
          hayTexto={texto.trim().length > 0}
          texto={texto.trim()}
          esAdmin={esAdmin}
          onCrear={() => setFormulario(null)}
          onImportar={() => setImportando(true)}
        />
      ) : (
        <Tabla
          productos={productos}
          esAdmin={esAdmin}
          seleccion={seleccion}
          onSeleccionar={setSeleccion}
          onAbrir={setAbierto}
          filasRef={filas}
        />
      )}

      {/* Los atajos se imprimen en pantalla, no se esconden en una ayuda
          (brief §2.1). F2 no se repite acá: ya está en su botón. */}
      <div className="flex gap-5 text-sm text-ink-soft">
        <span>
          <span className="fh-num font-semibold text-ink">↑↓</span> moverse
        </span>
        <span>
          <span className="fh-num font-semibold text-ink">Enter</span> abrir
        </span>
        {atajos
          .filter((a) => a.tecla !== "F2")
          .map((a) => (
            <span key={`${a.tecla}-${a.accion}`}>
              <span className="fh-num font-semibold text-ink">{a.etiqueta}</span> {a.accion.toLowerCase()}
            </span>
          ))}
      </div>

      {abierto ? (
        <Detalle
          producto={abierto}
          esAdmin={esAdmin}
          onEditar={() => {
            setAbierto(null);
            setFormulario(abierto.id);
          }}
          onCerrar={() => {
            setAbierto(null);
            volverAlFoco();
          }}
        />
      ) : null}

      {formulario !== undefined ? (
        <ProductoForm
          productoId={formulario}
          onCerrar={cerrarFormulario}
          onGuardado={(p) => {
            cerrarFormulario();
            setVersion((v) => v + 1);
            setAviso(`${p.name} guardado como ${p.sku}.`);
          }}
        />
      ) : null}

      {importando ? (
        <ImportarProductos
          onCerrar={() => {
            setImportando(false);
            volverAlFoco();
          }}
          onImportado={() => setVersion((v) => v + 1)}
        />
      ) : null}
    </div>
  );
}

function Tabla({
  productos,
  esAdmin,
  seleccion,
  onSeleccionar,
  onAbrir,
  filasRef,
}: {
  productos: Producto[];
  esAdmin: boolean;
  seleccion: number;
  onSeleccionar: (i: number) => void;
  onAbrir: (p: Producto) => void;
  filasRef: React.MutableRefObject<(HTMLTableRowElement | null)[]>;
}) {
  return (
    <div className="overflow-x-auto rounded-[var(--fh-radio)] border border-line bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
            <th className="px-3 py-2 text-left font-semibold">SKU</th>
            <th className="px-3 py-2 text-left font-semibold">Nombre</th>
            <th className="px-3 py-2 text-left font-semibold">Unidad</th>
            <th className="px-3 py-2 text-right font-semibold">Stock</th>
            {/* Las columnas de plata del admin NO se renderizan para el
                vendedor. No es `display:none`: no existen (brief §2.8). */}
            {esAdmin ? <th className="px-3 py-2 text-right font-semibold">Costo</th> : null}
            <th className="px-3 py-2 text-right font-semibold">Precio</th>
            {esAdmin ? <th className="px-3 py-2 text-right font-semibold">Margen</th> : null}
          </tr>
        </thead>
        <tbody>
          {productos.map((p, i) => {
            const estado = estadoStock(p);
            return (
              <tr
                key={p.id}
                ref={(el) => (filasRef.current[i] = el)}
                onClick={() => onSeleccionar(i)}
                onDoubleClick={() => onAbrir(p)}
                aria-selected={i === seleccion}
                className={
                  "cursor-default border-b border-line/60 last:border-0 " +
                  (i === seleccion ? "bg-bg" : "hover:bg-bg/60")
                }
              >
                <td className="fh-num px-3 py-2 text-mono-ink">{p.sku}</td>
                <td className="px-3 py-2">
                  <span className={p.active ? "" : "text-ink-soft"}>{p.name}</span>
                  {!p.active ? <span className="ml-2 text-xs text-ink-soft">(inactivo)</span> : null}
                  {estado ? (
                    <span className="ml-2 align-middle">
                      <Chip tono={estado.tono}>{estado.palabra}</Chip>
                    </span>
                  ) : null}
                </td>
                <td className="fh-num px-3 py-2 text-ink-soft">{p.saleUnit.symbol}</td>
                <td className="fh-num px-3 py-2 text-right">{formatQty(saldoEnUnidadDeVenta(p))}</td>
                {esAdmin ? (
                  <td className="fh-num px-3 py-2 text-right text-ink-soft">
                    {textoCosto(p)}
                  </td>
                ) : null}
                <td className="fh-num px-3 py-2 text-right font-semibold">{formatCLP(p.priceGross)}</td>
                {esAdmin ? <td className="fh-num px-3 py-2 text-right text-ink-soft">{textoMargen(p)}</td> : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Vacíos que invitan (brief §2.9): dicen qué hacer, no lamentan. */
function Vacio({
  hayTexto,
  texto,
  esAdmin,
  onCrear,
  onImportar,
}: {
  hayTexto: boolean;
  texto: string;
  esAdmin: boolean;
  onCrear: () => void;
  onImportar: () => void;
}) {
  if (hayTexto) {
    return (
      <div className="rounded-[var(--fh-radio)] border border-line bg-surface p-8 text-center">
        <p className="text-ink">
          Nada calza con <span className="font-semibold">«{texto}»</span>.
        </p>
        <p className="mt-1 text-sm text-ink-soft">
          Prueba con menos letras{esAdmin ? ", o créalo con F2" : ""}.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-[var(--fh-radio)] border border-line bg-surface p-8 text-center">
      <p className="text-ink">Todavía no hay productos.</p>
      {esAdmin ? (
        <>
          <div className="mt-4 flex justify-center gap-3">
            <Boton variante="principal" onClick={onImportar} tecla="F4">
              Importar desde Excel
            </Boton>
            <Boton onClick={onCrear} tecla="F2">
              Crear el primero
            </Boton>
          </div>
          <p className="mt-3 text-sm text-ink-soft">
            El importador te deja bajar la plantilla con las unidades de la tienda ya escritas.
          </p>
        </>
      ) : (
        <p className="mt-1 text-sm text-ink-soft">Pídele a Cristian que cargue el catálogo.</p>
      )}
    </div>
  );
}

function Detalle({
  producto,
  esAdmin,
  onEditar,
  onCerrar,
}: {
  producto: Producto;
  esAdmin: boolean;
  onEditar: () => void;
  onCerrar: () => void;
}) {
  const cerrar = useRef<HTMLButtonElement>(null);
  const [etiqueta, setEtiqueta] = useState<string | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);

  /**
   * La vista previa de la etiqueta, que existía en el servidor desde el Sprint
   * 1 y ninguna pantalla usaba.
   *
   * **Por qué nadie la había conectado**: la ruta pide token, y un `<img src>`
   * no manda la cabecera `authorization`. Se baja con `fetch` y se convierte en
   * una URL de blob, que el `<img>` sí puede mostrar.
   *
   * Y por qué vale la pena: la etiqueta térmica se imprime a ciegas. Una tira
   * de veinte con el nombre cortado o el código equivocado se descubre en la
   * repisa, con las etiquetas ya gastadas. El SVG dibuja el MISMO Code128 que
   * va a la térmica.
   */
  useEffect(() => {
    let url: string | null = null;
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(`/api/products/${producto.id}/label.svg`, {
          headers: { authorization: `Bearer ${getToken() ?? ""}` },
        });
        if (!r.ok) return;
        url = URL.createObjectURL(await r.blob());
        if (vivo) setPrevia(url);
      } catch {
        // Sin vista previa se sigue pudiendo imprimir: no es un bloqueo.
      }
    })();
    return () => {
      vivo = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [producto.id]);

  useEffect(() => {
    cerrar.current?.focus();
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCerrar();
      else if (esAdmin && e.key === "F8") {
        e.preventDefault();
        onEditar();
      } else if (esAdmin && e.key === "F6") {
        e.preventDefault();
        void imprimir();
      }
    };
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [onCerrar, onEditar, esAdmin]);

  /**
   * La etiqueta se manda a la cola de impresión del servidor (`PrintJob`), que
   * es lo que sabe a qué impresora va según la estación. La pantalla solo
   * confirma que quedó encolada: si dijera "impreso" estaría afirmando algo
   * que no vio, y el papel puede no salir.
   */
  async function imprimir() {
    setEtiqueta(null);
    try {
      await api(`/products/${producto.id}/label`, { method: "POST", body: JSON.stringify({ copias: 1 }) });
      setEtiqueta("Etiqueta enviada a la impresora del mesón.");
    } catch (e) {
      setEtiqueta(e instanceof ApiError ? e.message : "No se pudo encolar la etiqueta");
    }
  }

  const estado = estadoStock(producto);

  return (
    <div className="fixed inset-0 z-10 grid place-items-center bg-ink/40 p-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-2xl rounded-[var(--fh-radio)] border border-line bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="fh-num text-sm text-mono-ink">{producto.sku}</div>
            <h2 className="text-xl font-bold">{producto.name}</h2>
          </div>
          <Boton ref={cerrar} variante="fantasma" onClick={onCerrar}>
            Esc volver a buscar
          </Boton>
        </div>

        {/* El precio grande: es el dato que se consulta desde el mesón. */}
        <div className="mt-4 flex items-baseline gap-3">
          <span className="fh-num text-5xl font-black tracking-tight">{formatCLP(producto.priceGross)}</span>
          <span className="text-ink-soft">por {producto.saleUnit.symbol}, IVA incluido</span>
        </div>

        <dl className="mt-5 grid gap-3 text-sm">
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-ink-soft">Stock</dt>
            <dd className="fh-num flex items-center gap-2">
              {formatQty(saldoEnUnidadDeVenta(producto))} {producto.saleUnit.symbol}
              {producto.stockLevels[0] ? (
                <span className="text-ink-soft">en {producto.stockLevels[0].location.name}</span>
              ) : null}
              {estado ? <Chip tono={estado.tono}>{estado.palabra}</Chip> : null}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="w-28 shrink-0 text-ink-soft">Unidades</dt>
            <dd>
              {producto.saleUnit.id === producto.purchaseUnit.id
                ? `Se compra y se vende en ${producto.saleUnit.name}.`
                : `Se compra en ${producto.purchaseUnit.name}, se vende en ${producto.saleUnit.name}.`}
            </dd>
          </div>
          {producto.barcodes.length > 0 ? (
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-ink-soft">Códigos</dt>
              <dd className="fh-num text-mono-ink">{producto.barcodes.map((b) => b.code).join(" · ")}</dd>
            </div>
          ) : null}
          {producto.category || producto.brand ? (
            <div className="flex gap-3">
              <dt className="w-28 shrink-0 text-ink-soft">Clasificación</dt>
              <dd>{[producto.category?.name, producto.brand?.name].filter(Boolean).join(" · ")}</dd>
            </div>
          ) : null}
        </dl>

        {esAdmin ? (
          <div className="mt-6 border-t border-line pt-4">
            {previa ? (
              <div className="mb-3">
                <div className="mb-1 text-xs uppercase tracking-wide text-ink-soft">Así va a salir la etiqueta</div>
                <img
                  src={previa}
                  alt={`Etiqueta de ${producto.name}`}
                  className="max-h-24 rounded border border-line bg-white p-1"
                />
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-3">
            <Boton onClick={imprimir} tecla="F6">
              Imprimir etiqueta
            </Boton>
            <Boton variante="principal" onClick={onEditar} tecla="F8">
              Editar
            </Boton>
            {etiqueta ? <span className="text-sm text-ink-soft">{etiqueta}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
