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
import { Boton, Chip, Tecla } from "@/components/ui";
import { useCascaron } from "@/components/cascarones";
import { useAtajos } from "@/lib/atajos";
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
  const enPos = useCascaron() === "pos";
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
      {/*
        El título va solo en el mesón: en el backoffice lo pone la barra del
        cascarón, y repetirlo debajo es ruido en la pantalla más densa que
        tiene el administrador.
      */}
      {enPos ? (
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-[28px] font-black tracking-[-0.02em]">Caja</h1>
          {actual.abierta ? (
            <span className="font-mono text-[11.5px] uppercase tracking-[0.06em] text-mono-ink">
              Turno abierto {formatHora(actual.sesion.openedAt)} · {usuario?.name}
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? <div className="border border-accent bg-accent-tint p-3 text-sm text-accent-ink">{error}</div> : null}
      {aviso ? <div className="border border-ok bg-ok/[0.08] p-3 text-sm text-ok-ink">{aviso}</div> : null}

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

  const ventas = actual.movimientos.filter((m) => m.type === "SALE").length;
  const suma = (t: CashMovementType) =>
    actual.movimientos.filter((m) => m.type === t).reduce((s, m) => s + (m.amount ?? 0), 0);
  const retiros = suma("WITHDRAWAL");
  const ingresos = suma("DEPOSIT");

  return (
    <>
      <div className="border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-ink px-[18px] py-[11px]">
          <Chip tono="ok">abierta</Chip>
          <span className="flex-1 text-sm text-ink-soft">
            desde las {desde} · {ventas === 0 ? "sin ventas todavía" : `${ventas} ${ventas === 1 ? "venta" : "ventas"} en el turno`}
          </span>
          <div className="flex shrink-0 gap-2">
            <Boton onClick={() => setPanel("retiro")} tecla="F4">
              Retiro
            </Boton>
            <Boton onClick={() => setPanel("ingreso")} tecla="F6">
              Ingreso
            </Boton>
            <Boton variante="principal" onClick={() => setPanel("cierre")} tecla="F2">
              Cerrar caja
            </Boton>
          </div>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-8 px-[18px] py-5">
          {/*
            El saldo esperado llega solo si el servidor decidió que corresponde.
            Para un vendedor es `null` —el arqueo es a ciegas— y entonces no hay
            hueco que rellenar: se dice por qué.
          */}
          {actual.saldo !== null ? (
            <div className="max-w-[420px]">
              <div className="fh-num text-5xl font-black tracking-[-0.03em]">{formatCLP(actual.saldo)}</div>
              <div className="text-sm text-ink-soft">debería haber en el cajón</div>
            </div>
          ) : (
            <p className="max-w-[420px] text-sm leading-[1.55] text-ink-soft">
              El sistema no muestra cuánto debería haber: al cerrar, cuentas primero y la diferencia aparece después.
              Así el conteo mide de verdad.
            </p>
          )}

          {/*
            Tres cifras, no cuatro. «Fondo inicial» solo aparece para quien ya
            puede ver el esperado: al vendedor el servidor no le manda la
            apertura a propósito, porque apertura + movimientos ES el esperado,
            y mostrarla convertiría el conteo ciego en un conteo con la
            respuesta al lado.
          */}
          <div className="flex gap-8">
            {actual.sesion.openingAmount !== undefined ? (
              <Cifra etiqueta="Fondo inicial" valor={formatCLP(actual.sesion.openingAmount)} />
            ) : null}
            <Cifra etiqueta="Retiros" valor={formatCLP(retiros)} tono={retiros > 0 ? "accent" : undefined} />
            <Cifra etiqueta="Ingresos" valor={formatCLP(ingresos)} tono={ingresos > 0 ? "ok" : undefined} />
          </div>
        </div>
      </div>

      {panel === "retiro" || panel === "ingreso" ? (
        <Movimiento tipo={panel} onCancelar={() => setPanel("nada")} onHecho={onHecho} onError={onError} />
      ) : null}

      <Libro movimientos={actual.movimientos} esAdmin={esAdmin} />

      <div className="flex h-[42px] items-center gap-4 text-[12.5px] text-ink-soft">
        {atajos.map((a) => (
          <span key={a.tecla} className="flex items-center gap-1.5">
            <Tecla>{a.etiqueta}</Tecla> {a.accion.toLowerCase()}
          </span>
        ))}
      </div>
    </>
  );
}

/** Una cifra del turno: etiqueta chica arriba, número grande abajo. */
function Cifra({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: "accent" | "ok" }) {
  return (
    <div>
      <div className="text-[10.5px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">{etiqueta}</div>
      <div
        className={`fh-num mt-1 text-[30px] font-black leading-none tracking-[-0.02em] ${
          tono === "accent" ? "text-accent-ink" : tono === "ok" ? "text-ok-ink" : ""
        }`}
      >
        {valor}
      </div>
    </div>
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
    <div className="overflow-x-auto border border-line bg-surface">
      <table className="w-full">
        <thead>
          <tr className="border-b-2 border-ink text-[10.5px] uppercase tracking-[0.11em] text-ink-soft">
            <th className="px-[14px] py-[9px] text-left font-extrabold">Hora</th>
            <th className="px-[14px] py-[9px] text-left font-extrabold">Movimiento</th>
            <th className="px-[14px] py-[9px] text-left font-extrabold">Motivo</th>
            <th className="px-[14px] py-[9px] text-left font-extrabold">Quién</th>
            <th className="px-[14px] py-[9px] text-right font-extrabold">Monto</th>
            {/* La columna de saldo solo existe si el servidor manda el dato. */}
            {esAdmin ? <th className="px-[14px] py-[9px] text-right font-extrabold">Saldo</th> : null}
          </tr>
        </thead>
        <tbody className="text-sm">
          {movimientos.map((m) => (
            <tr key={m.id} className="border-b border-line-soft last:border-0">
              <td className="fh-num px-[14px] py-[10px] font-mono text-[12.5px] text-mono-ink">
                {formatHora(m.createdAt)}
              </td>
              <td className="px-[14px] py-[10px] font-semibold">{CASH_MOVEMENT_TEXT[m.type] ?? m.type}</td>
              <td className="px-[14px] py-[10px] text-ink-soft">{m.description ?? "—"}</td>
              <td className="px-[14px] py-[10px] text-ink-soft">{m.user.name}</td>
              {/*
                La plata que SALE del cajón se lee distinto de la que entra. No
                basta el signo menos: en una columna de quince filas el guion se
                pierde, y confundir un retiro con un ingreso al revisar un
                descuadre es exactamente el error que este libro evita.
              */}
              <td
                className={`fh-num px-[14px] py-[10px] text-right font-semibold ${
                  m.amount === undefined ? "" : m.amount < 0 ? "text-accent-ink" : "text-ok-ink"
                }`}
              >
                {m.amount === undefined ? (
                  <span className="text-xs font-normal text-ink-soft">oculto</span>
                ) : (
                  formatCLP(m.amount)
                )}
              </td>
              {esAdmin ? (
                <td className="fh-num px-[14px] py-[10px] text-right text-ink-soft">
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

  /**
   * Las teclas del cierre.
   *
   * Los botones decían «F2» y «F4» desde el Sprint 2 y no las escuchaba nadie:
   * el listener de la pantalla de Caja se apaga en cuanto se entra al cierre
   * (`if (panel !== "nada") return`), y este componente no registraba ninguno.
   * O sea que el paso más delicado del día —el único con un punto de no
   * retorno— anunciaba dos atajos muertos. Se aprieta F2, no pasa nada, y a
   * partir de ahí el vendedor deja de creerle a la pantalla.
   */
  useAtajos(
    {
      F2:
        paso === 1
          ? contado !== ""
            ? () => setPaso(2)
            : undefined
          : paso === 2
            ? enviando
              ? undefined
              : () => void verDiferencia()
            : cierre
              ? () => void imprimirYSalir()
              : undefined,
      F4: paso === 2 ? () => setPaso(1) : undefined,
    },
    true,
  );

  /** El teclado en pantalla del conteo. Mismo motivo que en el login: guantes. */
  function tecla(t: string) {
    if (t === "C") setContado("");
    else if (t === "←") setContado((c) => c.slice(0, -1));
    else setContado((c) => (c.length >= 9 ? c : soloDigitos(c + t)));
    campo.current?.focus();
  }

  return (
    <div className="border border-line bg-surface">
      {/* El stepper: tres celdas iguales. Dice en cuál vas y cuántas faltan. */}
      <div className="grid grid-cols-3 border-b-2 border-ink">
        {[
          { n: 1, titulo: "Cuenta", bajada: "La plata del cajón" },
          { n: 2, titulo: "Confirma", bajada: "Antes de comprometerlo" },
          { n: 3, titulo: "Diferencia", bajada: "Lo que sobró o faltó" },
        ].map((s) => (
          <div
            key={s.n}
            className={`flex items-center gap-3 border-r border-line-soft px-[18px] py-3 last:border-r-0 ${
              paso === s.n ? "bg-accent-tint" : ""
            }`}
          >
            <span
              className={`fh-num grid h-[30px] w-[30px] shrink-0 place-items-center font-mono text-sm font-semibold ${
                paso === s.n
                  ? "bg-accent text-surface"
                  : paso > s.n
                    ? "bg-ink text-surface"
                    : "bg-line-soft text-ink-soft"
              }`}
            >
              {s.n}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-extrabold">{s.titulo}</span>
              <span className="block text-xs text-ink-soft">{s.bajada}</span>
            </span>
          </div>
        ))}
      </div>

      {error ? <div className="mx-6 mt-4 border border-accent bg-accent-tint p-3 text-sm text-accent-ink">{error}</div> : null}

      {/* --- Paso 1: contar. El sistema no muestra NADA todavía. --- */}
      {paso === 1 ? (
        <div className="p-6">
          <p className="text-xl font-extrabold">Cuenta toda la plata del cajón y escribe el total.</p>
          <input
            ref={campo}
            value={conPuntos(contado)}
            onChange={(e) => setContado(soloDigitos(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && contado !== "") setPaso(2);
            }}
            inputMode="numeric"
            placeholder="$0"
            className="fh-num mt-4 h-24 w-[420px] max-w-full border-2 border-ink bg-bg px-4 font-mono text-[52px] font-semibold"
          />
          <div className="mt-3 grid w-[420px] max-w-full grid-cols-3 gap-1.5">
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "←"].map((t) => (
              <button
                key={t}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => tecla(t)}
                className="h-14 border border-line-key bg-surface font-mono text-xl font-semibold hover:bg-bg"
              >
                {t}
              </button>
            ))}
          </div>
          <p className="mt-3 max-w-[560px] text-sm leading-[1.55] text-ink-soft">
            Sin puntos. El sistema no te muestra cuánto debería haber hasta que escribas tu conteo: así el número que
            anotas es el que contaste, no el que esperabas.
          </p>
          <div className="mt-6 flex gap-3">
            <Boton
              variante="principal"
              disabled={contado === ""}
              onClick={() => setPaso(2)}
              tecla="F2"
              className="h-[62px] px-6 text-lg"
            >
              Continuar
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
          <div className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink-soft">Contaste</div>
          <div className="fh-num text-[76px] font-black leading-none tracking-[-0.035em]">
            {formatCLP(Number(contado || 0))}
          </div>
          <div className="mt-6 max-w-[560px] border-l-4 border-accent bg-accent-tint px-4 py-3">
            <p className="font-bold">Este es el punto de no retorno.</p>
            <p className="mt-1 text-sm leading-[1.55]">
              Al continuar se cierra la caja, se compara con lo que el sistema esperaba y la diferencia queda
              registrada. Si tienes dudas, vuelve y cuenta otra vez.
            </p>
          </div>
          <div className="mt-6 flex gap-3">
            <Boton
              variante="principal"
              disabled={enviando}
              onClick={verDiferencia}
              tecla="F2"
              className="h-[62px] px-6 text-lg"
            >
              Ver diferencia
            </Boton>
            <Boton onClick={() => setPaso(1)} tecla="F4" className="h-[62px] px-6">
              Volver a contar
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
            <dl className="max-w-[560px]">
              <div className="flex justify-between py-1">
                <dt className="text-ink-soft">Debería haber</dt>
                <dd className="fh-num font-semibold">{formatCLP(cierre.esperado)}</dd>
              </div>
              <div className="flex justify-between py-1">
                <dt className="text-ink-soft">Contaste</dt>
                <dd className="fh-num font-semibold">{formatCLP(cierre.contado)}</dd>
              </div>
              <div className="mt-3 flex items-center justify-between border-t-2 border-ink pt-3">
                <dt className="text-[11px] font-extrabold uppercase tracking-[0.14em]">Diferencia</dt>
                <dd
                  className={`fh-num text-[52px] font-black leading-none tracking-[-0.03em] ${
                    cierre.estado.tono === "ok"
                      ? "text-ok-ink"
                      : cierre.estado.tono === "warn"
                        ? "text-warn-ink"
                        : "text-accent-ink"
                  }`}
                >
                  {formatCLP(cierre.diferencia)}
                </dd>
              </div>
            </dl>

            {/* Color Y palabra, siempre. En el papel del arqueo no hay color. */}
            <div className="mt-4">
              <Chip tono={cierre.estado.tono}>{cierre.estado.palabra}</Chip>
            </div>
            <p className="mt-3 max-w-[560px] text-[15px] leading-[1.55]">{cierre.estado.mensaje}</p>

            <label className="mt-5 block max-w-[560px]">
              <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
                Nota {cierre.estado.tono === "error" ? "" : "(opcional)"}
              </span>
              <input
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                placeholder="Qué pasó, si lo sabes"
                className="min-h-touch w-full border border-line-field bg-surface px-3.5"
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
              <Boton variante="principal" onClick={imprimirYSalir} tecla="F2">
                Imprimir el respaldo y terminar
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
