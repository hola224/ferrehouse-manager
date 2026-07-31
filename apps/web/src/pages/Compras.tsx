/**
 * Registro de compras al proveedor (tarea 4.1, sin pantalla hasta ahora).
 *
 * Es la pantalla que **mueve el costo promedio**, y por eso muestra en qué
 * queda cada producto apenas se guarda: digitar una factura es la única
 * operación del sistema que cambia el número con el que después se calcula
 * todo margen. Si el resultado no se ve, un cero de más en el costo se
 * descubre semanas después, en un reporte que ya nadie sabe leer al revés.
 *
 * **La cantidad y el costo van en la unidad de COMPRA**, que es como viene la
 * factura: 2 rollos a $45.000 cada uno, no 200 metros a $450. Convertir de
 * cabeza en el mesón es cómo se cargan cien metros donde iban mil.
 *
 * **La fecha es la de recepción, no la del tecleo.** Una factura del viernes
 * digitada el lunes entra al libro con fecha del viernes: si no, el inventario
 * valorizado al viernes y el reporte de compras del viernes no coinciden.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Acciones, Boton, Campo, Modal, Selector, Tarjeta } from "@/components/ui";
import { formatCLP, parseCantidadMilli, roundSym } from "@ferrehouse/shared";

type Nombrado = { id: number; name: string };
type Unidad = { id: number; name: string; symbol: string; factorMilli: number; groupId: number };

type Compra = {
  id: number;
  supplier: Nombrado;
  documentNumber: string | null;
  receivedAt: string;
  totalNet: number;
  lineas: number;
  user: { name: string };
};

type Hallazgo = {
  id: number;
  sku: string;
  name: string;
  saleUnit: Unidad;
  purchaseUnit: Unidad;
};

type Linea = {
  producto: Hallazgo;
  unitId: number;
  cantidad: string;
  costo: string;
};

function hoyTexto(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * El instante que se manda al servidor para una fecha elegida en el calendario.
 *
 * **Si es hoy, va el momento actual.** Parece un detalle y no lo es: el
 * servidor rechaza las recepciones futuras —con razón, un año mal tecleado es
 * el error más común— y mandar el mediodía de hoy a las 9 de la mañana ES una
 * fecha futura. La entrega del proveedor llega en la mañana, así que la
 * pantalla habría rechazado casi todas las facturas del día con un mensaje
 * incomprensible: el administrador eligió hoy y le responden que es futuro.
 *
 * Para cualquier otro día va el mediodía, y ahí sí por la zona horaria:
 * guardar la medianoche local de una fecha pasada la corre un día hacia atrás
 * al serializarla en UTC.
 */
function instanteDeRecepcion(fecha: string, ahora = new Date()): string {
  if (fecha === hoyTexto(ahora)) return ahora.toISOString();
  return new Date(`${fecha}T12:00:00`).toISOString();
}

/** Neto exacto de una línea, con la misma cuenta que hace el servidor. */
function totalLinea(l: Linea): number | null {
  const qty = parseCantidadMilli(l.cantidad);
  const costo = Number(l.costo.replace(/[^\d]/g, ""));
  if (qty === null || qty <= 0 || !Number.isFinite(costo) || costo <= 0) return null;
  return roundSym((costo * qty) / 1000);
}

