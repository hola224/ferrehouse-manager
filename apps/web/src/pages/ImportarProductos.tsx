/**
 * Importación de catálogo desde Excel (tarea 1.9, sin pantalla hasta ahora).
 *
 * **DOS PASOS SIEMPRE, Y EL PRIMERO NO ESCRIBE NADA.** El servidor ya trabaja
 * así: sube, informa, y solo escribe si se confirma y no hay ni una fila con
 * error. La pantalla no lo puede saltar, y el motivo es que el error caro de
 * una importación no es el que revienta —ese se ve— sino el que entra bien
 * formado y equivocado: 500 productos con el precio cargado en la unidad que
 * no era. Por eso el paso intermedio no muestra "480 filas OK" sino **cómo
 * quedó entendida cada fila**, con sus unidades escritas.
 *
 * Los errores se muestran TODOS, no los primeros diez: el administrador
 * arregla el Excel de una pasada, no de diez subidas.
 */
import { useRef, useState } from "react";
import { getToken } from "@/lib/api";
import { Acciones, Boton, Modal } from "@/components/ui";

type Informe = {
  total: number;
  validas: number;
  conError: number;
  errores: Array<{ fila: number; nombre: string; errores: string[] }>;
  interpretadas: Array<{ fila: number; dice: string }>;
  avisos: Array<{ fila: number; nombre: string; avisos: string[] }>;
  seCrearan: { categorias: string[]; marcas: string[]; proveedores: string[] };
  importado: boolean;
  mensaje: string;
  creados?: number;
  actualizados?: number;
};

