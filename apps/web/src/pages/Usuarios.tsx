/**
 * Usuarios (tarea 1.8, sin pantalla hasta ahora). Solo el administrador.
 *
 * **Un usuario no se borra: se desactiva.** Sus ventas, sus movimientos de
 * stock y su bitácora lo referencian, y esas tablas son inmutables — borrar la
 * fila dejaría el libro apuntando al vacío. La pantalla dice eso en vez de
 * ofrecer un botón de borrar que el servidor va a rechazar.
 *
 * **El PIN no se muestra nunca, ni al administrador.** Solo se cambia, y el
 * nuevo se escribe dos veces: un PIN mal tecleado deja a alguien fuera del
 * sistema en pleno mesón, y no hay forma de recuperarlo mirando la base porque
 * se guarda con hash.
 *
 * `SYSTEM` no aparece: es quien firma lo que hacen los procesos automáticos y
 * no se edita desde ninguna parte.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Acciones, Boton, Campo, Chip, Modal, Selector } from "@/components/ui";

type Usuario = { id: number; name: string; role: "ADMIN" | "SELLER" | "SYSTEM"; active: boolean; createdAt: string };

export function Usuarios() {
  const { usuario: yo } = useAuth();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [cambiandoPin, setCambiandoPin] = useState<Usuario | null>(null);
  const [editando, setEditando] = useState<Usuario | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      setUsuarios((await api<{ usuarios: Usuario[] }>("/users")).usuarios);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudieron cargar los usuarios");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function alternar(u: Usuario) {
    setError(null);
    try {
      await api(`/users/${u.id}/${u.active ? "deactivate" : "activate"}`, { method: "POST", body: "{}" });
      setAviso(u.active ? `${u.name} ya no puede entrar. Su historial queda intacto.` : `${u.name} puede entrar de nuevo.`);
      await cargar();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cambiar el estado");
    }
  }

  const visibles = usuarios.filter((u) => u.role !== "SYSTEM");

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-black tracking-tight">Usuarios</h1>
        <div className="flex items-center gap-4">
          {/*
            La otra mitad de la misma pregunta: quién entra y desde dónde. La
            pantalla de entrada pide las dos cosas, así que se administran una
            al lado de la otra en vez de darle pestaña propia a algo que se
            toca al instalar y casi nunca más.
          */}
          <Link to="/estaciones" className="text-sm underline underline-offset-4">
            Cajas y terminales
          </Link>
          <Boton variante="principal" onClick={() => setNuevo(true)}>
            + Usuario nuevo
          </Boton>
        </div>
      </div>

      {error ? (
        <p className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</p>
      ) : null}
      {aviso ? (
        <div className="flex items-center justify-between rounded-[var(--fh-radio)] border border-ok/30 bg-ok/10 p-3 text-sm text-ok">
          {aviso}
          <button onClick={() => setAviso(null)} aria-label="Cerrar aviso" className="px-2">
            ×
          </button>
        </div>
      ) : null}

      {cargando ? (
        <p className="text-ink-soft">Cargando…</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-ink-soft">
            <tr className="border-b border-line">
              <th className="pb-2">Nombre</th>
              <th className="pb-2">Rol</th>
              <th className="pb-2">Estado</th>
              <th className="pb-2 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((u) => (
              <tr key={u.id} className="border-b border-line/60">
                <td className="py-3 font-medium">
                  {u.name}
                  {u.id === yo?.sub ? <span className="ml-2 text-xs text-ink-soft">— eres tú</span> : null}
                </td>
                <td className="py-3">{u.role === "ADMIN" ? "Administrador" : "Vendedor"}</td>
                <td className="py-3">
                  <Chip tono={u.active ? "ok" : "neutral"}>{u.active ? "Activo" : "Desactivado"}</Chip>
                </td>
                <td className="py-3 text-right">
                  <button onClick={() => setEditando(u)} className="mr-4 text-sm underline underline-offset-4">
                    Editar
                  </button>
                  <button onClick={() => setCambiandoPin(u)} className="mr-4 text-sm underline underline-offset-4">
                    Cambiar PIN
                  </button>
                  {/*
                    Uno no se puede desactivar a sí mismo: quedaría la tienda
                    sin nadie que pueda entrar como administrador, y no hay
                    forma de arreglarlo desde la aplicación.
                  */}
                  <button
                    onClick={() => alternar(u)}
                    disabled={u.id === yo?.sub}
                    className="text-sm underline underline-offset-4 disabled:opacity-40"
                    title={u.id === yo?.sub ? "No puedes desactivarte a ti mismo" : undefined}
                  >
                    {u.active ? "Desactivar" : "Reactivar"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="text-xs text-ink-soft">
        Un usuario nunca se borra: se desactiva. Sus ventas y sus movimientos de stock lo siguen nombrando, y esas
        tablas no se tocan.
      </p>

      {nuevo ? (
        <UsuarioNuevo
          onCerrar={() => setNuevo(false)}
          onCreado={(n) => {
            setNuevo(false);
            setAviso(`${n} ya puede entrar con su PIN.`);
            void cargar();
          }}
        />
      ) : null}


      {editando ? (
        <EditarUsuario
          usuario={editando}
          esYo={editando.id === yo?.sub}
          onCerrar={() => setEditando(null)}
          onGuardado={(n) => {
            setEditando(null);
            setAviso(`Ahora se llama ${n}.`);
            void cargar();
          }}
        />
      ) : null}
      {cambiandoPin ? (
        <CambiarPin
          usuario={cambiandoPin}
          onCerrar={() => setCambiandoPin(null)}
          onListo={() => {
            setAviso(`PIN de ${cambiandoPin.name} cambiado.`);
            setCambiandoPin(null);
          }}
        />
      ) : null}
    </div>
  );
}

/** El PIN va como contraseña y se escribe dos veces: no hay cómo recuperarlo. */
function CamposDePin({
  pin,
  repetir,
  setPin,
  setRepetir,
  primero,
}: {
  pin: string;
  repetir: string;
  setPin: (v: string) => void;
  setRepetir: (v: string) => void;
  primero?: React.RefObject<HTMLInputElement>;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Campo
        ref={primero}
        etiqueta="PIN"
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
        hint="Entre 4 y 6 dígitos"
      />
      <Campo
        etiqueta="Repetir PIN"
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        value={repetir}
        onChange={(e) => setRepetir(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
    </div>
  );
}

function UsuarioNuevo({ onCerrar, onCreado }: { onCerrar: () => void; onCreado: (nombre: string) => void }) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<"SELLER" | "ADMIN">("SELLER");
  const [pin, setPin] = useState("");
  const [repetir, setRepetir] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const primero = useRef<HTMLInputElement>(null);

  useEffect(() => {
    primero.current?.focus();
  }, []);

  async function guardar() {
    setError(null);
    if (name.trim().length < 2) return setError("El nombre necesita al menos 2 caracteres");
    if (pin.length < 4) return setError("El PIN va de 4 a 6 dígitos");
    if (pin !== repetir) return setError("Los dos PIN no son iguales. Escríbelo de nuevo con calma.");
    setGuardando(true);
    try {
      await api("/users", { method: "POST", body: JSON.stringify({ name: name.trim(), role, pin }) });
      onCreado(name.trim());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo crear el usuario");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Usuario nuevo" bajada="Entra con su nombre y su PIN, eligiendo la caja donde trabaja." onCerrar={onCerrar}>
      <div className="mt-4 grid gap-3">
        <Campo ref={primero} etiqueta="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
        <Selector etiqueta="Rol" value={role} onChange={(e) => setRole(e.target.value as "SELLER" | "ADMIN")}>
          <option value="SELLER">Vendedor — vende, cobra y consulta precios</option>
          <option value="ADMIN">Administrador — además ve costos, márgenes y reportes</option>
        </Selector>
        <CamposDePin pin={pin} repetir={repetir} setPin={setPin} setRepetir={setRepetir} />
        {error ? (
          <p className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</p>
        ) : null}
        <Acciones>
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton variante="principal" onClick={guardar} disabled={guardando}>
            {guardando ? "Creando…" : "Crear usuario"}
          </Boton>
        </Acciones>
      </div>
    </Modal>
  );
}

function CambiarPin({ usuario, onCerrar, onListo }: { usuario: Usuario; onCerrar: () => void; onListo: () => void }) {
  const [pin, setPin] = useState("");
  const [repetir, setRepetir] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const primero = useRef<HTMLInputElement>(null);

  useEffect(() => {
    primero.current?.focus();
  }, []);

  async function guardar() {
    setError(null);
    if (pin.length < 4) return setError("El PIN va de 4 a 6 dígitos");
    if (pin !== repetir) return setError("Los dos PIN no son iguales. Escríbelo de nuevo con calma.");
    setGuardando(true);
    try {
      await api(`/users/${usuario.id}/pin`, { method: "POST", body: JSON.stringify({ pin }) });
      onListo();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo cambiar el PIN");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={`Cambiar el PIN de ${usuario.name}`}
      bajada="El PIN actual no se puede ver: se guarda con hash. Solo se reemplaza."
      onCerrar={onCerrar}
    >
      <div className="mt-4 grid gap-3">
        <CamposDePin pin={pin} repetir={repetir} setPin={setPin} setRepetir={setRepetir} primero={primero} />
        {error ? (
          <p className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</p>
        ) : null}
        <Acciones>
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton variante="principal" onClick={guardar} disabled={guardando}>
            {guardando ? "Cambiando…" : "Cambiar PIN"}
          </Boton>
        </Acciones>
      </div>
    </Modal>
  );
}

/**
 * Renombrar y cambiar el rol.
 *
 * El seed deja «Administrador» y «Vendedor», que es lo correcto para una
 * tienda que el instalador todavía no conoce, pero nadie quiere ver
 * «Administrador» firmando sus ventas para siempre. El endpoint existía desde
 * el Sprint 0 y no había pantalla que lo llamara.
 *
 * El nombre no es cosmético: es lo que sale en el reporte de cierre de caja,
 * en el kardex y en la bitácora. Cambiarlo NO reescribe el pasado —esas tablas
 * guardan el id, no el texto—, así que una venta de ayer pasa a mostrarse con
 * el nombre nuevo. Es lo que se quiere: es la misma persona.
 */
function EditarUsuario({
  usuario,
  esYo,
  onCerrar,
  onGuardado,
}: {
  usuario: Usuario;
  esYo: boolean;
  onCerrar: () => void;
  onGuardado: (nombre: string) => void;
}) {
  const [name, setName] = useState(usuario.name);
  const [role, setRole] = useState<"ADMIN" | "SELLER">(usuario.role === "ADMIN" ? "ADMIN" : "SELLER");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const primero = useRef<HTMLInputElement>(null);

  useEffect(() => primero.current?.focus(), []);

  async function guardar(): Promise<void> {
    const limpio = name.trim();
    if (limpio.length < 2) return setError("El nombre necesita al menos 2 caracteres");
    setGuardando(true);
    setError(null);
    try {
      await api(`/users/${usuario.id}`, { method: "PATCH", body: JSON.stringify({ name: limpio, role }) });
      onGuardado(limpio);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Modal
      titulo={`Editar a ${usuario.name}`}
      bajada="El nombre es el que sale en el cierre de caja, en el kardex y en la bitácora."
      onCerrar={onCerrar}
    >
      <div className="mt-4 grid gap-3">
        <Campo
          ref={primero}
          etiqueta="Nombre"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void guardar();
          }}
        />
        <Selector etiqueta="Rol" value={role} onChange={(e) => setRole(e.target.value as "ADMIN" | "SELLER")}>
          <option value="SELLER">Vendedor</option>
          <option value="ADMIN">Administrador</option>
        </Selector>
        {/*
          Bajarse a uno mismo a vendedor es la forma más rápida de dejar la
          tienda sin administrador. El servidor ya se niega si es el último
          —comprueba contra los admin ACTIVOS—, pero avisar antes evita que el
          dueño descubra el problema apretando Guardar.
        */}
        {esYo && usuario.role === "ADMIN" && role === "SELLER" ? (
          <p className="rounded-[var(--fh-radio)] border border-warn/30 bg-warn/10 p-3 text-sm">
            Te estás bajando a vendedor. Si eres el único administrador, el servidor no lo va a permitir — y si hay
            otro, dejarás de poder entrar a estas pantallas.
          </p>
        ) : null}
        {error ? (
          <p className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</p>
        ) : null}
        <Acciones>
          <Boton onClick={onCerrar}>Cancelar</Boton>
          <Boton variante="principal" onClick={() => void guardar()} disabled={guardando}>
            {guardando ? "Guardando…" : "Guardar"}
          </Boton>
        </Acciones>
      </div>
    </Modal>
  );
}
