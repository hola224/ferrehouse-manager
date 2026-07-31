/**
 * Aviso entre pestañas cuando se crea algo del catálogo (2026-07-31).
 *
 * Existe por una pregunta concreta del dueño: «el proveedor se crea en una
 * pestaña nueva… ¿es posible hacer el refresco en la pestaña paralela y que
 * aparezca el proveedor creado?». Sí, y así.
 *
 * `BroadcastChannel` habla entre pestañas del MISMO origen sin pasar por el
 * servidor y sin que ninguna tenga que preguntar cada cierto rato. Las otras
 * dos formas de hacerlo son peores acá: `window.opener` obliga a que la
 * pestaña haya sido abierta por la otra —y se rompe si el dueño la abre a
 * mano o recarga—, y sondear cada N segundos gasta consultas para nada
 * durante todo el rato en que no se crea ningún proveedor.
 *
 * Si el navegador no lo soporta, no se rompe nada: la pestaña del producto
 * simplemente no se entera sola, y el botón «Actualizar» sigue ahí.
 */
import { useEffect, useRef } from "react";

export type CatalogoCreado = {
  tipo: "categoria" | "marca" | "proveedor";
  id: number;
  name: string;
};

const CANAL = "ferrehouse.catalogos";

/** Lo llama quien acaba de crear. Silencioso si el navegador no tiene el canal. */
export function avisarCreado(mensaje: CatalogoCreado): void {
  try {
    const canal = new BroadcastChannel(CANAL);
    canal.postMessage(mensaje);
    canal.close();
  } catch {
    // Sin BroadcastChannel no hay aviso, y eso es todo: nadie queda a medias.
  }
}

/** Lo escucha quien tiene un selector que podría quedar desactualizado. */
export function useCatalogoCreado(alCrear: (mensaje: CatalogoCreado) => void): void {
  // El callback se guarda en una ref para no abrir y cerrar el canal en cada
  // render: suscribirse de nuevo cada vez perdería mensajes en el intermedio.
  const ref = useRef(alCrear);
  useEffect(() => {
    ref.current = alCrear;
  });

  useEffect(() => {
    let canal: BroadcastChannel;
    try {
      canal = new BroadcastChannel(CANAL);
    } catch {
      return;
    }
    const escuchar = (e: MessageEvent<CatalogoCreado>) => ref.current(e.data);
    canal.addEventListener("message", escuchar);
    return () => {
      canal.removeEventListener("message", escuchar);
      canal.close();
    };
  }, []);
}