export function Compras() {
  const [compras, setCompras] = useState<Compra[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nueva, setNueva] = useState(false);
  const [resultado, setResultado] = useState<{ id: number; costos: string[] } | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setCompras((await api<{ compras: Compra[] }>("/purchases")).compras);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudieron cargar las compras");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      if (e.key === "F2" && !nueva) {
        e.preventDefault();
        setNueva(true);
      }
    }
    window.addEventListener("keydown", alTeclear);
    return () => window.removeEventListener("keydown", alTeclear);
  }, [nueva]);

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-end">
        {/* El título lo pone la barra del `AdminShell`: repetirlo acá era
            dos veces la misma palabra a 40px de distancia. */}
        <Boton variante="principal" onClick={() => setNueva(true)} tecla="F2">
          + Digitar factura
        </Boton>
      </div>

      {error ? (
        <p className="border border-accent bg-accent-tint p-3 text-sm text-accent-ink">{error}</p>
      ) : null}

      {resultado ? (
        <Tarjeta titulo={`Compra #${resultado.id} registrada`}>
          <p className="text-sm text-ink-soft">
            Así quedó el costo promedio de cada producto. Es el número con el que se calcula el margen de ahora en
            adelante.
          </p>
          <ul className="mt-2 grid gap-1 text-sm">
            {resultado.costos.map((t) => (
              <li key={t} className="border-b border-line-soft py-1 last:border-0">
                {t}
              </li>
            ))}
          </ul>
          <button onClick={() => setResultado(null)} className="mt-3 text-sm underline underline-offset-4">
            Cerrar
          </button>
        </Tarjeta>
      ) : null}

      {cargando ? (
        <p className="text-ink-soft">Cargando…</p>
      ) : compras.length === 0 ? (
        <div className="rounded-[var(--fh-radio)] border border-line bg-surface p-8 text-center">
          <p className="text-ink">Todavía no hay ninguna factura digitada.</p>
          <p className="mt-1 text-sm text-ink-soft">
            Digitar la compra es lo que carga el stock y fija el costo promedio. Hasta que entre la primera, el margen
            de esos productos se calcula con el costo que se tecleó a mano.
          </p>
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead className="border-b-2 border-ink text-left text-[10.5px] uppercase tracking-[0.11em] text-ink-soft">
            <tr className="border-b border-line">
              <th className="px-3 py-[9px] font-extrabold">Recibida</th>
              <th className="px-3 py-[9px] font-extrabold">Proveedor</th>
              <th className="px-3 py-[9px] font-extrabold">Documento</th>
              <th className="px-3 py-[9px] text-right font-extrabold">Líneas</th>
              <th className="px-3 py-[9px] text-right font-extrabold">Total neto</th>
              <th className="px-3 py-[9px] font-extrabold">Digitó</th>
            </tr>
          </thead>
          <tbody>
            {compras.map((c) => (
              <tr key={c.id} className="border-b border-line-soft">
                <td className="fh-num px-3 py-2">{new Date(c.receivedAt).toLocaleDateString("es-CL")}</td>
                <td className="px-3 py-2 font-medium">{c.supplier.name}</td>
                <td className="fh-num px-3 py-2 text-ink-soft">{c.documentNumber ?? "—"}</td>
                <td className="fh-num px-3 py-2 text-right">{c.lineas}</td>
                <td className="fh-num px-3 py-2 text-right font-semibold">{formatCLP(c.totalNet)}</td>
                <td className="px-3 py-2 text-ink-soft">{c.user.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/*
        Va al pie y no en un tooltip: es lo que hay que saber ANTES de digitar,
        y explica por qué el formulario no tiene botón de editar. Que una compra
        no se pueda deshacer no es una limitación que se disculpa — es lo que
        hace que el costo promedio signifique algo.
      */}
      <p className="text-[13px] text-ink-soft">
        Digitar una factura escribe el movimiento de entrada en el kardex y recalcula el costo promedio. No se puede
        editar después: se corrige con un ajuste, que también queda registrado.
      </p>

      {nueva ? (
        <FacturaNueva
          onCerrar={() => setNueva(false)}
          onGuardada={(r) => {
            setNueva(false);
            setResultado(r);
            void cargar();
          }}
        />
      ) : null}
    </div>
  );
}

function FacturaNueva({
  onCerrar,
  onGuardada,
}: {
  onCerrar: () => void;
  onGuardada: (r: { id: number; costos: string[] }) => void;
}) {
  const [proveedores, setProveedores] = useState<Nombrado[]>([]);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [recibida, setRecibida] = useState(hoyTexto());
  const [notes, setNotes] = useState("");
  const [lineas, setLineas] = useState<Linea[]>([]);

  const [busqueda, setBusqueda] = useState("");
  const [hallazgos, setHallazgos] = useState<Hallazgo[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const caja = useRef<HTMLInputElement>(null);

  useEffect(() => {
    caja.current?.focus();
    void Promise.all([
      api<{ proveedores: Nombrado[] }>("/catalog/suppliers"),
      api<{ grupos: Array<{ units: Unidad[] }> }>("/catalog/units"),
    ])
      .then(([p, u]) => {
        setProveedores(p.proveedores);
        // El servidor las sirve agrupadas por magnitud; acá se necesitan planas.
        setUnidades(u.grupos.flatMap((g) => g.units));
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "No se pudieron cargar los proveedores"));
  }, []);

  useEffect(() => {
    if (busqueda.trim().length === 0) {
      setHallazgos([]);
      return;
    }
    let vigente = true;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ exacto: boolean; productos: Hallazgo[] }>(
          `/products/search?q=${encodeURIComponent(busqueda.trim())}`,
        );
        if (!vigente) return;
        // Escaneo con calce exacto: entra a la factura sin pasar por la lista.
        if (r.exacto && r.productos[0]) {
          agregar(r.productos[0]);
          setHallazgos([]);
        } else {
          setHallazgos(r.productos);
        }
      } catch {
        if (vigente) setHallazgos([]);
      }
    }, 180);
    return () => {
      vigente = false;
      clearTimeout(t);
    };
  }, [busqueda]);

  function agregar(p: Hallazgo) {
    setLineas((ls) =>
      ls.some((l) => l.producto.id === p.id)
        ? ls
        : [...ls, { producto: p, unitId: p.purchaseUnit.id, cantidad: "", costo: "" }],
    );
    setBusqueda("");
    setHallazgos([]);
    caja.current?.focus();
  }

  function cambiar(i: number, campo: "cantidad" | "costo" | "unitId", valor: string) {
    setLineas((ls) => ls.map((l, k) => (k === i ? { ...l, [campo]: campo === "unitId" ? Number(valor) : valor } : l)));
  }

  const total = lineas.reduce((t, l) => t + (totalLinea(l) ?? 0), 0);
  const incompletas = lineas.filter((l) => totalLinea(l) === null).length;

  async function guardar() {
    setError(null);
    if (!supplierId) return setError("Falta elegir el proveedor");
    if (lineas.length === 0) return setError("La factura no tiene ninguna línea");
    if (incompletas > 0) return setError("Hay líneas sin cantidad o sin costo");

    setGuardando(true);
    try {
      const r = await api<{ compra: { id: number }; costos: Array<{ texto: string }> }>("/purchases", {
        method: "POST",
        body: JSON.stringify({
          supplierId: Number(supplierId),
          documentNumber: documentNumber.trim() || null,
          notes: notes.trim() || null,
          receivedAt: instanteDeRecepcion(recibida),
          items: lineas.map((l) => ({
            productId: l.producto.id,
            unitId: l.unitId,
            qtyMilli: parseCantidadMilli(l.cantidad)!,
            unitCostNet: Number(l.costo.replace(/[^\d]/g, "")),
          })),
        }),
      });
      // El servidor ya arma el texto en la unidad de VENTA ("$485,59 por m"),
      // que es como se piensa el costo en el mesón. Rearmarlo acá sería tener
      // dos formatos del mismo número.
      onGuardada({ id: r.compra.id, costos: r.costos.map((c) => c.texto) });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo registrar la compra");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo="Digitar factura de proveedor"
      bajada="La cantidad y el costo van como vienen en la factura: por unidad de compra, sin IVA."
      ancho="xl"
      onCerrar={onCerrar}
    >
      <div className="mt-4 grid gap-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Selector etiqueta="Proveedor" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Elegir…</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Selector>
          <Campo
            etiqueta="Nº de documento"
            value={documentNumber}
            onChange={(e) => setDocumentNumber(e.target.value)}
            placeholder="F-8891"
          />
          <Campo
            etiqueta="Recibida el"
            type="date"
            value={recibida}
            onChange={(e) => setRecibida(e.target.value)}
            hint="La fecha del hecho, no la del tecleo"
          />
          <Campo etiqueta="Nota (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <div>
          <input
            ref={caja}
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Escanea o escribe el producto que llegó"
            className="min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-4 text-lg text-ink placeholder:text-ink-soft/60"
          />
          {hallazgos.length > 0 ? (
            <ul className="mt-1 max-h-40 overflow-y-auto rounded-[var(--fh-radio)] border border-line bg-surface">
              {hallazgos.map((h) => (
                <li key={h.id}>
                  <button
                    onClick={() => agregar(h)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-bg"
                  >
                    <span>{h.name}</span>
                    <span className="fh-num text-ink-soft">{h.sku}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        {lineas.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="border-b-2 border-ink text-left text-[10.5px] uppercase tracking-[0.11em] text-ink-soft">
              <tr className="border-b border-line">
                <th className="py-[9px] font-extrabold">Producto</th>
                <th className="py-[9px] font-extrabold">Unidad</th>
                <th className="py-[9px] font-extrabold">Cantidad</th>
                <th className="py-[9px] font-extrabold">Costo neto c/u</th>
                <th className="py-[9px] text-right font-extrabold">Neto</th>
                <th className="py-[9px] font-extrabold"></th>
              </tr>
            </thead>
            <tbody>
              {lineas.map((l, i) => {
                const t = totalLinea(l);
                // Solo las unidades del mismo grupo: comprar en kilos algo que
                // se vende en metros no es un error de tecleo, es imposible.
                const compatibles = unidades.filter((u) => u.groupId === l.producto.saleUnit.groupId);
                return (
                  <tr key={l.producto.id} className="border-b border-line-soft">
                    <td className="py-2">
                      <div className="font-medium">{l.producto.name}</div>
                      <div className="fh-num text-xs text-ink-soft">{l.producto.sku}</div>
                    </td>
                    <td className="py-2">
                      <select
                        value={l.unitId}
                        onChange={(e) => cambiar(i, "unitId", e.target.value)}
                        className="min-h-touch rounded-[var(--fh-radio)] border border-line bg-surface px-2"
                      >
                        {compatibles.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2">
                      <input
                        value={l.cantidad}
                        onChange={(e) => cambiar(i, "cantidad", e.target.value)}
                        inputMode="decimal"
                        className="min-h-touch w-24 rounded-[var(--fh-radio)] border border-line bg-surface px-2 text-right"
                      />
                    </td>
                    <td className="py-2">
                      <input
                        value={l.costo}
                        onChange={(e) => cambiar(i, "costo", e.target.value)}
                        inputMode="numeric"
                        className="min-h-touch w-28 rounded-[var(--fh-radio)] border border-line bg-surface px-2 text-right"
                      />
                    </td>
                    <td className="fh-num py-2 text-right font-semibold">{t === null ? "—" : formatCLP(t)}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => setLineas((ls) => ls.filter((_, k) => k !== i))}
                        aria-label={`Quitar ${l.producto.name}`}
                        className="px-2 text-ink-soft hover:text-error"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-ink-soft">Todavía no hay líneas. Escanea o busca el primer producto.</p>
        )}

        {error ? (
          <p className="border border-accent bg-accent-tint p-3 text-sm text-accent-ink">{error}</p>
        ) : null}

        <div className="sticky bottom-0 -mx-6 mt-4 flex items-center justify-between border-t border-line bg-surface px-6 py-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-ink-soft">Total neto de la factura</div>
            <div className="fh-num text-2xl font-black">{formatCLP(total)}</div>
            {incompletas > 0 ? (
              <div className="text-sm text-warn">
                {incompletas} línea{incompletas > 1 ? "s" : ""} sin cantidad o sin costo
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Boton onClick={onCerrar}>Cancelar</Boton>
            <Boton variante="principal" onClick={guardar} disabled={guardando || lineas.length === 0}>
              {guardando ? "Registrando…" : "Registrar compra"}
            </Boton>
          </div>
        </div>
      </div>
    </Modal>
  );
}
