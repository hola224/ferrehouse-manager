/**
 * Alta y edición de producto (tareas 1.2 y 1.3, sin pantalla hasta ahora).
 *
 * LO QUE GOBIERNA ESTE FORMULARIO:
 *
 * - **El costo se pide igual que en el Excel**: en pesos por unidad BASE. Si
 *   acá se pidiera por unidad de venta y allá por unidad base, el mismo
 *   producto cargado por los dos caminos quedaría con costos distintos y nadie
 *   sabría cuál está mal. La etiqueta dice la unidad, siempre.
 *
 * - **El costo solo se digita hasta el primer movimiento** (decisión sellada
 *   18). Después manda el libro, y el campo aparece bloqueado con el motivo
 *   escrito: sin el motivo, el administrador cree que es un error de la
 *   pantalla y va a buscar dónde más cambiarlo.
 *
 * - **Se avisa cuando el costo se ve tecleado en la unidad equivocada.** Es el
 *   mismo aviso que hace el importador: un saco de 25 kg que cuesta $4.900 se
 *   teclea como 4900 creyendo que es por saco, cuando la casilla pide por kilo,
 *   y el producto queda costando $122.500. Ninguna validación de formato lo
 *   atrapa, porque 4900 es un número perfectamente válido.
 *
 * - **El SKU no se pide**: lo pone el servidor, correlativo (`FH-00001`). Un
 *   SKU tecleado es un SKU repetido tarde o temprano, y está impreso en la
 *   etiqueta pegada en la repisa.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useCatalogoCreado } from "@/lib/catalogos";
import { Acciones, Boton, Campo, Modal, Selector } from "@/components/ui";
import {
  formatCLP,
  validarUnidades,
  describirConversion,
  costoPorUnidadDeVenta,
  margenDeListaPct,
  normalizeBarcode,
  type UnitLike,
} from "@ferrehouse/shared";

type Unidad = UnitLike & { isBase: boolean; group: { id: number; name: string; allowsFraction: boolean } };
/** Como las sirve el servidor: agrupadas por magnitud, no en una lista plana. */
type GrupoDeUnidades = { id: number; name: string; allowsFraction: boolean; units: Array<UnitLike & { isBase: boolean }> };

/**
 * Aplana los grupos y le cuelga a cada unidad su grupo. La pantalla necesita
 * la lista plana para el `select` y el grupo para poder decir "longitud" al
 * lado del nombre y para validar que venta y compra sean de la misma magnitud.
 */
function aplanar(grupos: GrupoDeUnidades[]): Unidad[] {
  return grupos.flatMap((g) =>
    g.units.map((u) => ({ ...u, group: { id: g.id, name: g.name, allowsFraction: g.allowsFraction } })),
  );
}
type Nombrado = { id: number; name: string };

export type ProductoEditable = {
  id: number;
  sku: string;
  name: string;
  description: string | null;
  categoryId: number | null;
  brandId: number | null;
  supplierId: number | null;
  saleUnitId: number;
  purchaseUnitId: number;
  priceGross: number;
  costNetMilliPeso?: number;
  reorderLevelBaseMilli: number;
  active: boolean;
  barcodes: Array<{ id: number; code: string }>;
};

type Catalogos = { unidades: Unidad[]; categorias: Nombrado[]; marcas: Nombrado[]; proveedores: Nombrado[] };

const porNombre = (a: Nombrado, b: Nombrado): number => a.name.localeCompare(b.name, "es");

/**
 * Un selector que además deja crear la opción que falta, sin salir del
 * formulario ni perder lo escrito.
 *
 * Se queda con lo recién creado ELEGIDO. Crear algo y tener que volver a
 * buscarlo en la lista es la mitad del trabajo hecho a mano dos veces, y es
 * exactamente el momento en que se elige la opción de al lado por apuro.
 */
