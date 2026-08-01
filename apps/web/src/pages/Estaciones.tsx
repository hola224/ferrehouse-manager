/**
 * Cajas y terminales (tarea 2.7 en el servidor, 7.5 en la instalación).
 *
 * Una estación es una caja física, y define dos cosas: **de qué ubicación sale
 * el stock que vende** y **a qué impresora manda sus tickets**. Existe como
 * tabla desde el día uno porque la sesión de caja cuelga de ella (ADR-004).
 *
 * Hasta ahora se administraba por API. El `README` de instalación decía, con
 * esas palabras, que activar la CAJA-2 se hacía con `POST /api/stations` — o
 * sea que la segunda caja de la tienda dependía de que alguien supiera escribir
 * un `curl`.
 *
 * **Una estación no se borra: se desactiva.** Sus sesiones de caja, sus ventas
 * y sus trabajos de impresión la referencian, y esas tablas son historia.
 *
 * No tiene pestaña propia en el menú: se toca al instalar y casi nunca más, y
 * una pestaña permanente para eso es ruido en una barra que el vendedor mira
 * todo el día. Se llega desde Usuarios, que es la otra mitad de la misma
 * pregunta —quién entra y desde dónde—, y es lo que pide la pantalla de
 * entrada.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { Acciones, Boton, Campo, Chip, Modal, Selector } from "@/components/ui";
import { ProbadorDeTeclas } from "@/components/ProbadorDeTeclas";
import { formatHora } from "@ferrehouse/shared";

type Estacion = {
  id: number;
  name: string;
  locationId: number;
  printerTarget: string | null;
  printerWidth: number;
  active: boolean;
  location: { id: number; name: string };
  sessions: Array<{ id: number; openedAt: string }>;
};

/**
 * Los dos papeles de ticket que existen en el mercado, por sus columnas de
 * texto. El servidor acepta valores intermedios (hay térmicas de 42), pero el
 * selector ofrece los dos normales: quien tenga una rara sabe qué número poner
 * y puede pedirlo por API.
 */
const PAPELES = [
  { columnas: 32, nombre: "58 mm (angosto, 32 columnas)" },
  { columnas: 48, nombre: "80 mm (ancho, 48 columnas)" },
];

type Ubicacion = { id: number; name: string };

