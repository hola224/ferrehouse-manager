/**
 * Panel de WhatsApp (tareas 6.2, 6.4, 6.5 y 6.6). Solo el administrador.
 *
 * POR QUÉ ESTA PANTALLA EXISTE, y no es un lujo: el riesgo declarado del
 * sprint es que whatsapp-web.js se rompa cuando Meta cambie el DOM de WhatsApp
 * Web. Una integración que falla en silencio deja a la ferretería creyendo que
 * le escribe a sus clientes durante semanas. Acá el estado se mira de un
 * vistazo, con el último error en palabras y no en un log.
 *
 * Mientras no haya un número vinculado, la pantalla **dice exactamente eso** y
 * cuál es el paso que falta. La alternativa —un recuadro de QR vacío— haría
 * pensar que algo se rompió.
 */
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Acciones, Boton, Chip, Modal, Tarjeta } from "@/components/ui";
import {
  ESTADO_JOB_TEXT,
  ESTADO_JOB_TONE,
  ESTADO_SESION_TEXT,
  ESTADO_SESION_TONE,
  type EstadoJob,
  type EstadoSesion,
} from "@ferrehouse/shared";

type Panel = {
  sesion: {
    estado: EstadoSesion;
    qr: string | null;
    desde: string | null;
    hace: string | null;
    pendienteDeInstalacion: boolean;
  };
  cola: { pendientes: number; fallidos: number; enviadosHoy: number };
  plantilla: string;
  ejemplo: string;
  variables: Record<string, string>;
  maxIntentos: number;
  ultimos: Array<{
    id: string;
    saleId: number | null;
    cliente: string | null;
    telefono: string;
    mensaje: string;
    estado: EstadoJob;
    intentos: number;
    ultimoError: string | null;
    agendado: string;
    enviado: string | null;
  }>;
};

type Cliente = {
  id: number;
  nombre: string | null;
  telefono: string;
  consiente: boolean;
  desde: string | null;
  baja: string | null;
  compras: number;
};

