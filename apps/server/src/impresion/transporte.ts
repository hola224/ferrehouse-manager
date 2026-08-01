/**
 * El puerto de impresión (tarea 7.x — el consumidor de la cola).
 *
 * Debajo de esta interfaz hay dos formas de llegar a una térmica, y arriba una
 * sola cola que no sabe cuál es cuál:
 *
 *   - `\\SERVIDOR\TERMICA` — un recurso compartido de Windows. Es el caso de
 *     esta tienda: la impresora cuelga por USB del PC del mesón y se comparte.
 *   - `192.168.1.50:9100` — una térmica con puerto Ethernet. No hay ninguna
 *     todavía, pero el modelo de datos ya lo contemplaba y son diez líneas.
 *
 * SE ELIGE POR LA FORMA DEL DESTINO y no por una configuración aparte: un
 * segundo lugar donde decir «esta caja imprime por red» es un segundo lugar
 * donde se puede quedar desactualizado.
 */
import { execFile } from "node:child_process";
import { createConnection } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `alcanzable` es la distinción que gobierna toda la cola, y no es lo mismo que
 * «permanente»:
 *
 *   - `alcanzable: false` — no se pudo ni hablar con la impresora. Está
 *     apagada, sin papel en el sentido de desconectada, o el PC que la comparte
 *     se reinició. NO se gasta un intento: la impresora vuelve y el ticket
 *     sale. Es la misma regla que la cola de WhatsApp aplica a la sesión caída,
 *     y por la misma razón — si cada pasada consumiera un intento, apagar la
 *     impresora diez minutos dejaría toda la cola en FALLIDO y los tickets no
 *     saldrían nunca.
 *   - `alcanzable: true` con `ok: false` — se habló con ella y rechazó el
 *     trabajo. Eso sí es un intento gastado: reintentar lo mismo va a fallar
 *     igual, y hay un tope.
 */
export type ResultadoImpresion = { ok: true } | { ok: false; error: string; alcanzable: boolean };

export interface TransporteImpresion {
  imprimir(destino: string, bytes: Buffer): Promise<ResultadoImpresion>;
}

/**
 * Qué destinos se aceptan, y por qué la lista es corta.
 *
 * `destino` lo escribe un administrador en «Cajas y terminales» y termina, en
 * la rama de Windows, dentro de una línea de comandos. Un destino con comillas
 * o con `&` no es un error de tipeo que corregir: es una orden más que se
 * ejecuta con los permisos del servicio. Se valida la forma ANTES de tocar
 * nada, y lo que no calza no se intenta.
 */
const RECURSO_WINDOWS = /^\\\\[A-Za-z0-9._-]+\\[A-Za-z0-9._$-]+$/;
const RED = /^([A-Za-z0-9._-]+):(\d{1,5})$/;

export function destinoValido(destino: string): boolean {
  return RECURSO_WINDOWS.test(destino) || RED.test(destino);
}

/** Milisegundos antes de dar por muerta a una impresora que no contesta. */
const TIEMPO_LIMITE = 10_000;

/**
 * Térmica con puerto Ethernet: se le escriben los bytes crudos al 9100 y se
 * corta. No hay protocolo ni respuesta que leer — el 9100 es un caño.
 */
export async function imprimirPorRed(host: string, puerto: number, bytes: Buffer): Promise<ResultadoImpresion> {
  return new Promise((resolver) => {
    let resuelto = false;
    const listo = (r: ResultadoImpresion) => {
      if (resuelto) return;
      resuelto = true;
      socket.destroy();
      resolver(r);
    };

    const socket = createConnection({ host, port: puerto });
    socket.setTimeout(TIEMPO_LIMITE);

    socket.on("connect", () => {
      socket.write(bytes, (e) => {
        if (e) listo({ ok: false, error: `Se cortó al escribir: ${e.message}`, alcanzable: true });
        else socket.end();
      });
    });
    // `end` limpio = los bytes salieron. La térmica no acusa recibo.
    socket.on("close", (conError) => {
      if (!conError) listo({ ok: true });
    });
    socket.on("timeout", () =>
      listo({ ok: false, error: `${host}:${puerto} no contestó en 10 segundos.`, alcanzable: false }),
    );
    socket.on("error", (e) =>
      listo({ ok: false, error: `No se pudo conectar a ${host}:${puerto}: ${e.message}`, alcanzable: false }),
    );
  });
}

