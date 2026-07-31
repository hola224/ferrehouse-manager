import { describe, it, expect } from "vitest";
import {
  nombreDeRespaldo,
  fechaDeRespaldo,
  esRespaldo,
  hayQueRespaldar,
  aRotar,
  antiguedadDeRespaldo,
  MINIMO_RESPALDOS,
} from "./backup.js";

describe("el nombre del respaldo", () => {
  it("lleva fecha y hora local, con segundos", () => {
    expect(nombreDeRespaldo(new Date(2026, 6, 31, 13, 5, 42))).toBe("ferrehouse-2026-07-31-130542.db");
  });

  it("ordena cronológicamente por orden alfabético", () => {
    const nombres = [
      nombreDeRespaldo(new Date(2026, 6, 31, 9, 0, 0)),
      nombreDeRespaldo(new Date(2025, 11, 31, 23, 59, 59)),
      nombreDeRespaldo(new Date(2026, 6, 31, 13, 0, 0)),
    ];
    expect([...nombres].sort()).toEqual([nombres[1], nombres[0], nombres[2]]);
  });

  it("va y vuelve sin perder nada", () => {
    const fecha = new Date(2026, 1, 3, 8, 30, 1);
    expect(fechaDeRespaldo(nombreDeRespaldo(fecha))).toEqual(fecha);
  });

  it("no reconoce como respaldo lo que no lo es", () => {
    // El pendrive puede tener cualquier cosa adentro, y la rotación borra.
    for (const ajeno of [
      "ferrehouse.db",
      "ferrehouse.db-wal",
      "vacaciones.jpg",
      "ferrehouse-2026-07-31.db",
      "ferrehouse-2026-07-31-1305.db",
      "copia de ferrehouse-2026-07-31-130542.db",
      "ferrehouse-2026-07-31-130542.db.bak",
    ]) {
      expect(esRespaldo(ajeno), ajeno).toBe(false);
    }
  });

  it("rechaza una fecha que no existe aunque calce con el patrón", () => {
    // `new Date(2026, 1, 31)` da el 3 de marzo sin avisar.
    expect(fechaDeRespaldo("ferrehouse-2026-02-31-120000.db")).toBeNull();
  });
});

describe("cuándo toca respaldar", () => {
  const hora = 13;

  it("sin ningún respaldo, ahora mismo", () => {
    expect(hayQueRespaldar(null, new Date(2026, 6, 31, 9, 0), hora).debe).toBe(true);
  });

  it("antes de la hora, con el de ayer todavía fresco, espera", () => {
    const ayer = new Date(2026, 6, 30, 20, 0);
    const r = hayQueRespaldar(ayer, new Date(2026, 6, 31, 9, 0), hora);
    expect(r.debe).toBe(false);
    expect(r.motivo).toContain("13:00");
  });

  it("llegada la hora, si hoy no hay ninguno, respalda", () => {
    const ayer = new Date(2026, 6, 30, 20, 0);
    expect(hayQueRespaldar(ayer, new Date(2026, 6, 31, 13, 0), hora).debe).toBe(true);
  });

  it("si ya se respaldó hoy, no se repite en cada pasada", () => {
    const hoy = new Date(2026, 6, 31, 13, 0);
    expect(hayQueRespaldar(hoy, new Date(2026, 6, 31, 18, 30), hora).debe).toBe(false);
  });

  /**
   * La razón de ser del segundo disparador: una tienda que cierra antes de la
   * hora configurada no se respaldaría NUNCA, y el panel diría que todo bien.
   */
  it("respalda igual, a cualquier hora, si pasaron más de 24 horas", () => {
    const anteayer = new Date(2026, 6, 29, 20, 0);
    const r = hayQueRespaldar(anteayer, new Date(2026, 6, 31, 9, 0), 22);
    expect(r.debe).toBe(true);
    expect(r.motivo).toContain("37 horas");
  });

  it("con la hora en 0 respalda apenas cambia el día", () => {
    const ayer = new Date(2026, 6, 30, 23, 30);
    expect(hayQueRespaldar(ayer, new Date(2026, 6, 31, 0, 5), 0).debe).toBe(true);
  });
});

describe("la rotación", () => {
  const nombreDe = (dias: number) => nombreDeRespaldo(new Date(2026, 6, 31 - dias, 13, 0, 0));
  const ahora = new Date(2026, 6, 31, 13, 30);

  it("borra los vencidos y deja los vigentes", () => {
    const nombres = [nombreDe(0), nombreDe(10), nombreDe(31), nombreDe(45)];
    // Con 4 archivos el mínimo de 7 los protege a todos: se baja para probar la edad.
    const r = aRotar(nombres, { ahora, dias: 30, minimo: 1 });
    expect(r.borrar).toEqual([nombreDe(31), nombreDe(45)]);
    expect(r.quedan).toEqual([nombreDe(0), nombreDe(10)]);
  });

  it("nunca toca lo que no es un respaldo suyo", () => {
    const ajenos = ["fotos.zip", "ferrehouse.db", "informe.pdf"];
    const r = aRotar([...ajenos, nombreDe(90)], { ahora, dias: 30, minimo: 0 });
    expect(r.borrar).toEqual([nombreDe(90)]);
    expect(r.quedan).toEqual([]);
  });

  /**
   * El PC apagado seis semanas vuelve y lo primero que haría una rotación por
   * edad sola es borrar TODO, justo cuando es lo único que queda.
   */
  it("guarda siempre los más nuevos aunque estén todos vencidos", () => {
    const nombres = Array.from({ length: 20 }, (_, i) => nombreDe(40 + i));
    const r = aRotar(nombres, { ahora, dias: 30 });
    expect(r.quedan).toHaveLength(MINIMO_RESPALDOS);
    expect(r.borrar).toHaveLength(20 - MINIMO_RESPALDOS);
    // Los que quedan son los más nuevos, no los primeros de la lista.
    expect(r.quedan[0]).toBe(nombreDe(40));
  });

  it("con la carpeta vacía no decide nada", () => {
    expect(aRotar([], { ahora, dias: 30 })).toEqual({ borrar: [], quedan: [] });
  });
});

describe("la antigüedad en palabras", () => {
  const ahora = new Date(2026, 6, 31, 13, 0);
  it.each([
    [null, "nunca"],
    [new Date(2026, 6, 31, 12, 59, 40), "recién"],
    [new Date(2026, 6, 31, 12, 30), "hace 30 minutos"],
    [new Date(2026, 6, 31, 12, 0), "hace 1 hora"],
    [new Date(2026, 6, 31, 5, 0), "hace 8 horas"],
    [new Date(2026, 6, 30, 12, 0), "hace 1 día"],
    [new Date(2026, 6, 25, 12, 0), "hace 6 días"],
  ])("%s → %s", (fecha, esperado) => {
    expect(antiguedadDeRespaldo(fecha, ahora)).toBe(esperado);
  });
});
