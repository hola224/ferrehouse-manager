/**
 * Cargar el `.env` y comprobar que la clave de firma es de verdad.
 *
 * ESTO EXISTE PORQUE HOY FUNCIONA POR CASUALIDAD. Nadie en el código llama a
 * dotenv: el `.env` lo lee el cliente de Prisma como efecto secundario al
 * importarse, y de ahí salen también `JWT_SECRET` y `PORT`. Prisma ya avisa en
 * cada corrida que esa carga automática se va en la versión 7.
 *
 * El día que se vaya, el modo de fallar es el peor posible: el servidor arranca
 * igual, la pantalla entra igual, todo funciona igual — pero `JWT_SECRET` cae
 * al valor por omisión de `app.ts`, que está escrito en el repositorio y por lo
 * tanto es público. Cualquiera en la red de la tienda se firma un token de
 * administrador y nada en ningún log dice que algo cambió.
 *
 * Así que la carga se hace explícita acá, y además se comprueba: sin clave
 * propia el servidor no arranca. Es la misma postura que el resto de los
 * autochequeos —negarse antes que arrancar mintiendo—, aplicada a lo único que
 * separa la caja de la ferretería de cualquier PC de la LAN.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** `apps/server/.env`, tanto desde `src/` (tsx) como desde `dist/` (node). */
export const ARCHIVO_ENV = fileURLToPath(new URL("../.env", import.meta.url));

/** Los valores de ejemplo del repositorio. Ninguno puede llegar a la tienda. */
const PUBLICOS = new Set(["cambiar", "cambiar-en-instalacion", "dev-solo-para-desarrollo", "test-secret"]);

/**
 * Lo que YA venía en el entorno le gana al archivo, que es al revés de lo que
 * hace `process.loadEnvFile` por su cuenta. Sin esta vuelta, cargar el `.env`
 * desde `db.ts` le pisaría a los tests el `DATABASE_URL` propio que les pone
 * `test-db-url.ts` y los 300 tests del servidor pasarían a correr contra la
 * base de la tienda, borrándola. También es lo que permite levantar una
 * segunda copia con `PORT=3001` sin editar ningún archivo.
 */
export function cargarEnv(archivo = ARCHIVO_ENV): boolean {
  if (!existsSync(archivo)) return false;
  const antes = { ...process.env };
  process.loadEnvFile(archivo);
  for (const [clave, valor] of Object.entries(antes)) {
    if (valor !== undefined) process.env[clave] = valor;
  }
  return true;
}

export function assertJwtSecret(secreto = process.env.JWT_SECRET): void {
  if (!secreto) {
    throw new Error(
      "Falta JWT_SECRET.\n" +
        `  Se lee de ${ARCHIVO_ENV}\n` +
        "  Sin esa clave el servidor firmaría las sesiones con un valor público.",
    );
  }
  if (PUBLICOS.has(secreto)) {
    throw new Error(
      "JWT_SECRET todavía tiene el valor de ejemplo del repositorio.\n" +
        `  Está escrito en ${ARCHIVO_ENV}\n` +
        "  Es público: con él, cualquiera en la red de la tienda se firma un token de administrador.\n" +
        "  Genera uno nuevo:  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
  /**
   * 32 caracteres y no 8: el ataque acá no es adivinar a mano, es probar
   * offline contra un token capturado, y ahí una clave corta se cae en
   * minutos. El instalador genera 64.
   */
  if (secreto.length < 32) {
    throw new Error(
      `JWT_SECRET tiene ${secreto.length} caracteres; hacen falta al menos 32.\n` +
        `  Está en ${ARCHIVO_ENV}\n` +
        "  Genera uno:  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }
}