export function Estaciones() {
  const [estaciones, setEstaciones] = useState<Estacion[]>([]);
  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState<Estacion | "nueva" | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await api<{ estaciones: Estacion[] }>("/stations");
      setEstaciones(r.estaciones);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudieron cargar las cajas");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
    /*
      Las ubicaciones se leen aparte y no bloquean: con una sola tienda hay una
      sola, y el selector va a mostrar esa. La pantalla igual la pide, porque el
      modelo soporta la segunda bodega desde el día uno (decisión 12).
    */
    void api<{ ubicaciones: Ubicacion[] }>("/catalog/locations")
      .then((r) => setUbicaciones(r.ubicaciones))
      .catch(() => setUbicaciones([]));
  }, [cargar]);

  async function cambiarActiva(e: Estacion) {
    setError(null);
    try {
      await api(`/stations/${e.id}`, { method: "PATCH", body: JSON.stringify({ active: !e.active }) });
      setAviso(`${e.name} quedó ${e.active ? "desactivada" : "activa"}.`);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cambiar");
    }
  }

  if (cargando) return <p className="text-ink-soft">Cargando…</p>;

  return (
    <div className="grid gap-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-black tracking-tight">Cajas y terminales</h1>
        <Link to="/usuarios" className="text-sm underline underline-offset-4">
          Ir a usuarios
        </Link>
      </div>

      <p className="text-sm text-ink-soft">
        Cada terminal entra eligiendo su caja en la pantalla de entrada. La caja define de qué ubicación sale el stock
        que vende y a qué impresora manda sus tickets. <strong>Una caja no se borra: se desactiva</strong>, porque sus
        ventas y sus arqueos la referencian.
      </p>

      {error ? <p className="text-error">{error}</p> : null}
      {aviso ? <p className="text-ok">{aviso}</p> : null}

      <div className="overflow-x-auto rounded-[var(--fh-radio)] border border-line bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-soft">
              <th className="px-4 py-2">Caja</th>
              <th className="px-4 py-2">Ubicación</th>
              <th className="px-4 py-2">Impresora</th>
              <th className="px-4 py-2">Estado</th>
              <th className="px-4 py-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {estaciones.map((e) => {
              const abierta = e.sessions[0];
              return (
                <tr key={e.id} className="border-b border-line/60">
                  <td className="fh-num px-4 py-3 font-semibold">{e.name}</td>
                  <td className="px-4 py-3">{e.location.name}</td>
                  <td className="px-4 py-3">
                    {e.printerTarget ? (
                      <span className="fh-num">
                        {e.printerTarget}
                        <span className="text-ink-soft"> · {e.printerWidth === 48 ? "80 mm" : e.printerWidth === 32 ? "58 mm" : `${e.printerWidth} col`}</span>
                      </span>
                    ) : (
                      /*
                        Se dice el HECHO —no imprime— y no la intención. El
                        modelo usa `null` para el terminal de consulta, pero
                        una caja recién instalada también nace en `null`, y
                        llamarla «terminal de consulta» le estaría diciendo al
                        instalador que está bien así cuando en realidad no va a
                        salir ningún ticket ni se va a abrir el cajón.
                      */
                      <span className="text-warn">sin impresora · no imprime ni abre el cajón</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {abierta ? (
                      <Chip tono="ok">caja abierta desde las {formatHora(abierta.openedAt)}</Chip>
                    ) : e.active ? (
                      <Chip tono="neutral">activa</Chip>
                    ) : (
                      <Chip tono="warn">desactivada</Chip>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => setEditando(e)} className="underline underline-offset-4 hover:text-ink">
                      Editar
                    </button>
                    {/*
                      Con la caja abierta no se desactiva ni se le cambia nada:
                      el servidor lo rechaza y la pantalla no ofrece el botón,
                      para no invitar a un error que ya tiene su respuesta.
                    */}
                    {!abierta ? (
                      <button
                        onClick={() => void cambiarActiva(e)}
                        className="ml-4 underline underline-offset-4 hover:text-ink"
                      >
                        {e.active ? "Desactivar" : "Activar"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <Boton variante="principal" onClick={() => setEditando("nueva")}>
          Agregar una caja
        </Boton>
      </div>

      {editando ? (
        <FormEstacion
          estacion={editando === "nueva" ? null : editando}
          ubicaciones={ubicaciones}
          onCerrar={() => setEditando(null)}
          onListo={async (mensaje) => {
            setEditando(null);
            setAviso(mensaje);
            await cargar();
          }}
        />
      ) : null}
      {/*
        Va acá y no en una pantalla nueva: esta es la pantalla de instalación
        —se toca al instalar y casi nunca más— y comprobar los atajos es
        exactamente una tarea de instalación, una por terminal.
      */}
      <ProbadorDeTeclas />

    </div>
  );
}

function FormEstacion({
  estacion,
  ubicaciones,
  onCerrar,
  onListo,
}: {
  estacion: Estacion | null;
  ubicaciones: Ubicacion[];
  onCerrar: () => void;
  onListo: (mensaje: string) => Promise<void>;
}) {
  const [name, setName] = useState(estacion?.name ?? "");
  const [locationId, setLocationId] = useState(estacion?.locationId ?? ubicaciones[0]?.id ?? 0);
  const [printerTarget, setPrinterTarget] = useState(estacion?.printerTarget ?? "");
  const [printerWidth, setPrinterWidth] = useState(estacion?.printerWidth ?? 32);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const abierta = (estacion?.sessions.length ?? 0) > 0;
  /**
   * El servidor normaliza el nombre a mayúsculas con guiones y exige
   * `CAJA-1`. Se muestra ANTES de guardar lo que va a quedar guardado: un campo
   * que cambia lo que uno escribió sin avisar hace dudar de todo lo demás.
   */
  const normalizado = name.trim().toUpperCase().replace(/\s+/g, "-");

  async function guardar() {
    setEnviando(true);
    setError(null);
    try {
      const cuerpo = {
        name: normalizado,
        locationId,
        printerTarget: printerTarget.trim() || null,
        printerWidth,
      };
      if (estacion) {
        await api(`/stations/${estacion.id}`, { method: "PATCH", body: JSON.stringify(cuerpo) });
        await onListo(`${normalizado} actualizada.`);
      } else {
        await api("/stations", { method: "POST", body: JSON.stringify(cuerpo) });
        await onListo(`${normalizado} creada. Ya aparece en la pantalla de entrada.`);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar");
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo={estacion ? `Editar ${estacion.name}` : "Agregar una caja"}
      bajada={
        <>
          El nombre se dice en voz alta —«ciérrame la CAJA-2»— y sale impreso en el reporte de cierre, así que va en un
          solo formato: <span className="fh-num">CAJA-1</span>, <span className="fh-num">CAJA-2</span>.
        </>
      }
      onCerrar={onCerrar}
    >
      <div className="grid gap-4">
        <Campo
          etiqueta="Nombre"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          hint={
            normalizado && normalizado !== name.trim() ? `Se va a guardar como ${normalizado}` : "Mayúsculas y guiones"
          }
        />

        <Selector
          etiqueta="Ubicación"
          hint="De dónde sale el stock que vende esta caja."
          value={locationId}
          disabled={abierta}
          onChange={(e) => setLocationId(Number(e.target.value))}
        >
          {ubicaciones.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Selector>

        <Campo
          etiqueta="Impresora"
          hint="El nombre del recurso compartido de Windows de la térmica. Vacío = terminal de consulta, que no imprime."
          value={printerTarget}
          disabled={abierta}
          onChange={(e) => setPrinterTarget(e.target.value)}
          placeholder="\\\\SERVIDOR\\TERMICA"
          className="fh-num"
        />

        <Selector
          etiqueta="Papel del ticket"
          hint="El ancho del rollo. Si el ticket sale usando solo una parte del papel, esta caja tiene una térmica de 80 mm."
          value={printerWidth}
          disabled={abierta}
          onChange={(e) => setPrinterWidth(Number(e.target.value))}
        >
          {PAPELES.concat(PAPELES.some((p) => p.columnas === printerWidth) ? [] : [{ columnas: printerWidth, nombre: `${printerWidth} columnas` }]).map((p) => (
            <option key={p.columnas} value={p.columnas}>
              {p.nombre}
            </option>
          ))}
        </Selector>

        {abierta ? (
          <p className="text-sm text-warn">
            Esta caja tiene un turno abierto. La ubicación y la impresora no se pueden cambiar a mitad de turno: el
            stock ya salió de una bodega y los tickets ya se fueron a una impresora. Ciérrala primero.
          </p>
        ) : null}

        {error ? <p className="text-sm text-error">{error}</p> : null}

        <Acciones>
          <Boton variante="secundaria" type="button" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton
            variante="principal"
            type="button"
            disabled={enviando || normalizado.length < 3 || locationId === 0}
            onClick={() => void guardar()}
          >
            {enviando ? "Guardando…" : "Guardar"}
          </Boton>
        </Acciones>
      </div>
    </Modal>
  );
}
