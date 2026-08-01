/**
 * Preparación de los tests de pantalla.
 *
 * `jsdom` es un navegador de mentira que corre dentro de Node: tiene DOM,
 * eventos y foco, pero NO pinta nada. Eso define exactamente qué se puede
 * probar acá y qué no: se prueba el comportamiento —qué aparece, qué queda
 * deshabilitado, qué pasa al teclear— y no se prueba nada visual. Un botón que
 * a 1366×768 queda fuera de pantalla pasa estos tests sin chistar.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

/**
 * `fetch` falso por omisión, y que REVIENTA si nadie lo preparó.
 *
 * La alternativa —devolver `{}` para cualquier llamada— es peor de lo que
 * parece: un componente que pide una ruta que el test no previó recibiría un
 * objeto vacío, se dibujaría a medias y el test seguiría pasando mientras
 * verifica una pantalla que en la tienda no existe. Fallar con la ruta en el
 * mensaje convierte ese caso en un error que se lee y se arregla.
 */
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((entrada: RequestInfo | URL) => {
      throw new Error(`El test no preparó una respuesta para ${String(entrada)}`);
    }),
  );
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
