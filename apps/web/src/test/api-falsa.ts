/**
 * Un servidor de mentira para los tests de pantalla.
 *
 * Los tests de pantalla NO levantan el servidor: eso ya está probado del otro
 * lado, con 325 tests que ejercitan las reglas de plata y de stock contra una
 * base real. Acá se prueba la capa que va entre los dedos de quien atiende y
 * esas rutas, y para eso lo que importa es qué hace la pantalla con cada
 * respuesta posible —incluida la de error, que contra un servidor de verdad
 * cuesta provocar—.
 *
 * Las respuestas se declaran por método y ruta, y hay dos decisiones acá que
 * existen para que un test no pueda mentir:
 *
 *   1. Una ruta que el test no declaró REVIENTA con su nombre en el mensaje.
 *      Devolver `{}` haría que un componente que pide algo imprevisto se
 *      dibuje a medias y el test siguiera pasando.
 *   2. `llamadas` guarda lo que se envió, para poder afirmar que el PIN salió
 *      hacia el servidor y no se quedó en la pantalla.
 */
import { vi } from "vitest";

export type RespuestaFalsa = { estado?: number; cuerpo: unknown };

export type Llamada = { metodo: string; ruta: string; cuerpo: unknown };

export type ApiFalsa = {
  llamadas: Llamada[];
  /** La última llamada a esa ruta, o `undefined`. Para leerlo sin índices. */
  ultima(metodo: string, ruta: string): Llamada | undefined;
};

/**
 * Las claves son `"GET /api/auth/users"`. Se escribe la ruta completa, con el
 * `/api`, para que se lea igual que en la pestaña de red del navegador y que
 * en las rutas del servidor.
 */
export function montarApi(rutas: Record<string, RespuestaFalsa | (() => RespuestaFalsa)>): ApiFalsa {
  const llamadas: Llamada[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (entrada: RequestInfo | URL, init: RequestInit = {}) => {
      const ruta = String(entrada);
      const metodo = (init.method ?? "GET").toUpperCase();
      const clave = `${metodo} ${ruta}`;

      let cuerpoEnviado: unknown = undefined;
      if (typeof init.body === "string") {
        try {
          cuerpoEnviado = JSON.parse(init.body);
        } catch {
          cuerpoEnviado = init.body;
        }
      }
      llamadas.push({ metodo, ruta, cuerpo: cuerpoEnviado });

      const declarada = rutas[clave];
      if (!declarada) {
        throw new Error(
          `El test no declaró ninguna respuesta para «${clave}».\n` +
            `Declaradas: ${Object.keys(rutas).join(", ") || "(ninguna)"}`,
        );
      }

      const { estado = 200, cuerpo } = typeof declarada === "function" ? declarada() : declarada;
      return {
        ok: estado >= 200 && estado < 300,
        status: estado,
        json: async () => cuerpo,
      } as Response;
    }),
  );

  return {
    llamadas,
    ultima: (metodo, ruta) =>
      [...llamadas].reverse().find((l) => l.metodo === metodo.toUpperCase() && l.ruta === ruta),
  };
}
