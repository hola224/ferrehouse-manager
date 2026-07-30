import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Tarjeta, Dato } from "@/components/ui";

type Panel = {
  rol: "ADMIN" | "SELLER";
  tienda: string;
  estacion: string;
  productos: number;
  usuarios?: number;
  unidades?: number;
  alertas?: number;
};

export function Dashboard() {
  const { usuario } = useAuth();
  const [panel, setPanel] = useState<Panel | null>(null);

  useEffect(() => {
    api<Panel>("/dashboard").then(setPanel).catch(() => setPanel(null));
  }, []);

  if (!panel) return <p className="text-ink-soft">Cargando…</p>;

  return (
    <div className="grid gap-4">
      {/*
        Acá va el estado de la caja, y NO antes del Sprint 2: hasta que exista
        `CashSession` el sistema no sabe si está abierta. Un chip verde escrito
        a mano afirma algo que nadie verificó, y es justo lo que el brief llama
        un estado confundible.
      */}
      <h1 className="text-2xl font-black tracking-tight">Hola, {usuario?.name}</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Tarjeta titulo="Estación">
          <Dato etiqueta="Estás trabajando en" valor={panel.estacion} />
        </Tarjeta>
        <Tarjeta titulo="Catálogo">
          <Dato etiqueta="Productos cargados" valor={panel.productos} />
        </Tarjeta>
        {panel.rol === "ADMIN" ? (
          <>
            <Tarjeta titulo="Equipo">
              <Dato etiqueta="Usuarios activos" valor={panel.usuarios ?? 0} />
            </Tarjeta>
            <Tarjeta titulo="Unidades de medida">
              <Dato etiqueta="Configuradas" valor={panel.unidades ?? 0} />
            </Tarjeta>
            <Tarjeta titulo="Alertas">
              <Dato etiqueta="Sin resolver" valor={panel.alertas ?? 0} />
            </Tarjeta>
          </>
        ) : null}
      </div>

      {panel.productos === 0 ? (
        <Tarjeta titulo="Todavía no hay nada que vender">
          <p className="text-sm text-ink-soft">
            {panel.rol === "ADMIN"
              ? "El catálogo llega en el Sprint 1: crear productos e importar desde Excel."
              : "Cuando el administrador cargue el catálogo, vas a poder buscar y vender desde acá."}
          </p>
        </Tarjeta>
      ) : null}
    </div>
  );
}
