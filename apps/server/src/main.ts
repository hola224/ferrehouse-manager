import { buildApp } from "./app.js";
import { assertConnectionLimit, enableWAL, db } from "./db.js";
import { assertStartupChecks } from "./startup-checks.js";
import { iniciarWorker } from "./whatsapp/cola.js";

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

  const app = await buildApp();
  const port = Number(process.env.PORT ?? 3000);
  await app.listen({ port, host: "0.0.0.0" }); // 0.0.0.0: los terminales entran por la LAN
  console.log(`Ferrehouse Manager escuchando en http://0.0.0.0:${port}`);
}

main().catch(async (e) => {
  console.error("\n" + (e instanceof Error ? e.message : String(e)) + "\n");
  await db.$disconnect();
  process.exit(1);
});
