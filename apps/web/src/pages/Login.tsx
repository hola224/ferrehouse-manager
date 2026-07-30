import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth, type Usuario } from "@/lib/auth";
import { Boton, Campo } from "@/components/ui";

type UsuarioLista = { id: number; name: string; role: string };
type Estacion = { id: number; name: string };

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

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <form onSubmit={enviar} className="w-full max-w-md rounded-[var(--fh-radio)] border border-line bg-surface p-6">
        <h1 className="text-3xl font-black tracking-tight">Ferrehouse</h1>
        <p className="mb-6 text-sm text-ink-soft">Elige tu nombre y digita tu PIN</p>

        <fieldset className="mb-4">
          <legend className="mb-2 text-sm font-medium text-ink-soft">¿Quién eres?</legend>
          <div className="grid gap-2">
            {usuarios.map((u) => (
              <button
                type="button"
                key={u.id}
                onClick={() => setUserId(u.id)}
                aria-pressed={userId === u.id}
                className={`min-h-touch rounded-[var(--fh-radio)] border px-4 text-left font-semibold ${
                  userId === u.id ? "border-ink bg-bg" : "border-line bg-surface"
                }`}
              >
                {u.name}
                <span className="ml-2 text-xs font-normal text-ink-soft">
                  {u.role === "ADMIN" ? "administrador" : "vendedor"}
                </span>
              </button>
            ))}
            {usuarios.length === 0 && !error ? <p className="text-sm text-ink-soft">Cargando…</p> : null}
          </div>
        </fieldset>

        {estaciones.length > 1 ? (
          <label className="mb-4 block">
            <span className="mb-1 block text-sm font-medium text-ink-soft">Caja</span>
            <select
              className="min-h-touch w-full rounded-[var(--fh-radio)] border border-line bg-surface px-3"
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

        <Campo
          ref={pinRef}
          etiqueta="PIN"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          className="fh-num text-center text-2xl tracking-[0.4em]"
          hint="4 a 6 dígitos"
        />

        {error ? (
          <p role="alert" className="mt-3 rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">
            {error}
          </p>
        ) : null}

        <Boton
          type="submit"
          variante="principal"
          className="mt-5 w-full text-lg"
          disabled={enviando || userId === null || stationId === null || pin.length < 4}
        >
          {enviando ? "Entrando…" : "Entrar"}
        </Boton>
      </form>
    </div>
  );
}
