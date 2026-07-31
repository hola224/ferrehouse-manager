/**
 * Respaldo: todo lo que se puede decidir sin tocar el disco (tarea 7.2).
 *
 * Acá viven el nombre del archivo, cuándo toca respaldar y cuáles se borran.
 * Está en `shared` y no en el servidor por una razón concreta: **el script de
 * restauración corre fuera del servidor** —el PC puede estar recién formateado
 * y la base perdida— y tiene que entender los mismos nombres que escribió el
 * que respaldó.
 *
 * Todo lo de acá es puro: recibe fechas y listas de nombres, devuelve
 * decisiones. Lo que toca el disco vive en `apps/server/src/backup.ts`.
 */

/**
 * `ferrehouse-2026-07-31-130542.db`.
 *
 * El formato no es estético: año-mes-día-hora ordena cronológicamente **por
 * orden alfabético**, así que ordenar la carpeta por nombre es ordenarla por
 * fecha, en el explorador de Windows y en cualquier `ls`. Y lleva segundos
 * porque el respaldo diario y un "respaldar ahora" apretado a mano pueden caer
 * en el mismo minuto, y `VACUUM INTO` falla si el archivo ya existe.
 */
const PATRON = /^ferrehouse-(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.db$/;

/**
 * Cuántos se guardan pase lo que pase, aunque estén todos vencidos.
 *
 * La rotación por edad sola tiene un modo de falla feo: el PC apagado seis
 * semanas —vacaciones, se llevaron el equipo, se quemó la fuente— vuelve, y lo
 * primero que hace el servidor al arrancar es borrar TODOS los respaldos por
 * viejos. Justo en el momento en que son lo único que hay.
 */
export const MINIMO_RESPALDOS = 7;

function dosDigitos(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * El nombre del respaldo de ese instante, en **hora local**. La tienda está en
 * Concepción y el que busca "el respaldo de ayer en la tarde" lo busca en su
 * hora, no en UTC.
 */
export function nombreDeRespaldo(fecha: Date): string {
  const f = fecha;
  return (
    `ferrehouse-${f.getFullYear()}-${dosDigitos(f.getMonth() + 1)}-${dosDigitos(f.getDate())}` +
    `-${dosDigitos(f.getHours())}${dosDigitos(f.getMinutes())}${dosDigitos(f.getSeconds())}.db`
  );
}

/** `null` si el nombre no es de un respaldo nuestro. */
export function fechaDeRespaldo(nombre: string): Date | null {
  const m = PATRON.exec(nombre);
  if (!m) return null;
  const [, a, mes, d, h, min, s] = m.map(Number) as unknown as number[];
  const fecha = new Date(a!, mes! - 1, d!, h!, min!, s!);
  // Un "2026-02-31" pasa el patrón y `Date` lo corre al 3 de marzo sin chistar.
  if (fecha.getMonth() !== mes! - 1 || fecha.getDate() !== d!) return null;
  return fecha;
}

/**
 * **La rotación borra archivos, así que solo mira los suyos.** La carpeta de
 * destino puede ser un pendrive con las fotos de alguien o la carpeta de la
 * nube con otras cosas adentro; borrar por antigüedad todo lo que haya ahí
 * sería un desastre causado por una tarea de mantención.
 */
export function esRespaldo(nombre: string): boolean {
  return fechaDeRespaldo(nombre) !== null;
}

function mismoDia(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export type Veredicto = { debe: boolean; motivo: string };

/**
 * ¿Toca respaldar ahora? Dos disparadores, y el segundo existe porque el
 * primero solo no basta.
 *
 * 1. **La hora del día.** Se respalda a la hora configurada, con la tienda
 *    abierta y el PC encendido.
 * 2. **Más de 24 horas sin respaldo, a cualquier hora.** Sin esta regla, una
 *    tienda que cierra a las 19:00 y tiene la hora en 22 **no se respalda
 *    nunca**, y nadie se entera hasta el día que hace falta. La hora
 *    configurada es una preferencia; que exista un respaldo del día es el
 *    requisito.
 */
export function hayQueRespaldar(ultimo: Date | null, ahora: Date, hora: number): Veredicto {
  if (ultimo === null) return { debe: true, motivo: "Todavía no hay ningún respaldo." };

  const horas = (ahora.getTime() - ultimo.getTime()) / 3_600_000;
  if (horas >= 24) {
    return { debe: true, motivo: `El último respaldo es de hace ${Math.floor(horas)} horas.` };
  }
  if (mismoDia(ultimo, ahora)) return { debe: false, motivo: "Ya se respaldó hoy." };
  if (ahora.getHours() >= hora) {
    return { debe: true, motivo: "Es la hora del respaldo diario y hoy no hay ninguno." };
  }
  return { debe: false, motivo: `Esperando la hora del respaldo (${dosDigitos(hora)}:00).` };
}

/**
 * Cuáles se borran y cuáles quedan, dada la lista de nombres de una carpeta.
 *
 * No borra nada: **decide**. Quien borra es el servidor, y así esta regla —que
 * es donde se pierde información si está mal— se prueba sin tocar el disco.
 */
export function aRotar(
  nombres: string[],
  opts: { ahora: Date; dias: number; minimo?: number },
): { borrar: string[]; quedan: string[] } {
  const minimo = opts.minimo ?? MINIMO_RESPALDOS;
  const limite = opts.ahora.getTime() - opts.dias * 24 * 3_600_000;

  const propios = nombres
    .map((n) => ({ nombre: n, fecha: fechaDeRespaldo(n) }))
    .filter((x): x is { nombre: string; fecha: Date } => x.fecha !== null)
    .sort((a, b) => b.fecha.getTime() - a.fecha.getTime());

  const borrar: string[] = [];
  const quedan: string[] = [];

  for (const [i, x] of propios.entries()) {
    if (i < minimo) quedan.push(x.nombre);
    else if (x.fecha.getTime() < limite) borrar.push(x.nombre);
    else quedan.push(x.nombre);
  }

  return { borrar, quedan };
}

/**
 * Hace cuánto se respaldó, dicho como lo diría una persona. El panel muestra
 * esto y no una fecha ISO: para saber si hay que preocuparse importa el
 * "hace", no el "cuándo".
 */
export function antiguedadDeRespaldo(ultimo: Date | null, ahora: Date): string {
  if (ultimo === null) return "nunca";
  const minutos = Math.floor((ahora.getTime() - ultimo.getTime()) / 60_000);
  if (minutos < 1) return "recién";
  if (minutos < 60) return `hace ${minutos} minutos`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `hace ${horas} ${horas === 1 ? "hora" : "horas"}`;
  const dias = Math.floor(horas / 24);
  return `hace ${dias} ${dias === 1 ? "día" : "días"}`;
}
