/**
 * Restaurar la base desde un respaldo (tarea 7.3).
 *
 * **Es un programa aparte y no un botón del panel.** Restaurar sobrescribe el
 * archivo que SQLite tiene abierto: hacerlo desde el servidor corriendo
 * corrompe la base y deja a la tienda sin ninguna de las dos. Por eso lo
 * primero que hace es preguntarle al servidor si está vivo, y si contesta, se
 * niega.
 *
 * Uso:
 *   pnpm db:restore --lista           ver los respaldos disponibles
 *   pnpm db:restore --ultimo          volver al más reciente
 *   pnpm db:restore ferrehouse-…​.db   volver a uno en particular
 *   pnpm db:restore --ultimo --si     sin preguntar (para un .bat)
 *
 * En la tienda corre compilado: `node dist\\restaurar-cli.js --ultimo`, que es
 * lo que hay detrás del acceso directo "Restaurar respaldo" del escritorio.
 */
import { createInterface } from "node:readline/promises";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { esRespaldo, fechaDeRespaldo, antiguedadDeRespaldo } from "@ferrehouse/shared";
import { carpetaDeRespaldos, restaurar, rutaBaseDeDatos, servidorRespondiendo } from "./backup.js";
import { db } from "./db.js";

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024).toLocaleString("es-CL")} KB`;
}

function listar(dir: string): string[] {
  try {
    return readdirSync(dir).filter(esRespaldo).sort().reverse();
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const si = args.includes("--si");
  const dir = await carpetaDeRespaldos();
  const disponibles = listar(dir);

  console.log(`\nCarpeta de respaldos: ${dir}`);
  console.log(`Base de datos:        ${rutaBaseDeDatos()}\n`);

  if (disponibles.length === 0) {
    console.error("No hay ningún respaldo en esa carpeta.\n");
    console.error("Si el respaldo está en un pendrive, cópialo primero a esa carpeta.\n");
    process.exit(1);
  }

  if (args.includes("--lista") || args.length === 0) {
    const ahora = new Date();
    for (const [i, n] of disponibles.entries()) {
      const bytes = statSync(join(dir, n)).size;
      console.log(
        `  ${String(i + 1).padStart(2)}. ${n}  ${kb(bytes).padStart(10)}  ${antiguedadDeRespaldo(fechaDeRespaldo(n), ahora)}`,
      );
    }
    console.log(`\nPara volver al más reciente:  pnpm db:restore --ultimo\n`);
    return;
  }

  const elegido = args.includes("--ultimo") ? disponibles[0]! : args.find((a) => !a.startsWith("--"));
  if (!elegido) {
    console.error("Dime cuál respaldo: --ultimo, o el nombre del archivo.\n");
    process.exit(1);
  }

  /**
   * El chequeo que evita el desastre. Un `curl` al propio servidor es la forma
   * más directa de saber si está arriba, y no depende de que alguien se acuerde
   * de detener el servicio antes.
   */
  const puerto = Number(process.env.PORT ?? 3000);
  if (await servidorRespondiendo(puerto)) {
    console.error(`El servidor está corriendo en el puerto ${puerto}. NO se puede restaurar así.\n`);
    console.error("Deténlo primero. Si está instalado como servicio, en una consola de administrador:\n");
    console.error("    nssm stop FerrehouseManager\n");
    console.error("Cuando termines de restaurar:\n");
    console.error("    nssm start FerrehouseManager\n");
    process.exit(1);
  }

  console.log(`Se va a restaurar:    ${elegido}`);
  console.log(`\nLa base actual NO se borra: se guarda al lado con la fecha de hoy.\n`);

  if (!si) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const r = (await rl.question('Escribe "restaurar" para confirmar: ')).trim().toLowerCase();
    rl.close();
    if (r !== "restaurar") {
      console.log("\nCancelado. No se tocó nada.\n");
      return;
    }
  }

  await db.$disconnect();
  const resultado = await restaurar(elegido);

  if (!resultado.ok) {
    console.error(`\nNo se restauró: ${resultado.error}\n`);
    process.exit(1);
  }

  console.log("");
  for (const paso of resultado.pasos) console.log(`  · ${paso}`);
  console.log("\nListo. Ahora levanta el servidor:\n");
  console.log("    nssm start FerrehouseManager     (o `pnpm --filter @ferrehouse/server start`)\n");
  console.log("Al arrancar vuelve a activar el modo WAL solo y corre sus autochequeos:");
  console.log("si la base restaurada tuviera algo incompleto, se va a negar a arrancar y te lo va a decir.\n");
}

main()
  .catch((e) => {
    console.error("\n" + (e instanceof Error ? e.message : String(e)) + "\n");
    process.exit(1);
  })
  .finally(() => db.$disconnect());
