import { describe, it, expect } from "vitest";
import {
  renderPlantilla,
  variablesDesconocidas,
  esPalabraDeBaja,
  esperaDeReintento,
  esperaEntreEnvios,
} from "./whatsapp.js";

const PLANTILLA = "Hola {nombre}, gracias por tu compra en Ferrehouse por {total}.";

describe("plantilla del mensaje", () => {
  it("rellena las dos variables", () => {
    expect(renderPlantilla(PLANTILLA, { nombre: "Ana", total: "$12.000" })).toBe(
      "Hola Ana, gracias por tu compra en Ferrehouse por $12.000.",
    );
  });

  /** El caso normal cuando hay cola en el mesón: teléfono sí, nombre no. */
  it("sin nombre no deja una coma huérfana", () => {
    expect(renderPlantilla(PLANTILLA, { nombre: null, total: "$12.000" })).toBe(
      "Hola, gracias por tu compra en Ferrehouse por $12.000.",
    );
    expect(renderPlantilla(PLANTILLA, { nombre: "   ", total: "$12.000" })).toBe(
      "Hola, gracias por tu compra en Ferrehouse por $12.000.",
    );
  });

  it("no colapsa el salto de línea, que el admin sí quiso poner", () => {
    const dos = "Hola {nombre}.\nTu compra: {total}";
    expect(renderPlantilla(dos, { nombre: "Ana", total: "$1" })).toBe("Hola Ana.\nTu compra: $1");
  });

  it("una variable inventada se detecta ANTES de guardar", () => {
    expect(variablesDesconocidas(PLANTILLA)).toEqual([]);
    expect(variablesDesconocidas("Hola {nombre}, tu {telefono} y {folio}")).toEqual(["telefono", "folio"]);
  });

  it("la variable desconocida se repite una vez sola en el reclamo", () => {
    expect(variablesDesconocidas("{x} y {x} y {x}")).toEqual(["x"]);
  });
});

describe("palabra de baja", () => {
  it("la palabra sola, con mayúsculas o punto, es baja", () => {
    for (const m of ["BAJA", "baja", "Baja.", " stop ", "Salir", "CANCELAR"]) {
      expect(esPalabraDeBaja(m)).toBe(true);
    }
  });

  it("las frases inequívocas valen dentro de un mensaje largo", () => {
    expect(esPalabraDeBaja("hola, por favor darme de baja de la lista, gracias")).toBe(true);
    expect(esPalabraDeBaja("No molestar más por favor")).toBe(true);
  });

  it("acentos y signos no cambian el resultado", () => {
    expect(esPalabraDeBaja("¡No molestar!")).toBe(true);
  });

  /**
   * El falso positivo que se evita a propósito: un reclamo por calidad NO es
   * una baja, y darlo de baja lo deja además sin respuesta.
   */
  it("'baja' dentro de una frase corriente no da de baja", () => {
    expect(esPalabraDeBaja("la baja calidad de los tornillos es un problema")).toBe(false);
  });

  it("un mensaje cualquiera no es baja", () => {
    expect(esPalabraDeBaja("gracias!")).toBe(false);
    expect(esPalabraDeBaja("tienen tarugos de 8?")).toBe(false);
    expect(esPalabraDeBaja("")).toBe(false);
    expect(esPalabraDeBaja("   ")).toBe(false);
  });
});

describe("reintentos y ritmo", () => {
  it("dobla en cada intento y se topa en media hora", () => {
    const sinJitter = () => 0.5; // factor exactamente 1
    expect(esperaDeReintento(1, sinJitter)).toBe(60_000);
    expect(esperaDeReintento(2, sinJitter)).toBe(120_000);
    expect(esperaDeReintento(3, sinJitter)).toBe(240_000);
    expect(esperaDeReintento(10, sinJitter)).toBe(30 * 60_000);
    expect(esperaDeReintento(99, sinJitter)).toBe(30 * 60_000);
  });

  it("el jitter es ±20% y se inyecta, no se sortea en el test", () => {
    expect(esperaDeReintento(1, () => 0)).toBe(48_000); // −20%
    expect(esperaDeReintento(1, () => 1)).toBe(72_000); // +20%
  });

  it("el primer intento no espera menos que el mínimo", () => {
    expect(esperaDeReintento(0, () => 0.5)).toBe(60_000);
  });

  it("entre dos envíos se espera entre 4 y 15 segundos", () => {
    expect(esperaEntreEnvios(() => 0)).toBe(4000);
    expect(esperaEntreEnvios(() => 1)).toBe(15_000);
    expect(esperaEntreEnvios(() => 0.5)).toBe(9500);
  });
});