/**
 * Recurso compartido de Windows, con `copy /b`.
 *
 * **`/b` NO SE SACA.** `copy` elige el modo según el destino: de archivo a
 * archivo va en binario, pero **a un dispositivo —y un recurso compartido de
 * impresora lo es— va en modo texto**, y ahí el primer byte 0x1A se toma como
 * fin de archivo y el resto no se manda. Un ticket ESC/POS es binario: 0x1A
 * puede aparecer en cualquier parte —en un precio, en un nombre, en un ancho de
 * columna— y el síntoma sería un ticket cortado a la mitad, distinto en cada
 * venta y sin ningún error en ninguna parte.
 *
 * Está dicho así de largo porque los tests NO lo pueden respaldar: como copian
 * a un archivo, pasan igual con `/b` y sin él. Comprobado. Ver `transporte.test.ts`.
 *
 * Y `copy` y no `fs.writeFile`: un recurso compartido de impresora no es un
 * archivo, y Node no lo sabe abrir. `copy` sí, porque va por el mismo
 * redirector de red que usa el Explorador.
 */
export async function imprimirPorRecursoCompartido(destino: string, bytes: Buffer): Promise<ResultadoImpresion> {
  const carpeta = await mkdtemp(join(tmpdir(), "fh-print-"));
  const archivo = join(carpeta, "trabajo.bin");
  try {
    await writeFile(archivo, bytes);
    await new Promise<void>((ok, falla) => {
      /*
        Los argumentos POR SEPARADO y no una línea armada a mano.

        Con la línea entera como un solo argumento —`"copy /b \"a\" \"b\""`—
        Node la vuelve a entrecomillar antes de pasarla, `cmd` recibe las
        comillas anidadas y contesta «la sintaxis del nombre de archivo no es
        correcta». Pasando los cuatro pedazos sueltos, cada uno se entrecomilla
        solo si lo necesita y las rutas con espacios llegan enteras.

        Va por `cmd` porque `copy` es una orden interna, no un ejecutable.
      */
      execFile(
        "cmd",
        ["/c", "copy", "/b", archivo, destino],
        { timeout: TIEMPO_LIMITE, windowsHide: true },
        (e, _salida, errores) => (e ? falla(new Error(errores?.trim() || e.message)) : ok()),
      );
    });
    return { ok: true };
  } catch (e) {
    /*
      `copy` no distingue en su código de salida entre «no encuentro el
      recurso» y «lo encontré y falló», así que se mira el texto. Se prefiere
      dar el error por NO alcanzable —o sea, no gastar un intento—: el modo de
      falla más común es la impresora apagada, y equivocarse hacia «reintenta»
      cuesta una pasada más; equivocarse hacia «falla» cuesta un ticket.
    */
    const texto = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `No se pudo imprimir en ${destino}. ${texto}`.trim(), alcanzable: false };
  } finally {
    await rm(carpeta, { recursive: true, force: true }).catch(() => {});
  }
}

export const transporteDelSistema: TransporteImpresion = {
  async imprimir(destino, bytes) {
    const red = RED.exec(destino);
    if (red) return imprimirPorRed(red[1]!, Number(red[2]), bytes);
    if (RECURSO_WINDOWS.test(destino)) return imprimirPorRecursoCompartido(destino, bytes);
    /*
      Un destino que no calza con ninguna forma SÍ es un intento gastado: no es
      que la impresora esté apagada, es que está mal escrita, y reintentar mil
      veces no la va a escribir bien. Que llegue al tope y quede FALLIDO es lo
      que hace que alguien lo mire.
    */
    return {
      ok: false,
      error: `«${destino}» no parece una impresora. Se espera \\\\PC\\NOMBRE o host:9100.`,
      alcanzable: true,
    };
  },
};

let actual: TransporteImpresion = transporteDelSistema;

export function transporteImpresion(): TransporteImpresion {
  return actual;
}

/** Lo usan los tests. En el servidor de verdad nadie lo llama. */
export function setTransporteImpresion(t: TransporteImpresion): void {
  actual = t;
}

export function resetTransporteImpresion(): void {
  actual = transporteDelSistema;
}