export function WhatsApp() {
  const [panel, setPanel] = useState<Panel | null>(null);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [editando, setEditando] = useState(false);
  const [dandoDeBaja, setDandoDeBaja] = useState<Cliente | null>(null);

  const cargar = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([api<Panel>("/whatsapp"), api<{ clientes: Cliente[] }>("/whatsapp/clientes")]);
      setPanel(p);
      setClientes(c.clientes);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cargar el panel");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function accion(url: string, exito?: string) {
    setError(null);
    try {
      const r = await api<{ mensaje?: string }>(url, { method: "POST", body: "{}" });
      setAviso(r.mensaje ?? exito ?? null);
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo completar la acción");
    }
  }

  if (cargando) return <p className="text-ink-soft">Cargando…</p>;
  if (!panel) return <p className="text-error">{error ?? "No se pudo cargar el panel"}</p>;

  const dadosDeBaja = clientes.filter((c) => c.baja).length;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-black tracking-tight">WhatsApp</h1>
        <div className="flex gap-2">
          <Boton onClick={() => void accion("/whatsapp/pasada")}>Enviar los pendientes ahora</Boton>
          <Boton variante="secundaria" onClick={() => setEditando(true)}>
            Editar el mensaje
          </Boton>
        </div>
      </div>

      {aviso ? (
        <div className="rounded-[var(--fh-radio)] border border-line bg-surface p-3 text-sm">{aviso}</div>
      ) : null}
      {error ? (
        <div className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">
          {error}
        </div>
      ) : null}

      {/* --- 6.2: la sesión --- */}
      <Tarjeta titulo="La sesión">
        <div className="flex flex-wrap items-center gap-3">
          <Chip tono={ESTADO_SESION_TONE[panel.sesion.estado]}>{ESTADO_SESION_TEXT[panel.sesion.estado]}</Chip>
          {panel.sesion.hace ? <span className="text-sm text-ink-soft">hace {panel.sesion.hace}</span> : null}
        </div>

        {/*
          CADA ESTADO DICE QUÉ HACER, no solo cómo se llama.

          El riesgo declarado del sprint es que esto se rompa en silencio. Un
          chip rojo que dice "Se cayó la sesión" y nada más deja al
          administrador mirando siete mensajes en cola sin saber si tiene que
          esperar, reiniciar o volver a escanear algo. La caída es el estado en
          que más falta hace la instrucción, y era justo el que no la tenía.
        */}
        {panel.sesion.pendienteDeInstalacion ? (
          <Nota titulo="Falta vincular un número, y eso se hace una sola vez.">
            El paso pendiente es instalar <code className="fh-num">whatsapp-web.js</code> en el servidor y escanear el
            QR que va a aparecer acá, con el teléfono del <strong>número dedicado</strong> — nunca el personal de
            nadie. Todo lo demás ya está funcionando: las ventas guardan el cliente, los mensajes se van a la cola y
            las bajas se respetan. Cuando el número quede vinculado, la cola empieza a salir sola.
          </Nota>
        ) : panel.sesion.estado === "CAIDA" ? (
          <Nota tono="error" titulo="La sesión se cayó y los mensajes no están saliendo.">
            Suele pasar por tres cosas: el teléfono del número dedicado se quedó sin batería o sin internet, alguien
            cerró la sesión desde <strong>WhatsApp → Dispositivos vinculados</strong>, o WhatsApp cambió algo y hay que
            actualizar la integración. Revisa el teléfono primero. Lo que ya está en cola{" "}
            <strong>no se pierde ni se reintenta al infinito</strong>: espera a que la sesión vuelva.
          </Nota>
        ) : panel.sesion.estado === "ESPERANDO_QR" ? (
          <Nota tono="warn" titulo="Falta escanear el QR de abajo.">
            Hasta que alguien lo escanee con el teléfono del número dedicado, los mensajes se acumulan en la cola sin
            salir. No se pierde ninguno.
          </Nota>
        ) : null}

        {panel.sesion.qr ? (
          <div className="mt-3">
            <p className="mb-2 text-sm text-ink-soft">
              Escanéalo desde WhatsApp → Dispositivos vinculados. <strong>No lo compartas</strong>: quien lo escanee se
              lleva la sesión de la ferretería.
            </p>
            <pre className="overflow-x-auto rounded-[var(--fh-radio)] border border-line bg-bg p-3 text-[6px] leading-[6px]">
              {panel.sesion.qr}
            </pre>
          </div>
        ) : null}
      </Tarjeta>

      {/* --- 6.6: la cola --- */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Tarjeta titulo="En cola">
          <div className="fh-num text-4xl font-black">{panel.cola.pendientes}</div>
          {/*
            El texto tiene que ser cierto en LOS CUATRO estados. Decía "esperan
            a que haya un número vinculado" siempre que no estuviera conectada
            — y con la sesión caída el número SÍ está vinculado, así que el
            panel afirmaba algo falso. Es el mismo error del chip "Caja
            cerrada" del Sprint 0: dar por cierto un estado que nadie verificó.
          */}
          <p className="mt-1 text-xs text-ink-soft">
            {panel.sesion.estado === "CONECTADA"
              ? "Salen de a uno, con pausa entre medio."
              : panel.sesion.estado === "CAIDA"
                ? "Esperan a que vuelva la sesión. No se pierden."
                : "Esperan a que haya un número vinculado. No se pierden."}
          </p>
        </Tarjeta>
        <Tarjeta titulo="Enviados hoy">
          <div className="fh-num text-4xl font-black">{panel.cola.enviadosHoy}</div>
        </Tarjeta>
        <Tarjeta titulo="Fallidos">
          <div className={`fh-num text-4xl font-black ${panel.cola.fallidos > 0 ? "text-error" : ""}`}>
            {panel.cola.fallidos}
          </div>
          {/*
            No dice "se rindieron tras 5 intentos": un número que no tiene
            WhatsApp falla al PRIMERO y no se reintenta nunca, porque insistir
            no lo va a arreglar. Afirmar los cinco sería mentir en ese caso, que
            además es el más común de los dos.
          */}
          <p className="mt-1 text-xs text-ink-soft">
            Ya no se reintentan solos. El motivo de cada uno está abajo.
          </p>
        </Tarjeta>
      </div>

      {/* --- 6.4: la plantilla --- */}
      <Tarjeta titulo="El mensaje que se envía">
        <p className="rounded-[var(--fh-radio)] border border-line bg-bg p-3 text-sm">{panel.ejemplo}</p>
        <p className="mt-2 text-xs text-ink-soft">Así se ve con un cliente llamado Ana que compró $12.500.</p>
      </Tarjeta>

      {/* --- Los últimos mensajes --- */}
      <Tarjeta titulo="Últimos mensajes">
        {panel.ultimos.length === 0 ? (
          <p className="text-sm text-ink-soft">
            Todavía no hay ninguno. Se agenda uno cada vez que una venta captura un cliente que acepta.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Mensaje</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2 text-right">Intentos</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {panel.ultimos.map((j) => (
                  <tr key={j.id} className="border-t border-line align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{j.cliente ?? "Sin nombre"}</div>
                      <div className="fh-num text-xs text-ink-soft">{j.telefono}</div>
                    </td>
                    <td className="max-w-md px-3 py-2 text-ink-soft">
                      {j.mensaje}
                      {j.ultimoError ? <div className="mt-1 text-xs text-error">{j.ultimoError}</div> : null}
                    </td>
                    <td className="px-3 py-2">
                      <Chip tono={ESTADO_JOB_TONE[j.estado]}>{ESTADO_JOB_TEXT[j.estado]}</Chip>
                    </td>
                    <td className="fh-num px-3 py-2 text-right">{j.intentos}</td>
                    <td className="px-3 py-2 text-right">
                      {j.estado === "FAILED" ? (
                        <Boton onClick={() => void accion(`/whatsapp/jobs/${j.id}/reintentar`)}>Reintentar</Boton>
                      ) : j.estado === "PENDING" ? (
                        <Boton variante="fantasma" onClick={() => void accion(`/whatsapp/jobs/${j.id}/cancelar`)}>
                          Cancelar
                        </Boton>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Tarjeta>

      {/* --- 6.5: los clientes y sus bajas --- */}
      <Tarjeta titulo={`Clientes${dadosDeBaja > 0 ? ` — ${dadosDeBaja} dados de baja` : ""}`}>
        {clientes.length === 0 ? (
          <p className="text-sm text-ink-soft">
            Todavía ninguno. El cliente se captura al cobrar, y solo si él acepta.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-ink-soft">
                <tr>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Teléfono</th>
                  <th className="px-3 py-2">Mensajes</th>
                  <th className="px-3 py-2 text-right">Compras</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {clientes.map((c) => (
                  <tr key={c.id} className="border-t border-line">
                    <td className="px-3 py-2">{c.nombre ?? <span className="text-ink-soft">Sin nombre</span>}</td>
                    <td className="fh-num px-3 py-2">{c.telefono}</td>
                    <td className="px-3 py-2">
                      {c.baja ? (
                        <Chip tono="neutral">Pidió la baja</Chip>
                      ) : c.consiente ? (
                        <Chip tono="ok">Acepta</Chip>
                      ) : (
                        <Chip tono="neutral">No aceptó</Chip>
                      )}
                    </td>
                    <td className="fh-num px-3 py-2 text-right">{c.compras}</td>
                    <td className="px-3 py-2 text-right">
                      {c.baja ? null : (
                        <Boton variante="fantasma" onClick={() => setDandoDeBaja(c)}>
                          Dar de baja
                        </Boton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-ink-soft">
          La baja no se deshace desde acá. Volver a escribirle a alguien que la pidió requiere que él vuelva a aceptar
          en el mesón.
        </p>
      </Tarjeta>

      {editando && panel ? (
        <EditarPlantilla
          plantilla={panel.plantilla}
          variables={panel.variables}
          onCerrar={() => setEditando(false)}
          onGuardada={async (m) => {
            setEditando(false);
            setAviso(m);
            await cargar();
          }}
        />
      ) : null}

      {dandoDeBaja ? (
        <DarDeBaja
          cliente={dandoDeBaja}
          onCerrar={() => setDandoDeBaja(null)}
          onLista={async (m) => {
            setDandoDeBaja(null);
            setAviso(m);
            await cargar();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * El recuadro que dice qué hacer. Vive acá y no repetido en cada rama porque
 * lo que cambia entre estados es el texto, no la forma.
 */
function Nota({
  titulo,
  tono = "neutral",
  children,
}: {
  titulo: string;
  tono?: "neutral" | "warn" | "error";
  children: React.ReactNode;
}) {
  const borde =
    tono === "error" ? "border-error/30 bg-error/10" : tono === "warn" ? "border-warn/30 bg-warn/10" : "border-line bg-bg";
  return (
    <div className={`mt-3 rounded-[var(--fh-radio)] border p-3 text-sm text-ink-soft ${borde}`}>
      <p className="font-semibold text-ink">{titulo}</p>
      <p className="mt-1">{children}</p>
    </div>
  );
}

// ============================================================
// 6.4 — Editar la plantilla
// ============================================================

function EditarPlantilla({
  plantilla,
  variables,
  onCerrar,
  onGuardada,
}: {
  plantilla: string;
  variables: Record<string, string>;
  onCerrar: () => void;
  onGuardada: (mensaje: string) => void | Promise<void>;
}) {
  const [texto, setTexto] = useState(plantilla);
  const [ejemplo, setEjemplo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const r = await api<{ ejemplo: string }>("/whatsapp/plantilla", {
        method: "PUT",
        body: JSON.stringify({ plantilla: texto }),
      });
      setEjemplo(r.ejemplo);
      await onGuardada("Mensaje guardado. Las próximas ventas lo usan.");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo="El mensaje que se envía"
      bajada="Lo recibe el cliente unos minutos después de pagar."
      ancho="lg"
      onCerrar={onCerrar}
    >
      <div className="mt-4 grid gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">Texto</span>
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={4}
            className="w-full rounded-[var(--fh-radio)] border border-line bg-surface p-3 text-sm"
          />
        </label>

        <div className="rounded-[var(--fh-radio)] border border-line bg-bg p-3 text-sm">
          <div className="mb-1 text-xs uppercase tracking-wide text-ink-soft">Variables</div>
          <ul className="grid gap-1">
            {Object.entries(variables).map(([k, d]) => (
              <li key={k}>
                <code className="fh-num font-semibold">{`{${k}}`}</code>{" "}
                <span className="text-ink-soft">— {d}</span>
              </li>
            ))}
          </ul>
        </div>

        {ejemplo ? <p className="text-sm">Así queda: {ejemplo}</p> : null}
        {error ? (
          <div className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        ) : null}
      </div>

      <Acciones>
        <Boton variante="fantasma" onClick={onCerrar}>
          Cancelar
        </Boton>
        <Boton variante="principal" disabled={guardando} onClick={() => void guardar()}>
          Guardar
        </Boton>
      </Acciones>
    </Modal>
  );
}

// ============================================================
// 6.5 — La baja registrada a mano
// ============================================================

function DarDeBaja({
  cliente,
  onCerrar,
  onLista,
}: {
  cliente: Cliente;
  onCerrar: () => void;
  onLista: (mensaje: string) => void | Promise<void>;
}) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function confirmar() {
    setEnviando(true);
    setError(null);
    try {
      const r = await api<{ mensaje: string }>(`/whatsapp/clientes/${cliente.id}/baja`, {
        method: "POST",
        body: JSON.stringify({ motivo: motivo.trim() || undefined }),
      });
      await onLista(r.mensaje);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo registrar la baja");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal
      titulo={`Dar de baja a ${cliente.nombre ?? cliente.telefono}`}
      bajada="No se le vuelve a escribir nunca más, y esto no se deshace desde el sistema."
      onCerrar={onCerrar}
    >
      <div className="mt-4 grid gap-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">Motivo (queda en la bitácora)</span>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Lo pidió por teléfono"
            className="min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-3"
            autoFocus
          />
        </label>
        {error ? (
          <div className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">
            {error}
          </div>
        ) : null}
      </div>

      <Acciones>
        <Boton variante="fantasma" onClick={onCerrar}>
          Cancelar
        </Boton>
        <Boton variante="principal" disabled={enviando} onClick={() => void confirmar()}>
          Dar de baja
        </Boton>
      </Acciones>
    </Modal>
  );
}
