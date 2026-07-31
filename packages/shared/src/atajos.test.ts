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
  it("las teclas reservadas sin construir no se imprimen en pantalla", () => {
    const reservadas = ATAJOS.filter((a) => a.pendiente);
    expect(reservadas.length).toBeGreaterThan(0);
    for (const a of reservadas) {
      expect(atajosDe(a.donde), `${a.tecla} sigue reservada`).toContainEqual(a);
      expect(atajosVisibles(a.donde), `${a.tecla} no se anuncia`).not.toContainEqual(a);
    }
  });

  it("en venta hoy solo se imprime F2 cobrar", () => {
    expect(atajosVisibles("venta").map((a) => `${a.tecla} ${a.accion}`)).toEqual(["F2 Cobrar"]);
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