async function subir(archivo: File, confirmar: boolean): Promise<Informe> {
  const cuerpo = new FormData();
  cuerpo.append("confirmar", String(confirmar));
  cuerpo.append("archivo", archivo);
  const r = await fetch("/api/import/products", {
    method: "POST",
    headers: { authorization: `Bearer ${getToken() ?? ""}` },
    body: cuerpo,
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error ?? "No se pudo leer el archivo");
  return json as Informe;
}

export function ImportarProductos({ onCerrar, onImportado }: { onCerrar: () => void; onImportado: () => void }) {
  const [archivo, setArchivo] = useState<File | null>(null);
  const [informe, setInforme] = useState<Informe | null>(null);
  const [trabajando, setTrabajando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  async function revisar(f: File) {
    setArchivo(f);
    setInforme(null);
    setError(null);
    setTrabajando(true);
    try {
      setInforme(await subir(f, false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo");
    } finally {
      setTrabajando(false);
    }
  }

  async function confirmar() {
    if (!archivo) return;
    setTrabajando(true);
    setError(null);
    try {
      const r = await subir(archivo, true);
      setInforme(r);
      if (r.importado) onImportado();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo importar");
    } finally {
      setTrabajando(false);
    }
  }

  const listo = informe && informe.conError === 0 && !informe.importado;
  const nuevos = informe?.seCrearan;
  const hayNuevos = nuevos && (nuevos.categorias.length || nuevos.marcas.length || nuevos.proveedores.length);

  return (
    <Modal
      titulo="Importar productos desde Excel"
      bajada="Se revisa primero y se escribe después. Si hay una sola fila con problemas, no entra ninguna."
      ancho="xl"
      onCerrar={onCerrar}
    >
      <div className="mt-4 grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={entrada}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void revisar(f);
            }}
          />
          <Boton variante="principal" onClick={() => entrada.current?.click()} disabled={trabajando}>
            {archivo ? "Elegir otro archivo" : "Elegir archivo .xlsx"}
          </Boton>
          {archivo ? <span className="text-sm text-ink-soft">{archivo.name}</span> : null}
          <a
            href="/api/import/products/template.xlsx"
            className="ml-auto text-sm underline underline-offset-4"
            /*
              La plantilla NO se puede bajar con un `href` a secas: la ruta
              exige rol de administrador y una descarga del navegador no manda
              la cabecera `authorization`, así que devolvería 401 y el usuario
              vería un archivo roto sin ninguna explicación. Se pide con
              `fetch`, que sí lleva el token, y el blob se guarda a mano.
            */
            onClick={(e) => {
              e.preventDefault();
              void fetch("/api/import/products/template.xlsx", {
                headers: { authorization: `Bearer ${getToken() ?? ""}` },
              })
                .then((r) => r.blob())
                .then((b) => {
                  const url = URL.createObjectURL(b);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "plantilla-productos.xlsx";
                  a.click();
                  URL.revokeObjectURL(url);
                });
            }}
          >
            Bajar la plantilla vacía
          </a>
        </div>

        {trabajando ? <p className="text-ink-soft">Leyendo el archivo…</p> : null}
        {error ? (
          <p className="rounded-[var(--fh-radio)] border border-error/30 bg-error/10 p-3 text-sm text-error">{error}</p>
        ) : null}

        {informe ? (
          <>
            <p
              className={`rounded-[var(--fh-radio)] border p-3 text-sm ${
                informe.importado
                  ? "border-ok/30 bg-ok/10 text-ok"
                  : informe.conError > 0
                    ? "border-error/30 bg-error/10 text-error"
                    : "border-line bg-bg text-ink"
              }`}
            >
              {informe.mensaje}
              {informe.importado ? ` ${informe.creados ?? 0} creados, ${informe.actualizados ?? 0} actualizados.` : ""}
            </p>

            {informe.conError > 0 ? (
              <section>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
                  Filas con problemas ({informe.conError})
                </h3>
                <ul className="max-h-56 overflow-y-auto rounded-[var(--fh-radio)] border border-line">
                  {informe.errores.map((e) => (
                    <li key={e.fila} className="border-b border-line/60 px-3 py-2 text-sm last:border-0">
                      <span className="fh-num text-ink-soft">Fila {e.fila}</span> · {e.nombre || "sin nombre"}
                      <ul className="mt-1 list-disc pl-5 text-error">
                        {e.errores.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {informe.avisos.length > 0 ? (
              <section>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
                  Avisos — no impiden importar, pero conviene mirarlos
                </h3>
                <ul className="max-h-40 overflow-y-auto rounded-[var(--fh-radio)] border border-warn/30 bg-warn/5">
                  {informe.avisos.map((a) => (
                    <li key={a.fila} className="border-b border-line/60 px-3 py-2 text-sm last:border-0">
                      <span className="fh-num text-ink-soft">Fila {a.fila}</span> · {a.nombre}
                      <ul className="mt-1 list-disc pl-5 text-warn">
                        {a.avisos.map((t) => (
                          <li key={t}>{t}</li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {informe.interpretadas.length > 0 && !informe.importado ? (
              <section>
                <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink-soft">
                  Cómo quedó entendida cada fila
                </h3>
                {/*
                  Esto es el corazón de la pantalla. "480 filas OK" no dice
                  nada; leer "1 saco de 25 kg, precio $6.490 por saco, costo
                  $196 por kg" es lo único que permite cachar el precio cargado
                  en la unidad equivocada, que ninguna validación puede atrapar.
                */}
                <ul className="max-h-64 overflow-y-auto rounded-[var(--fh-radio)] border border-line">
                  {informe.interpretadas.map((i) => (
                    <li key={i.fila} className="border-b border-line/60 px-3 py-2 text-sm last:border-0">
                      <span className="fh-num text-ink-soft">Fila {i.fila}</span> · {i.dice}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {hayNuevos && !informe.importado ? (
              <p className="text-sm text-ink-soft">
                Se van a crear solas:{" "}
                {[
                  nuevos!.categorias.length ? `${nuevos!.categorias.length} categorías` : null,
                  nuevos!.marcas.length ? `${nuevos!.marcas.length} marcas` : null,
                  nuevos!.proveedores.length ? `${nuevos!.proveedores.length} proveedores` : null,
                ]
                  .filter(Boolean)
                  .join(", ")}
                .
              </p>
            ) : null}
          </>
        ) : null}

        <Acciones>
          <Boton onClick={onCerrar}>{informe?.importado ? "Cerrar" : "Cancelar"}</Boton>
          {listo ? (
            <Boton variante="principal" onClick={confirmar} disabled={trabajando}>
              Importar {informe!.validas} productos
            </Boton>
          ) : null}
        </Acciones>
      </div>
    </Modal>
  );
}
