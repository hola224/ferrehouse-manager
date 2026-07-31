/**
 * Caja: el turno y el cierre en 3 pasos (tarea 2.8, UI-BRIEF §5.2).
 * Wireframe aprobado por Cristian el 2026-07-30.
 *
 * Lo que gobierna esta pantalla:
 *
 * - **El arqueo es a ciegas.** El vendedor cuenta y escribe ANTES de que
 *   aparezca nada. No es una regla de pantalla: el servidor tampoco le sirve el
 *   monto esperado, así que acá no hay nada que ocultar — simplemente no llega.
 *   Por eso el código no tiene ningún `if (esAdmin)` para esconder el saldo: si
 *   `saldo` es `null`, es que el servidor decidió que no corresponde.
 * - **Estados con color Y palabra.** En el papel del arqueo no hay color, y en
 *   el mesón hay daltonismo.
 * - **La franja diagonal solo en el descuadre grave**, y una sola por pantalla.
 *   La decide el servidor (`estado.franja`), no esta pantalla.
 * - **El botón principal cambia de texto si no cuadra.** Un botón que dice lo
 *   mismo pase lo que pase se aprieta sin leer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Boton, Chip } from "@/components/ui";
import { formatCLP, formatHora, atajosDe, CASH_MOVEMENT_TEXT, type CashMovementType } from "@ferrehouse/shared";

type Movimiento = {
  id: number;
  type: CashMovementType;
  amount?: number;
  balanceAfter?: number;
  description: string | null;
  createdAt: string;
  user: { id: number; name: string };
};

type Estado = { tono: "ok" | "warn" | "error"; palabra: string; mensaje: string; franja: boolean };

type Actual =
  | { abierta: false; sesion: null }
  | {
      abierta: true;
      /** `null` para el vendedor: el arqueo es a ciegas. */
      saldo: number | null;
      sesion: { id: number; openedAt: string; openingAmount?: number };
      movimientos: Movimiento[];
    };

type Cierre = { esperado: number; contado: number; diferencia: number; estado: Estado; sesion: { id: number } };

/** Solo dígitos, y se muestra con puntos de miles mientras se escribe. */
function soloDigitos(v: string): string {
  return v.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}
/** Con el peso adelante, como en el resto de la aplicación. */
function conPuntos(v: string): string {
  return v === "" ? "" : "$" + new Intl.NumberFormat("es-CL").format(Number(v));
}

