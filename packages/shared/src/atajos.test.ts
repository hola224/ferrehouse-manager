import { describe, it, expect } from "vitest";
import { ATAJOS, TECLAS_DEL_NAVEGADOR, atajosDe, atajosVisibles, teclaDisponible } from "./atajos.js";

describe("tabla de atajos (tarea 3.11)", () => {
  /**
   * El guardián de la decisión: los terminales corren Chrome normal, que se
   * queda con F3, F5, F10, F11 y F12. Si alguien asigna una de esas, la tecla
   * no llega nunca a la aplicación y el atajo impreso en pantalla miente.
   */
  it("ningún atajo usa una tecla que el navegador se queda", () => {
    for (const a of ATAJOS) {
      expect(teclaDisponible(a.tecla), `${a.tecla} (${a.accion})`).toBe(true);
    }
  });

  it("F10 y F5 están explícitamente fuera", () => {
    expect(teclaDisponible("F10")).toBe(false);
    expect(teclaDisponible("F5")).toBe(false);
    expect(TECLAS_DEL_NAVEGADOR).toContain("F11");
  });

  it("dentro de una misma pantalla no hay dos acciones con la misma tecla", () => {
    for (const donde of ["catalogo", "venta", "caja"] as const) {
      const teclas = atajosDe(donde).map((a) => a.tecla);
      expect(new Set(teclas).size, donde).toBe(teclas.length);
    }
  });

  /**
   * La tecla se reserva igual —para que nadie la reasigne creyéndola libre—
   * pero no se imprime hasta que exista la acción. Se descubrió manejando la
   * pantalla de venta: anunciaba «F4 descuento» y «F6 dejar en espera», y
   * ninguna de las dos hacía nada.
   */
  /**
   * Reservar una tecla y anunciarla no son lo mismo. La reservada sin construir
   * sigue en la tabla —para que nadie la reasigne creyéndola libre— pero no se
   * imprime; la construida se imprime siempre. Los dos errores son el mismo
   * error: la pantalla diciendo algo que no es.
   */
  it("se imprime lo construido y solo lo construido", () => {
    for (const a of ATAJOS) {
      expect(atajosDe(a.donde), `${a.tecla} ${a.accion} sigue reservada`).toContainEqual(a);
      if (a.pendiente) {
        expect(atajosVisibles(a.donde), `${a.tecla} ${a.accion} no se anuncia`).not.toContainEqual(a);
      } else {
        expect(atajosVisibles(a.donde), `${a.tecla} ${a.accion} se anuncia`).toContainEqual(a);
      }
    }
  });

  /** Las cuatro de venta quedaron construidas el 2026-07-31. */
  it("en venta se imprimen las cuatro", () => {
    expect(atajosVisibles("venta").map((a) => `${a.tecla} ${a.accion}`)).toEqual([
      "F2 Cobrar",
      "F4 Descuento",
      "F6 Dejar en espera",
      "F8 Recuperar espera",
    ]);
  });

  it("el catálogo tiene sus cuatro atajos", () => {
    expect(atajosDe("catalogo").map((a) => `${a.tecla} ${a.accion}`)).toEqual([
      "F2 Producto nuevo",
      "F4 Importar Excel",
      "F6 Imprimir etiqueta",
      "F8 Editar",
    ]);
  });
});
