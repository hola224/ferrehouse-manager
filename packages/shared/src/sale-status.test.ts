import { describe, it, expect } from "vitest";
import { deriveSaleStatus } from "./sale-status.js";

const linea = (qty: number, devuelto = 0) => ({ qtyMilli: qty, returnedQtyMilli: devuelto });

describe("etiqueta visible de una venta", () => {
  it("venta normal", () => {
    expect(deriveSaleStatus({ status: "COMPLETED", reversalKind: null, items: [linea(2000)] })).toBe("COMPLETADA");
  });

  it("con devoluciones parciales sigue en COMPLETED pero no se muestra igual", () => {
    expect(
      deriveSaleStatus({ status: "COMPLETED", reversalKind: null, items: [linea(2000, 500), linea(1000)] }),
    ).toBe("CON_DEVOLUCIONES");
  });

  it("devuelta entera por partes: el caso que el brief no tenía", () => {
    expect(
      deriveSaleStatus({ status: "COMPLETED", reversalKind: null, items: [linea(2000, 2000), linea(1000, 1000)] }),
    ).toBe("DEVUELTA");
  });

  it("anulada", () => {
    expect(deriveSaleStatus({ status: "REVERSED", reversalKind: null, items: [linea(2000)] })).toBe("ANULADA");
  });

  it("la fila que ES la reversa es un documento propio", () => {
    expect(deriveSaleStatus({ status: "COMPLETED", reversalKind: "RETURN", items: [linea(-500)] })).toBe("DEVOLUCION");
    expect(deriveSaleStatus({ status: "COMPLETED", reversalKind: "VOID", items: [linea(-2000)] })).toBe("ANULACION");
  });
});