function SelectorCreable({
  etiqueta,
  vacio,
  value,
  onChange,
  opciones,
  crear,
}: {
  etiqueta: string;
  vacio: string;
  value: string;
  onChange: (v: string) => void;
  opciones: Nombrado[];
  crear: (name: string) => Promise<Nombrado>;
}) {
  const [creando, setCreando] = useState(false);
  const [nombre, setNombre] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmar(): Promise<void> {
    const limpio = nombre.trim();
    if (!limpio) return;
    setGuardando(true);
    setError(null);
    try {
      const creado = await crear(limpio);
      onChange(String(creado.id));
      setCreando(false);
      setNombre("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo crear");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-ink-soft">{etiqueta}</span>
        <button
          type="button"
          onClick={() => {
            setCreando((v) => !v);
            setError(null);
          }}
          className="text-xs text-ink-soft underline underline-offset-4"
        >
          {creando ? "elegir de la lista" : "+ nueva"}
        </button>
      </div>

      {creando ? (
        <div className="flex gap-2">
          <input
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            /*
              Enter confirma y NO envía el formulario del producto: sin este
              preventDefault, crear una categoría guardaría el producto a
              medio llenar.
            */
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void confirmar();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setCreando(false);
              }
            }}
            autoFocus
            placeholder={`${etiqueta} nueva`}
            className="min-h-touch w-full min-w-0 rounded-[var(--fh-radio)] border border-line bg-surface px-3"
          />
          <Boton type="button" onClick={() => void confirmar()} disabled={guardando || !nombre.trim()}>
            {guardando ? "…" : "Crear"}
          </Boton>
        </div>
      ) : (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-3"
        >
          <option value="">{vacio}</option>
          {opciones.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}

      {error ? <p className="mt-1 text-xs text-error">{error}</p> : null}
    </div>
  );
}

const entero = (t: string): number | null => {
  const limpio = t.replace(/[^\d-]/g, "");
  if (limpio === "" || limpio === "-") return null;
  const n = Number(limpio);
  return Number.isInteger(n) ? n : null;
};

/**
 * Carga el producto antes de armar el formulario. Va aparte porque los valores
 * iniciales de un formulario se fijan al montarlo: pintarlo vacío y rellenarlo
 * después haría que el primer tecleo del administrador se pierda cuando llega
 * la respuesta.
 */
export function ProductoForm({
  productoId,
  onCerrar,
  onGuardado,
}: {
  /** `null` = alta. */
  productoId: number | null;
  onCerrar: () => void;
  onGuardado: (p: { id: number; sku: string; name: string }) => void;
}) {
  const [datos, setDatos] = useState<{ producto: ProductoEditable | null; movimientos: number } | null>(
    productoId === null ? { producto: null, movimientos: 0 } : null,
  );
  const [fallo, setFallo] = useState<string | null>(null);

  useEffect(() => {
    if (productoId === null) return;
    void api<{ producto: ProductoEditable; movimientos: number }>(`/products/${productoId}`)
      .then((r) => setDatos({ producto: r.producto, movimientos: r.movimientos }))
      .catch((e) => setFallo(e instanceof ApiError ? e.message : "No se pudo abrir el producto"));
  }, [productoId]);

  if (!datos) {
    return (
      <Modal titulo="Editar producto" onCerrar={onCerrar}>
        <p className={`mt-4 ${fallo ? "text-error" : "text-ink-soft"}`}>{fallo ?? "Cargando…"}</p>
      </Modal>
    );
  }
  return <Formulario producto={datos.producto} movimientos={datos.movimientos} onCerrar={onCerrar} onGuardado={onGuardado} />;
}

