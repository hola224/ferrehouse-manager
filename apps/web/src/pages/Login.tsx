/**
 * La entrada al sistema (ADR 007).
 *
 * Dos columnas a pantalla completa, sin barra: es la única pantalla donde la
 * marca es protagonista y no un logo en la esquina. A la izquierda el panel
 * rojo con el isotipo grande; a la derecha, lo único que hay que hacer.
 *
 * El teclado numérico en pantalla es nuevo y NO reemplaza al físico: el foco
 * se queda en el campo del PIN y se puede teclear igual. Existe porque en el
 * mesón hay tablets y hay dedos con guantes.
 */
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth, type Usuario } from "@/lib/auth";
import { Boton } from "@/components/ui";

type UsuarioLista = { id: number; name: string; role: string };
type Estacion = { id: number; name: string };

const TECLAS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "←"];

export function Login() {
  const { entrar } = useAuth();
  const [usuarios, setUsuarios] = useState<UsuarioLista[]>([]);
  const [estaciones, setEstaciones] = useState<Estacion[]>([]);
  const [userId, setUserId] = useState<number | null>(null);
  const [stationId, setStationId] = useState<number | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([
      api<{ usuarios: UsuarioLista[] }>("/auth/users"),
      api<{ estaciones: Estacion[] }>("/auth/stations"),
    ])
      .then(([u, e]) => {
        setUsuarios(u.usuarios);
        setEstaciones(e.estaciones);
        if (e.estaciones.length === 1) setStationId(e.estaciones[0]!.id);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "No se pudo conectar con el servidor"));
  }, []);

  // Elegido el usuario, el foco salta solo al PIN: se opera sin mouse.
  useEffect(() => {
    if (userId !== null) pinRef.current?.focus();
  }, [userId]);

  function tecla(t: string) {
    if (t === "C") setPin("");
    else if (t === "←") setPin((p) => p.slice(0, -1));
    else setPin((p) => (p.length >= 6 ? p : p + t));
    // El foco vuelve al campo: el teclado de pantalla es un atajo, no un modo.
    pinRef.current?.focus();
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (userId === null || stationId === null) return;
    setEnviando(true);
    setError(null);
    try {
      const r = await api<{ token: string; usuario: Usuario }>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ userId, pin, stationId }),
      });
      entrar(r.token, r.usuario);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar con el servidor");
      setPin("");
      pinRef.current?.focus();
    } finally {
      setEnviando(false);
    }
  }

  const caja = estaciones.find((e) => e.id === stationId)?.name;

  return (
    <div className="flex h-screen">
      {/* ---------------- Izquierda: la marca ---------------- */}
      <div className="hidden w-[560px] shrink-0 flex-col justify-between bg-accent px-[52px] py-14 text-surface lg:flex">
        <div>
          <img src="/brand/isotipo-blanco.svg" alt="" width={132} height={132} />
          <p className="mt-8 text-[15px] font-extrabold tracking-[0.22em] opacity-85">FERRETERÍA HOUSE</p>
          <h1 className="mt-3 text-[58px] font-black leading-[0.95] tracking-[-0.03em]">
            Ferrehouse
            <br />
            Manager
          </h1>
          <div aria-hidden className="mt-7 h-1 w-[72px] bg-surface" />
          <p className="mt-7 max-w-[340px] text-base leading-[1.5]">
            Punto de venta, inventario y caja. Corre en la tienda, sin internet.
          </p>
        </div>
        {/*
          La dirección del servidor no es adorno: cuando un terminal «no entra»,
          lo primero que hay que saber es a qué máquina le está preguntando.
          Acá se lee sin abrir nada.
        */}
        <p className="font-mono text-[11.5px] opacity-80">
          {window.location.host}
          {caja ? ` · ${caja}` : ""}
        </p>
      </div>

      {/* ---------------- Derecha: entrar ---------------- */}
      <div className="flex min-w-0 flex-1 justify-center overflow-y-auto bg-surface px-[60px] py-14">
        <form onSubmit={enviar} className="w-full max-w-[520px]">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.14em] text-ink-soft">Entrar al sistema</p>
          <h2 className="mt-1 text-[34px] font-black tracking-[-0.02em]">¿Quién eres?</h2>

          <fieldset className="mt-6">
            <legend className="sr-only">¿Quién eres?</legend>
            <div className="grid gap-2">
              {usuarios.map((u) => {
                const elegido = userId === u.id;
                return (
                  <button
                    type="button"
                    key={u.id}
                    onClick={() => setUserId(u.id)}
                    aria-pressed={elegido}
                    className={`flex h-[60px] items-center gap-3 border-2 px-4 text-left ${
                      elegido ? "border-ink bg-bg" : "border-line-idle bg-surface hover:bg-bg"
                    }`}
                  >
                    <span
                      aria-hidden
                      className={`grid h-[34px] w-[34px] shrink-0 place-items-center text-base font-black ${
                        elegido ? "bg-accent text-surface" : "bg-line-soft text-ink-soft"
                      }`}
                    >
                      {u.name.trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="flex-1 text-lg font-bold">{u.name}</span>
                    <span className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
                      {u.role === "ADMIN" ? "administrador" : "vendedor"}
                    </span>
                  </button>
                );
              })}
              {usuarios.length === 0 && !error ? <p className="text-sm text-ink-soft">Cargando…</p> : null}
            </div>
          </fieldset>

          {/* Con una sola caja no se pregunta: se elige sola y no aparece. */}
          {estaciones.length > 1 ? (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
                Caja
              </span>
              <select
                className="h-12 w-full border border-line-field bg-surface px-3.5 text-ink"
                value={stationId ?? ""}
                onChange={(e) => setStationId(Number(e.target.value))}
              >
                <option value="" disabled>
                  Elige la caja
                </option>
                {estaciones.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="mt-5">
            <span className="mb-1.5 block text-[11px] font-extrabold uppercase tracking-[0.12em] text-ink-soft">
              PIN
            </span>
            <div className="relative">
              <input
                ref={pinRef}
                type="password"
                inputMode="numeric"
                autoComplete="off"
                aria-label="PIN"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                className="fh-num h-[66px] w-full border-2 border-ink bg-bg px-4 text-center font-mono text-[34px] font-semibold tracking-[0.38em]"
              />
              {/* Cuatro rayas cuando está vacío: dicen cuántos dígitos van, que
                  es la pregunta que se hace quien nunca lo ha usado. */}
              {pin === "" ? (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 grid place-items-center font-mono text-[34px] font-semibold tracking-[0.38em] text-ink-soft/50"
                >
                  ____
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 justify-center gap-1.5">
            {TECLAS.map((t) => (
              <button
                key={t}
                type="button"
                /* `preventDefault` en mousedown: sin esto el botón se lleva el
                   foco y el siguiente dígito tecleado a mano no llega al campo.
                   El teclado de pantalla no puede apagar el teclado físico. */
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => tecla(t)}
                className="h-14 border border-line-key bg-surface font-mono text-xl font-semibold hover:bg-bg"
              >
                {t}
              </button>
            ))}
          </div>

          {error ? (
            <p role="alert" className="mt-4 border border-accent bg-accent-tint p-3 text-sm text-accent-ink">
              {error}
            </p>
          ) : null}

          <Boton
            type="submit"
            variante="principal"
            tecla="ENTER"
            className="mt-4 h-16 w-full text-lg"
            disabled={enviando || userId === null || stationId === null || pin.length < 4}
          >
            {enviando ? "Entrando…" : "Entrar"}
          </Boton>
        </form>
      </div>
    </div>
  );
}
