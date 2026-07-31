/**
 * Crear un proveedor, en su propia pestaña (2026-07-31).
 *
 * POR QUÉ EN UNA PESTAÑA Y NO EN UN DIÁLOGO, que es lo que pide el resto de
 * esta aplicación: un proveedor tiene RUT, teléfono, correo y notas. Metido
 * como un campo más dentro del formulario de producto, obliga a interrumpir
 * un producto a medio escribir para ir a buscar el RUT en una factura. En
 * pestaña aparte, el producto queda intacto esperando, y el dueño puede
 * tomarse el rato que necesite.
 *
 * La categoría y la marca, en cambio, son solo un nombre y se crean en línea
 * en el mismo formulario: abrir una pestaña para escribir «Fijaciones» sería
 * más ceremonia que trabajo. La asimetría es a propósito.
 *
 * Al guardar avisa por `BroadcastChannel` y la pestaña del producto se
 * actualiza sola y lo deja elegido — ver lib/catalogos.ts.
 */
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { Boton, Campo, Tarjeta } from "@/components/ui";
import { avisarCreado } from "@/lib/catalogos";

export function ProveedorNuevo() {
  const [name, setName] = useState("");
  const [rut, setRut] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creado, setCreado] = useState<{ id: number; name: string } | null>(null);

  async function guardar(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError(null);
    setGuardando(true);
    try {
      const r = await api<{ proveedor: { id: number; name: string } }>("/catalog/suppliers", {
        method: "POST",
        // Los opcionales van como null y no como "": el esquema del servidor
        // valida el RUT y el correo cuando vienen, y una cadena vacía sería
        // un RUT inválido en vez de un RUT ausente.
        body: JSON.stringify({
          name: name.trim(),
          rut: rut.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      avisarCreado({ tipo: "proveedor", id: r.proveedor.id, name: r.proveedor.name });
      setCreado(r.proveedor);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el proveedor");
    } finally {
      setGuardando(false);
    }
  }

  if (creado) {
    return (
      <div className="mx-auto max-w-lg">
        <Tarjeta titulo="Proveedor creado">
          <p className="text-sm">
            <strong>{creado.name}</strong> ya está guardado y quedó elegido en la pestaña del producto. Puedes cerrar
            esta.
          </p>
          <div className="mt-4 flex gap-2">
            {/*
              `window.close()` solo funciona si el navegador abrió la pestaña
              por script, que es el caso cuando se llegó desde el botón. Si el
              dueño escribió la dirección a mano no pasa nada, y por eso el
              texto de arriba ya dice que puede cerrarla él.
            */}
            <Boton variante="principal" onClick={() => window.close()}>
              Cerrar esta pestaña
            </Boton>
            <Boton
              onClick={() => {
                setCreado(null);
                setName("");
                setRut("");
                setPhone("");
                setEmail("");
                setNotes("");
              }}
            >
              Crear otro
            </Boton>
          </div>
        </Tarjeta>
      </div>
    );
  }

  return (
    <form className="mx-auto grid max-w-lg gap-4" onSubmit={(e) => void guardar(e)}>
      <h1 className="text-2xl font-black tracking-tight">Proveedor nuevo</h1>

      <Campo
        etiqueta="Nombre"
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        required
        hint="Como lo dice la factura"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="RUT" value={rut} onChange={(e) => setRut(e.target.value)} hint="12345678-9, sin puntos" />
        <Campo etiqueta="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </div>
      <Campo etiqueta="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-ink-soft">Notas</span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Días de despacho, pedido mínimo, forma de pago…"
          className="w-full rounded-[var(--fh-radio)] border border-line bg-surface p-3 text-sm"
        />
      </label>

      {error ? (
        <p className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</p>
      ) : null}

      <div className="flex gap-2">
        <Boton type="submit" variante="principal" disabled={guardando || !name.trim()}>
          {guardando ? "Guardando…" : "Guardar proveedor"}
        </Boton>
      </div>
    </form>
  );
}