function Formulario({
  producto,
  movimientos,
  onCerrar,
  onGuardado,
}: {
  producto: ProductoEditable | null;
  /** Movimientos que fijan costo: decide si el costo todavía se digita. */
  movimientos: number;
  onCerrar: () => void;
  onGuardado: (p: { id: number; sku: string; name: string }) => void;
}) {
  const [cat, setCat] = useState<Catalogos | null>(null);

  const [name, setName] = useState(producto?.name ?? "");
  const [description, setDescription] = useState(producto?.description ?? "");
  const [categoryId, setCategoryId] = useState(String(producto?.categoryId ?? ""));
  const [brandId, setBrandId] = useState(String(producto?.brandId ?? ""));
  const [supplierId, setSupplierId] = useState(String(producto?.supplierId ?? ""));

  /*
    El proveedor se crea en otra pestaña; esta se entera por BroadcastChannel,
    lo agrega a la lista y lo deja ELEGIDO. Es la respuesta a «¿es posible
    hacer el refresco en la pestaña paralela?»: sí, y sin recargar ni sondear.
  */
  useCatalogoCreado((m) => {
    if (m.tipo !== "proveedor") return;
    setCat((c) =>
      c && !c.proveedores.some((p) => p.id === m.id)
        ? { ...c, proveedores: [...c.proveedores, { id: m.id, name: m.name }].sort(porNombre) }
        : c,
    );
    setSupplierId(String(m.id));
  });
  const [saleUnitId, setSaleUnitId] = useState(String(producto?.saleUnitId ?? ""));
  const [purchaseUnitId, setPurchaseUnitId] = useState(String(producto?.purchaseUnitId ?? ""));
  const [precio, setPrecio] = useState(producto ? String(producto.priceGross) : "");
  const [costo, setCosto] = useState(producto?.costNetMilliPeso ? String(producto.costNetMilliPeso / 1000) : "");
  const [minimo, setMinimo] = useState(producto ? String(producto.reorderLevelBaseMilli / 1000) : "");
  const [activo, setActivo] = useState(producto?.active ?? true);
  const [codigos, setCodigos] = useState<string[]>(producto?.barcodes.map((b) => b.code) ?? []);
  const [codigoNuevo, setCodigoNuevo] = useState("");

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const primerCampo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    primerCampo.current?.focus();
    void (async () => {
      try {
        const [u, c, m, p] = await Promise.all([
          api<{ grupos: GrupoDeUnidades[] }>("/catalog/units"),
          api<{ categorias: Nombrado[] }>("/catalog/categories"),
          api<{ marcas: Nombrado[] }>("/catalog/brands"),
          api<{ proveedores: Nombrado[] }>("/catalog/suppliers"),
        ]);
        setCat({ unidades: aplanar(u.grupos), categorias: c.categorias, marcas: m.marcas, proveedores: p.proveedores });
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "No se pudieron cargar las unidades");
      }
    })();
  }, []);

  const uVenta = cat?.unidades.find((u) => String(u.id) === saleUnitId);
  const uCompra = cat?.unidades.find((u) => String(u.id) === purchaseUnitId);
  const uBase = cat?.unidades.find((u) => u.isBase && u.group.id === uVenta?.group.id);

  const problemaUnidades = uVenta && uCompra ? validarUnidades(uVenta, uCompra) : null;
  const conversion = uVenta && uCompra && !problemaUnidades ? describirConversion(uVenta, uCompra) : null;

  const precioNum = entero(precio);
  const costoNum = entero(costo);
  const costoEditable = !producto || movimientos === 0;

  /**
   * El costo lleva DOS lecturas y las dos importan: cuánto sale la unidad que
   * se vende (que es lo que se compara con el precio) y cuánto margen deja.
   */
  const lectura = useMemo(() => {
    if (!uVenta || costoNum === null || costoNum <= 0 || precioNum === null || precioNum <= 0) return null;
    const porVenta = costoPorUnidadDeVenta({ costNetMilliPeso: costoNum * 1000, saleUnit: uVenta });
    const margen = margenDeListaPct({ priceGross: precioNum, costNetMilliPeso: costoNum * 1000, saleUnit: uVenta });
    return { porVenta, margen, seLoCome: porVenta >= precioNum };
  }, [uVenta, costoNum, precioNum]);

  function agregarCodigo() {
    const limpio = normalizeBarcode(codigoNuevo);
    if (!limpio) return;
    if (codigos.includes(limpio)) {
      setError(`El código ${limpio} ya está en la lista`);
      return;
    }
    setCodigos((c) => [...c, limpio]);
    setCodigoNuevo("");
    setError(null);
  }

  async function guardar() {
    setError(null);
    if (!name.trim()) return setError("Falta el nombre del producto");
    if (!saleUnitId || !purchaseUnitId) return setError("Falta elegir las unidades de venta y de compra");
    if (problemaUnidades) return setError(problemaUnidades);
    if (precioNum === null) return setError("El precio va en pesos enteros, sin decimales");

    const cuerpo: Record<string, unknown> = {
      name: name.trim(),
      description: description.trim() || null,
      categoryId: categoryId ? Number(categoryId) : null,
      brandId: brandId ? Number(brandId) : null,
      supplierId: supplierId ? Number(supplierId) : null,
      saleUnitId: Number(saleUnitId),
      purchaseUnitId: Number(purchaseUnitId),
      priceGross: precioNum,
      reorderLevelBaseMilli: Math.round((entero(minimo) ?? 0) * 1000),
      active: activo,
      barcodes: codigos,
    };
    // El costo solo viaja si todavía se puede digitar: mandarlo bloqueado haría
    // que el servidor rechace la edición entera por un campo que ni se tocó.
    if (costoEditable) cuerpo.costNetMilliPeso = (costoNum ?? 0) * 1000;

    setGuardando(true);
    try {
      const r = producto
        ? await api<{ producto: { id: number; sku: string; name: string } }>(`/products/${producto.id}`, {
            method: "PATCH",
            body: JSON.stringify(cuerpo),
          })
        : await api<{ producto: { id: number; sku: string; name: string } }>("/products", {
            method: "POST",
            body: JSON.stringify(cuerpo),
          });
      onGuardado(r.producto);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={producto ? `Editar ${producto.name}` : "Producto nuevo"}
      bajada={
        producto ? (
          <span className="fh-num">{producto.sku}</span>
        ) : (
          "El SKU lo pone el sistema al guardar, correlativo. No se teclea: queda impreso en la etiqueta."
        )
      }
      ancho="lg"
      onCerrar={onCerrar}
    >
      {!cat ? (
        <p className="mt-4 text-ink-soft">Cargando unidades…</p>
      ) : (
        <div className="mt-4 grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo
              ref={primerCampo}
              etiqueta="Nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cable eléctrico 2,5 mm"
            />
            <Campo
              etiqueta="Descripción (opcional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/*
            Los tres se pueden crear sin salir de acá, que era lo que faltaba:
            una instalación nueva no trae ninguna categoría, ninguna marca y
            ningún proveedor, así que el formulario ofrecía tres listas vacías
            y no había forma de llenarlas desde ninguna pantalla.

            Categoría y marca son solo un nombre y se crean en línea. El
            proveedor tiene RUT, teléfono, correo y notas, y se crea en una
            pestaña aparte para no obligar a abandonar un producto a medio
            escribir mientras se busca el RUT en una factura.
          */}
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectorCreable
              etiqueta="Categoría"
              vacio="Sin categoría"
              value={categoryId}
              onChange={setCategoryId}
              opciones={cat.categorias}
              crear={async (name) => {
                const r = await api<{ categoria: Nombrado }>("/catalog/categories", {
                  method: "POST",
                  body: JSON.stringify({ name }),
                });
                setCat((c) => (c ? { ...c, categorias: [...c.categorias, r.categoria].sort(porNombre) } : c));
                return r.categoria;
              }}
            />
            <SelectorCreable
              etiqueta="Marca"
              vacio="Sin marca"
              value={brandId}
              onChange={setBrandId}
              opciones={cat.marcas}
              crear={async (name) => {
                const r = await api<{ marca: Nombrado }>("/catalog/brands", {
                  method: "POST",
                  body: JSON.stringify({ name }),
                });
                setCat((c) => (c ? { ...c, marcas: [...c.marcas, r.marca].sort(porNombre) } : c));
                return r.marca;
              }}
            />
            <div>
              <div className="mb-1 flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-ink-soft">Proveedor</span>
                <button
                  type="button"
                  onClick={() => window.open("/proveedores/nuevo", "_blank", "noopener")}
                  className="text-xs text-ink-soft underline underline-offset-4"
                >
                  + nuevo
                </button>
              </div>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-3"
              >
                <option value="">Sin proveedor</option>
                {cat.proveedores.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Selector
              etiqueta="Se vende por"
              value={saleUnitId}
              onChange={(e) => setSaleUnitId(e.target.value)}
              hint="La unidad del precio de repisa"
            >
              <option value="">Elegir…</option>
              {cat.unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.symbol}) · {u.group.name.toLowerCase()}
                </option>
              ))}
            </Selector>
            <Selector
              etiqueta="Se compra por"
              value={purchaseUnitId}
              onChange={(e) => setPurchaseUnitId(e.target.value)}
              hint="Como viene del proveedor"
            >
              <option value="">Elegir…</option>
              {cat.unidades.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.symbol}) · {u.group.name.toLowerCase()}
                </option>
              ))}
            </Selector>
          </div>

          {problemaUnidades ? (
            <p className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">
              {problemaUnidades}
            </p>
          ) : conversion ? (
            <p className="text-sm text-ink-soft">{conversion}</p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-3">
            <Campo
              etiqueta={`Precio de repisa${uVenta ? ` por ${uVenta.symbol}` : ""}`}
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              inputMode="numeric"
              hint="Con IVA incluido, en pesos enteros"
            />
            <Campo
              etiqueta={`Costo neto por ${uBase?.symbol ?? "unidad base"}`}
              value={costo}
              onChange={(e) => setCosto(e.target.value)}
              inputMode="numeric"
              disabled={!costoEditable}
              hint={
                costoEditable
                  ? "Sin IVA. Se digita solo hasta el primer movimiento"
                  : "Lo manda el libro: este producto ya tuvo movimientos"
              }
            />
            <Campo
              etiqueta={`Stock mínimo${uBase ? ` en ${uBase.symbol}` : ""}`}
              value={minimo}
              onChange={(e) => setMinimo(e.target.value)}
              inputMode="numeric"
              hint="Bajo esto avisa. Cero = no avisa"
            />
          </div>

          {/*
            El aviso de la unidad equivocada. No es un error: 4900 es un número
            válido, y el sistema no puede saber si el saco cuesta eso o si el
            kilo cuesta eso. Lo que sí puede es mostrar la consecuencia.
          */}
          {lectura ? (
            <p
              className={`rounded-[var(--fh-radio)] border p-3 text-sm ${
                lectura.seLoCome ? "border-warn/30 bg-warn/10 text-warn" : "border-line bg-bg text-ink-soft"
              }`}
            >
              Sale {formatCLP(lectura.porVenta)} por {uVenta?.symbol} y se vende a {formatCLP(precioNum ?? 0)}
              {lectura.seLoCome ? (
                <>
                  : <strong>el costo se come el precio</strong>. Revisa si escribiste el costo por{" "}
                  {uVenta?.symbol} donde la casilla pide por {uBase?.symbol}.
                </>
              ) : (
                <>
                  , o sea {lectura.margen === null ? "—" : `${lectura.margen.toFixed(1).replace(".", ",")}%`} de margen.
                </>
              )}
            </p>
          ) : null}

          <div>
            <span className="mb-1 block text-sm font-medium text-ink-soft">Códigos de barra</span>
            <div className="flex flex-wrap items-center gap-2">
              {codigos.map((c) => (
                <span key={c} className="fh-num inline-flex items-center gap-2 border border-line-field px-3 py-1 text-sm">
                  {c}
                  <button
                    aria-label={`Quitar ${c}`}
                    onClick={() => setCodigos((xs) => xs.filter((x) => x !== c))}
                    className="text-ink-soft hover:text-error"
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={codigoNuevo}
                onChange={(e) => setCodigoNuevo(e.target.value)}
                onKeyDown={(e) => {
                  // El lector termina con Enter: escanear y listo, sin botón.
                  if (e.key === "Enter") {
                    e.preventDefault();
                    agregarCodigo();
                  }
                }}
                placeholder="Escanea o escribe y Enter"
                className="min-h-touch flex-1 rounded-[var(--fh-radio)] border border-line bg-surface px-3 text-ink placeholder:text-ink-soft/60"
              />
            </div>
            <span className="mt-1 block text-xs text-ink-soft">
              El del fabricante va acá: el SKU interno se genera igual y ambos encuentran el producto.
            </span>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} />
            Se vende hoy
            <span className="text-ink-soft">— desmarcado sigue en el catálogo pero no se puede vender</span>
          </label>

          {error ? (
            <p className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">
              {error}
            </p>
          ) : null}

          <Acciones>
            <Boton onClick={onCerrar}>Cancelar</Boton>
            <Boton variante="principal" onClick={guardar} disabled={guardando}>
              {guardando ? "Guardando…" : producto ? "Guardar cambios" : "Crear producto"}
            </Boton>
          </Acciones>
        </div>
      )}
    </Modal>
  );
}
