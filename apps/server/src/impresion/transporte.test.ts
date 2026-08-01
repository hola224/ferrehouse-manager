/**
 * Los transportes de verdad, ejercitados de verdad.
 *
 * Esto NO usa un doble: la rama de red levanta un socket que escucha y le mira
 * los bytes que llegan, y la de Windows corre el `copy /b` real contra un
 * archivo. Es lo más cerca de una térmica que se puede llegar sin una térmica —
 * lo único que queda sin probar es que la Bixolon interprete los bytes, y eso
 * necesita la impresora.
 */
import { describe, it, expect } from "vitest";
import { createServer } from "node:net";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  destinoValido,
  imprimirPorRed,
  imprimirPorRecursoCompartido,
  transporteDelSistema,
} from "./transporte.js";

/**
 * Un ticket de mentira con **0x1A adentro**, que es el byte del que depende la
 * mitad de este archivo. En ESC/POS aparece sin avisar: en un precio, en un
 * nombre, en un ancho de columna.
 */
const TICKET = Buffer.from([0x1b, 0x40, 0x48, 0x4f, 0x4c, 0x41, 0x1a, 0x0a, 0x1d, 0x56, 0x00, 0xff]);

describe("qué destinos se aceptan", () => {
  it("un recurso compartido de Windows y una térmica de red", () => {
    expect(destinoValido("\\\\SERVIDOR\\TERMICA")).toBe(true);
    expect(destinoValido("\\\\PC-MESON\\T1$")).toBe(true);
    expect(destinoValido("192.168.1.50:9100")).toBe(true);
    expect(destinoValido("termica.local:9100")).toBe(true);
  });

  /**
   * El destino lo escribe un administrador y termina, en la rama de Windows,
   * dentro de una línea de comandos. Uno con comillas o con `&` no es un error
   * de tipeo: es una orden más, corriendo con los permisos del servicio.
   */
  it("nada que pueda colarse como una segunda orden", () => {
    for (const malo of [
      '\\\\SRV\\T" & calc.exe & "',
      "\\\\SRV\\T & del /q C:\\Ferrehouse",
      "\\\\SRV\\T | more",
      "\\\\SRV\\T\\..\\..\\windows",
      "192.168.1.50:9100 & shutdown",
      "C:\\Windows\\System32",
      "",
    ]) {
      expect(destinoValido(malo), malo).toBe(false);
    }
  });
});

describe("la térmica de red (9100)", () => {
  /** Levanta un servidor que hace de impresora y devuelve lo que reciba. */
  async function impresoraDeMentira(): Promise<{ puerto: number; recibido: Promise<Buffer>; cerrar: () => void }> {
    const chunks: Buffer[] = [];
    let resolver: (b: Buffer) => void;
    const recibido = new Promise<Buffer>((r) => (resolver = r));
    const servidor = createServer((socket) => {
      socket.on("data", (d) => chunks.push(d));
      socket.on("end", () => resolver(Buffer.concat(chunks)));
    });
    await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
    const puerto = (servidor.address() as { port: number }).port;
    return { puerto, recibido, cerrar: () => servidor.close() };
  }

  it("entrega los bytes exactos, 0x1A incluido", async () => {
    const imp = await impresoraDeMentira();
    try {
      const r = await imprimirPorRed("127.0.0.1", imp.puerto, TICKET);
      expect(r.ok).toBe(true);
      expect((await imp.recibido).equals(TICKET)).toBe(true);
    } finally {
      imp.cerrar();
    }
  });

  /**
   * Apagada o desenchufada. `alcanzable: false` es lo que hace que la cola NO
   * gaste un intento: la impresora vuelve y el ticket sale.
   */
  it("si no contesta, el error NO gasta intento", async () => {
    const imp = await impresoraDeMentira();
    const puerto = imp.puerto;
    imp.cerrar();
    await new Promise((r) => setTimeout(r, 50));

    const r = await imprimirPorRed("127.0.0.1", puerto, TICKET);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.alcanzable).toBe(false);
      expect(r.error).toContain(String(puerto));
    }
  });
});

/**
 * `copy` es de Windows. En Linux —donde corre CI— no hay nada que probar acá, y
 * saltarlo diciéndolo es mejor que un test que no corre y nadie sabe.
 */
describe.skipIf(process.platform !== "win32")("el recurso compartido de Windows", () => {
  /**
   * LO QUE ESTE TEST PRUEBA Y LO QUE NO, porque la diferencia importa.
   *
   * PRUEBA que la invocación de `copy` es correcta —que las rutas llegan
   * enteras y que los bytes salen idénticos, 0x1A incluido—. Eso ya atrapó un
   * bug real: la primera versión armaba la línea de comandos a mano y `cmd`
   * contestaba «la sintaxis del nombre de archivo no es correcta».
   *
   * NO PRUEBA que el `/b` haga falta. Comprobado quitándolo: el test pasa
   * igual, porque `copy` de archivo a archivo ya usa modo binario. El modo
   * texto —y con él la truncación en el primer 0x1A— aparece cuando el destino
   * es un DISPOSITIVO, que es exactamente el caso de un recurso compartido de
   * impresora y exactamente lo que no se puede ejercitar sin la impresora.
   *
   * O sea que el `/b` se queda por lo que dice la documentación de `copy`, no
   * por lo que verifica este archivo. Queda anotado acá para que nadie lo saque
   * viendo que los tests siguen verdes.
   */
  it("copia los bytes exactos, sin alterar ninguno", async () => {
    const carpeta = await mkdtemp(join(tmpdir(), "fh-destino-"));
    const destino = join(carpeta, "impresora.bin");

    const r = await imprimirPorRecursoCompartido(destino, TICKET);
    expect(r.ok, JSON.stringify(r)).toBe(true);

    const llego = await readFile(destino);
    expect(llego.equals(TICKET)).toBe(true);
    expect(llego.length).toBe(TICKET.length);
  });

  it("un destino que no existe no gasta intento", async () => {
    const r = await imprimirPorRecursoCompartido("\\\\NO-EXISTE-ESTE-PC\\TERMICA", TICKET);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.alcanzable).toBe(false);
  });
});

describe("elegir el transporte por la forma del destino", () => {
  /**
   * Una impresora mal escrita SÍ gasta intentos, al revés que una apagada:
   * reintentar mil veces no la va a escribir bien, y que llegue al tope y quede
   * FALLIDO es lo que hace que alguien la mire.
   */
  it("un destino que no es ninguna de las dos formas se da por error de configuración", async () => {
    const r = await transporteDelSistema.imprimir("la impresora de al lado", TICKET);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.alcanzable).toBe(true);
      expect(r.error).toMatch(/no parece una impresora/);
    }
  });
});
