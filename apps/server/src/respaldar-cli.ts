/**
 * Respaldar a mano, sin pasar por el panel (tarea 7.2).
 *
 * Sirve para lo que uno hace antes de algo riesgoso —actualizar, tocar el
 * schema, llevarse el PC al técnico— y para el acceso directo del escritorio.
 * Corre con el servidor arriba o abajo: `VACUUM INTO` lee por la conexión, así
 * que no le molesta que la tienda esté vendiendo.
 */
import { estadoDeRespaldo, respaldar } from "./backup.js";
import { db } from "./db.js";

/** "332 KB", "14,2 MB". Nunca "0 MB", que se lee como que no hay nada. */
function tamano(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024).toLocaleString("es-CL")} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("es-CL", { maximumFractionDigits: 1 })} MB`;
}

async function main(): Promise<void> {
  const r = await respaldar();
  if (!r.ok) {
    console.error(`\nNo se pudo respaldar: ${r.error}\n`);
    process.exit(1);
  }

  console.log(`\nRespaldo listo: ${r.archivo}`);
  console.log(`  ${tamano(r.bytes)} en ${r.ms} ms`);
  console.log(r.copia.ok ? `  copiado a ${r.copia.destino}` : `  ${r.copia.problema}`);
  if (r.borrados.length) console.log(`  se borraron ${r.borrados.length} respaldos vencidos`);

  const e = await estadoDeRespaldo();
  const plural = e.cantidad === 1 ? "1 respaldo" : `${e.cantidad} respaldos`;
  console.log(`\nEn ${e.carpeta} hay ${plural} (${tamano(e.bytesTotales)}).\n`);
}

main()
  .catch((e) => {
    console.error("\n" + (e instanceof Error ? e.message : String(e)) + "\n");
    process.exit(1);
  })
  .finally(() => db.$disconnect());
