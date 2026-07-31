import { buildApp } from "./app.js";
import { assertConnectionLimit, enableWAL, db } from "./db.js";
import { assertStartupChecks } from "./startup-checks.js";
import { iniciarWorker } from "./whatsapp/cola.js";
import { iniciarRespaldoDiario, detenerRespaldoDiario } from "./backup.js";

async function main() {
  // El orden importa: si falta connection_limit no tiene sentido seguir, y si
  // el seed está incompleto el servidor arranca y miente.
  assertConnectionLimit();
  const modo = await enableWAL();
  console.log(`base de datos: journal_mode=${modo}, connection_limit=1`);

  await assertStartupChecks();
  console.log("autochequeos: ok");

  /**
   * El worker de WhatsApp arranca acá y NO en `buildApp`: los tests construyen
   * la app decenas de veces, y un temporizador vivo por cada una las haría
   * pisarse entre ellas. Mientras no haya un número vinculado, cada pasada ve
   * "DESCONECTADA" y se va sin tocar nada.
   */
  iniciarWorker();

  /**
   * El respaldo diario, acá por la misma razón que el worker: un temporizador
   * por cada app construida en los tests las haría pisarse. La primera pasada
   * es inmediata, así que un PC que estuvo apagado tres días tiene su respaldo
   * a los segundos de encenderse, sin esperar a la hora configurada.
   */
  iniciarRespaldoDiario();

  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" }); // 0.0.0.0: los terminales entran por la LAN
  console.log(`Ferrehouse Manager escuchando en http://0.0.0.0:${port}`);

  /**
   * Apagado limpio (tarea 7.1). NSSM detiene el servicio mandando un Ctrl+C a
   * la consola, y Node sin este manejador se muere en el acto: la petición que
   * estuviera a medio responder se corta y el WAL queda sin checkpoint.
   *
   * Cerrar bien deja el `-wal` consolidado en el archivo, que es justo lo que
   * uno quiere antes de un reinicio por actualización de Windows — y hace que
   * copiar el `.db` a mano después de detener el servicio sí sirva, aunque no
   * sea el camino recomendado.
   */
  for (const senal of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.on(senal, () => {
      void (async () => {
        console.log(`\n${senal}: cerrando…`);
        detenerRespaldoDiario();
        try {
          await app.close();
          await db.$disconnect();
        } catch (e) {
          console.error("cerrando:", e);
        }
        process.exit(0);
      })();
    });
  }
}

main().catch(async (e) => {
  console.error("\n" + (e instanceof Error ? e.message : String(e)) + "\n");
  await db.$disconnect();
  process.exit(1);
});