export function Caja() {
  const { usuario } = useAuth();
  const [actual, setActual] = useState<Actual | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [panel, setPanel] = useState<"nada" | "retiro" | "ingreso" | "cierre">("nada");

  const cargar = useCallback(async () => {
    try {
      setActual(await api<Actual>("/cash/current"));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo consultar la caja");
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  // Los atajos se escuchan acá, en la pantalla, y no en cada botón: así la
  // tecla funciona aunque el foco esté en un campo de texto.
  useEffect(() => {
    const alTeclado = (e: KeyboardEvent) => {
      if (panel !== "nada" || !actual?.abierta) return;
      if (e.key === "F2") { e.preventDefault(); setPanel("cierre"); }
      if (e.key === "F4") { e.preventDefault(); setPanel("retiro"); }
      if (e.key === "F6") { e.preventDefault(); setPanel("ingreso"); }
    };
    window.addEventListener("keydown", alTeclado);
    return () => window.removeEventListener("keydown", alTeclado);
  }, [panel, actual]);

  if (!actual) return <p className="text-ink-soft">Cargando…</p>;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-black tracking-tight">Caja</h1>

      {error ? (
        <div className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div>
      ) : null}
      {aviso ? (
        <div className="rounded-[var(--fh-radio)] border border-ok/30 bg-ok/10 p-3 text-sm text-ok">{aviso}</div>
      ) : null}

      {!actual.abierta ? (
        <Apertura
          onAbierta={async (m) => {
            setAviso(m);
            await cargar();
          }}
          onError={setError}
        />
      ) : panel === "cierre" ? (
        <Cerrar
          sesionId={actual.sesion.id}
          onCancelar={() => setPanel("nada")}
          onCerrada={async (m) => {
            setPanel("nada");
            setAviso(m);
            await cargar();
          }}
        />
      ) : (
        <Turno
          actual={actual}
          esAdmin={usuario?.role === "ADMIN"}
          panel={panel}
          setPanel={setPanel}
          onError={setError}
          onHecho={async (m) => {
            setPanel("nada");
            setAviso(m);
            await cargar();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// Caja cerrada: abrirla
// ============================================================

function Apertura({ onAbierta, onError }: { onAbierta: (m: string) => void; onError: (e: string) => void }) {
  const [monto, setMonto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => campo.current?.focus(), []);

  async function abrir(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<{ mensaje: string }>("/cash/open", {
        method: "POST",
        body: JSON.stringify({ openingAmount: Number(monto || 0) }),
      });
      onAbierta(r.mensaje);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "No se pudo abrir la caja");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={abrir} className="rounded-[var(--fh-radio)] border border-line bg-surface p-6">
      <div className="mb-4 flex items-center gap-3">
        <Chip tono="neutral">cerrada</Chip>
        <span className="text-ink-soft">No hay ningún turno abierto en esta caja.</span>
      </div>

      <label className="block">
        <span className="mb-1 block font-medium">¿Con cuánto efectivo parte el turno?</span>
        <input
          ref={campo}
          value={conPuntos(monto)}
          onChange={(e) => setMonto(soloDigitos(e.target.value))}
          inputMode="numeric"
          placeholder="$0"
          className="fh-num min-h-touch w-64 rounded-[var(--fh-radio)] border border-line bg-bg px-4 text-3xl font-bold"
        />
      </label>
      <p className="mt-1 text-sm text-ink-soft">Cuenta el fondo del cajón y escribe el total, sin puntos.</p>

      <div className="mt-5">
        <Boton variante="principal" type="submit" disabled={enviando || monto === ""}>
          Abrir caja
        </Boton>
      </div>
    </form>
  );
}

// ============================================================
// Turno abierto
// ============================================================

function Turno({
  actual,
  esAdmin,
  panel,
  setPanel,
  onHecho,
  onError,
}: {
  actual: Extract<Actual, { abierta: true }>;
  esAdmin: boolean;
  panel: "nada" | "retiro" | "ingreso" | "cierre";
  setPanel: (p: "nada" | "retiro" | "ingreso" | "cierre") => void;
  onHecho: (m: string) => void;
  onError: (e: string) => void;
}) {
  const desde = formatHora(actual.sesion.openedAt);
  const atajos = atajosDe("caja");

  return (
    <>
      <div className="rounded-[var(--fh-radio)] border border-line bg-surface p-6">
        <div className="flex items-start justify-between gap-6">
          <div>
            <Chip tono="ok">abierta</Chip>
            <span className="ml-2 text-sm text-ink-soft">desde las {desde}</span>

            {/*
              El saldo llega solo si el servidor decidió que corresponde. Para
              un vendedor es `null` —el arqueo es a ciegas— y entonces no hay
              hueco que rellenar: se dice por qué.
            */}
            {actual.saldo !== null ? (
              <div className="mt-4">
                <div className="fh-num text-5xl font-black tracking-tight">{formatCLP(actual.saldo)}</div>
                <div className="text-sm text-ink-soft">debería haber en el cajón</div>
              </div>
            ) : (
              <div className="mt-4 max-w-md text-sm text-ink-soft">
                El sistema no muestra cuánto debería haber: al cerrar, cuentas primero y la diferencia aparece
                después. Así el conteo mide de verdad.
              </div>
            )}
          </div>

          <div className="flex shrink-0 gap-2">
            <Boton onClick={() => setPanel("retiro")}>
              Retiro <span className="fh-num opacity-70">F4</span>
            </Boton>
            <Boton onClick={() => setPanel("ingreso")}>
              Ingreso <span className="fh-num opacity-70">F6</span>
            </Boton>
            <Boton variante="principal" onClick={() => setPanel("cierre")}>
              Cerrar caja <span className="fh-num opacity-70">F2</span>
            </Boton>
          </div>
        </div>
      </div>

      {panel === "retiro" || panel === "ingreso" ? (
        <Movimiento tipo={panel} onCancelar={() => setPanel("nada")} onHecho={onHecho} onError={onError} />
      ) : null}

      <Libro movimientos={actual.movimientos} esAdmin={esAdmin} />

      <div className="flex gap-5 text-sm text-ink-soft">
        {atajos.map((a) => (
          <span key={a.tecla}>
            <span className="fh-num font-semibold text-ink">{a.etiqueta}</span> {a.accion.toLowerCase()}
          </span>
        ))}
      </div>
    </>
  );
}

function Movimiento({
  tipo,
  onCancelar,
  onHecho,
  onError,
}: {
  tipo: "retiro" | "ingreso";
  onCancelar: () => void;
  onHecho: (m: string) => void;
  onError: (e: string) => void;
}) {
  const [monto, setMonto] = useState("");
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  useEffect(() => campo.current?.focus(), []);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      const r = await api<{ mensaje: string }>("/cash/movements", {
        method: "POST",
        body: JSON.stringify({
          type: tipo === "retiro" ? "WITHDRAWAL" : "DEPOSIT",
          amount: Number(monto || 0),
          description: motivo,
        }),
      });
      onHecho(r.mensaje);
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "No se pudo registrar el movimiento");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="rounded-[var(--fh-radio)] border border-line bg-surface p-6">
      <h2 className="mb-4 text-lg font-bold">{tipo === "retiro" ? "Retirar efectivo" : "Ingresar efectivo"}</h2>
      <div className="flex flex-wrap gap-4">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-ink-soft">Cuánto</span>
          <input
            ref={campo}
            value={conPuntos(monto)}
            onChange={(e) => setMonto(soloDigitos(e.target.value))}
            inputMode="numeric"
            placeholder="$0"
            className="fh-num min-h-touch w-48 rounded-[var(--fh-radio)] border border-line bg-bg px-3 text-2xl font-bold"
          />
        </label>
        <label className="block flex-1">
          <span className="mb-1 block text-sm font-medium text-ink-soft">Motivo</span>
          <input
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            placeholder={tipo === "retiro" ? "Flete de la mañana" : "Vuelto que sobró"}
            className="min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-3"
          />
          {/* El motivo no es burocracia y el texto lo dice. */}
          <span className="mt-1 block text-xs text-ink-soft">
            Sin motivo, un retiro es indistinguible de plata que falta.
          </span>
        </label>
      </div>
      <div className="mt-5 flex gap-3">
        <Boton variante="principal" type="submit" disabled={enviando || monto === "" || motivo.trim().length < 3}>
          Registrar
        </Boton>
        <Boton type="button" variante="fantasma" onClick={onCancelar}>
          Cancelar
        </Boton>
      </div>
    </form>
  );
}

function Libro({ movimientos, esAdmin }: { movimientos: Movimiento[]; esAdmin: boolean }) {
  if (movimientos.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-[var(--fh-radio)] border border-line bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-xs uppercase tracking-wide text-ink-soft">
            <th className="px-3 py-2 text-left font-semibold">Hora</th>
            <th className="px-3 py-2 text-left font-semibold">Movimiento</th>
            <th className="px-3 py-2 text-left font-semibold">Motivo</th>
            <th className="px-3 py-2 text-left font-semibold">Quién</th>
            <th className="px-3 py-2 text-right font-semibold">Monto</th>
            {/* La columna de saldo solo existe si el servidor manda el dato. */}
            {esAdmin ? <th className="px-3 py-2 text-right font-semibold">Saldo</th> : null}
          </tr>
        </thead>
        <tbody>
          {movimientos.map((m) => (
            <tr key={m.id} className="border-b border-line/60 last:border-0">
              <td className="fh-num px-3 py-2 text-ink-soft">{formatHora(m.createdAt)}</td>
              <td className="px-3 py-2">{CASH_MOVEMENT_TEXT[m.type] ?? m.type}</td>
              <td className="px-3 py-2 text-ink-soft">{m.description ?? "—"}</td>
              <td className="px-3 py-2 text-ink-soft">{m.user.name}</td>
              <td className="fh-num px-3 py-2 text-right font-semibold">
                {m.amount === undefined ? <span className="text-xs font-normal text-ink-soft">oculto</span> : formatCLP(m.amount)}
              </td>
              {esAdmin ? (
                <td className="fh-num px-3 py-2 text-right text-ink-soft">
                  {m.balanceAfter === undefined ? "—" : formatCLP(m.balanceAfter)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// El cierre, en 3 pasos
// ============================================================

function Cerrar({
  sesionId,
  onCancelar,
  onCerrada,
}: {
  sesionId: number;
  onCancelar: () => void;
  onCerrada: (m: string) => void;
}) {
  const [paso, setPaso] = useState<1 | 2 | 3>(1);
  const [contado, setContado] = useState("");
  const [nota, setNota] = useState("");
  const [cierre, setCierre] = useState<Cierre | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (paso === 1) campo.current?.focus();
  }, [paso]);

  /** Paso 2 → 3: acá se compromete el conteo y recién ahí llega el esperado. */
  async function verDiferencia() {
    setEnviando(true);
    setError(null);
    try {
      const r = await api<Cierre>("/cash/close", {
        method: "POST",
        body: JSON.stringify({ countedAmount: Number(contado || 0), notes: nota || null }),
      });
      setCierre(r);
      setPaso(3);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cerrar la caja");
    } finally {
      setEnviando(false);
    }
  }

  /** El reporte sale sin preguntar: es el respaldo en papel del arqueo. */
  async function imprimirYSalir() {
    let mensaje = "Caja cerrada.";
    try {
      const r = await api<{ mensaje: string }>(`/cash/sessions/${sesionId}/report`, { method: "POST", body: "{}" });
      mensaje = `Caja cerrada. ${r.mensaje}`;
    } catch {
      // Que la impresora no esté configurada no invalida el cierre, que ya
      // está registrado. Se avisa y se sigue.
      mensaje = "Caja cerrada. No se pudo encolar el reporte: revisa la impresora de esta caja.";
    }
    onCerrada(mensaje);
  }

  return (
    <div className="rounded-[var(--fh-radio)] border border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-6 py-3">
        <h2 className="text-lg font-bold">Cerrar caja</h2>
        <span className="text-sm text-ink-soft">
          paso {paso} de 3 {["○", "○", "○"].map((_, i) => (i < paso ? "●" : "○")).join(" ")}
        </span>
      </div>

      {error ? <div className="mx-6 mt-4 rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</div> : null}

      {/* --- Paso 1: contar. El sistema no muestra NADA todavía. --- */}
      {paso === 1 ? (
        <div className="p-6">
          <p className="mb-1 font-medium">Cuenta toda la plata del cajón y escribe el total.</p>
          <input
            ref={campo}
            value={conPuntos(contado)}
            onChange={(e) => setContado(soloDigitos(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && contado !== "") setPaso(2);
            }}
            inputMode="numeric"
            placeholder="$0"
            className="fh-num mt-2 min-h-touch w-80 rounded-[var(--fh-radio)] border border-line bg-bg px-4 text-4xl font-black"
          />
          <p className="mt-2 text-sm text-ink-soft">
            Sin puntos. El sistema no te muestra cuánto debería haber hasta que escribas tu conteo: así el número
            que anotas es el que contaste, no el que esperabas.
          </p>
          <div className="mt-6 flex gap-3">
            <Boton variante="principal" disabled={contado === ""} onClick={() => setPaso(2)}>
              Continuar <span className="fh-num opacity-70">F2</span>
            </Boton>
            <Boton variante="fantasma" onClick={onCancelar}>
              Volver
            </Boton>
          </div>
        </div>
      ) : null}

      {/* --- Paso 2: confirmar antes de comprometerlo --- */}
      {paso === 2 ? (
        <div className="p-6">
          <div className="text-sm text-ink-soft">Contaste</div>
          <div className="fh-num text-5xl font-black tracking-tight">{formatCLP(Number(contado || 0))}</div>
          <p className="mt-4 max-w-lg text-sm text-ink-soft">
            ¿Está bien contado? <strong className="font-semibold text-ink">Este es el punto de no retorno</strong>:
            al continuar se cierra la caja, se compara con lo que el sistema esperaba y la diferencia queda
            registrada. Si tienes dudas, vuelve y cuenta otra vez.
          </p>
          <div className="mt-6 flex gap-3">
            <Boton variante="principal" disabled={enviando} onClick={verDiferencia}>
              Ver diferencia <span className="fh-num opacity-70">F2</span>
            </Boton>
            <Boton variante="fantasma" onClick={() => setPaso(1)}>
              Volver a contar <span className="fh-num opacity-70">F4</span>
            </Boton>
          </div>
        </div>
      ) : null}

      {/* --- Paso 3: el resultado --- */}
      {paso === 3 && cierre ? (
        <div>
          {/*
            La franja diagonal la decide el SERVIDOR (`estado.franja`), no esta
            pantalla, y solo aparece en el descuadre grave. Una por pantalla:
            si hubiera dos, ninguna se miraría.
          */}
          {cierre.estado.franja ? <div className="fh-franja h-3" aria-hidden /> : null}

          <div className="p-6">
            <dl className="max-w-lg">
              <div className="flex justify-between py-1">
                <dt className="text-ink-soft">Debería haber</dt>
                <dd className="fh-num font-semibold">{formatCLP(cierre.esperado)}</dd>
              </div>
              <div className="flex justify-between py-1">
                <dt className="text-ink-soft">Contaste</dt>
                <dd className="fh-num font-semibold">{formatCLP(cierre.contado)}</dd>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-line pt-3">
                <dt className="font-bold uppercase tracking-wide">Diferencia</dt>
                <dd className="fh-num text-4xl font-black">{formatCLP(cierre.diferencia)}</dd>
              </div>
            </dl>

            {/* Color Y palabra, siempre. En el papel del arqueo no hay color. */}
            <div className="mt-3">
              <Chip tono={cierre.estado.tono}>{cierre.estado.palabra}</Chip>
            </div>
            <p className="mt-3 max-w-lg text-sm">{cierre.estado.mensaje}</p>

            <label className="mt-5 block max-w-lg">
              <span className="mb-1 block text-sm font-medium text-ink-soft">
                Nota {cierre.estado.tono === "error" ? "" : "(opcional)"}
              </span>
              <input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Qué pasó, si lo sabes"
                className="min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-3"
              />
            </label>

            <div className="mt-6 flex gap-3">
              {/*
                La caja YA se cerró al revelar la diferencia: con conteo ciego no
                hay otra forma, porque mostrar el esperado es comprometer el
                conteo. Así que este botón imprime, no cierra — y el texto lo
                dice. Un botón que promete algo que ya pasó enseña a no leer.
                La advertencia de "revisa bien" está en el paso 2, que es donde
                todavía se podía volver atrás.
              */}
              <Boton variante="principal" onClick={imprimirYSalir}>
                Imprimir el respaldo y terminar <span className="fh-num opacity-70">F2</span>
              </Boton>
            </div>
            <p className="mt-2 max-w-lg text-xs text-ink-soft">
              La caja quedó cerrada y la diferencia registrada al ver este número.
              {cierre.estado.tono === "error" ? " El administrador ya tiene la alerta." : ""}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
