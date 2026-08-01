# Ferrehouse Manager

Punto de venta, inventario y caja para una ferretería en Concepción, Chile.

Corre **entero en local**: un PC con Windows hace de servidor y los terminales
del mesón entran por navegador desde la LAN. No usa internet para funcionar —
hay una comprobación (`pnpm check:offline`) que falla si algo empieza a
depender de la red, porque la tienda no siempre la tiene.

> **Estado: listo para instalar.** El punto de venta, la caja, el kardex, las
> compras, las devoluciones, los reportes, la impresión de tickets ESC/POS y
> las alertas por WhatsApp andan y tienen pruebas. La instalación en el PC de
> la tienda es un doble clic: [`instalacion/`](instalacion/README.md).

## Levantarlo

Necesitas **Node 22 o superior** y **pnpm 9**.

```bash
git clone https://github.com/hola224/ferrehouse-manager.git
cd ferrehouse-manager
pnpm install
cp .env.example apps/server/.env
pnpm preparar   # compila, migra, siembra y carga el catálogo de prueba
pnpm dev        # servidor en :3000, web en :5173
```

> **Si esto va a una tienda, no lo instales a mano: usa
> [`instalacion/INSTALAR.exe`](instalacion/README.md).** Hace todo esto y además
> genera la clave, sortea los PIN, deja el arranque automático y crea el acceso
> directo.

> **Si aun así lo instalas a mano, cambia `JWT_SECRET` en `apps/server/.env`
> antes de nada.** El archivo de ejemplo trae `cambiar-en-instalacion`, y ese
> valor está publicado en este repositorio: cualquiera que lo lea puede firmar
> un token de administrador válido. Sirve cualquier cadena larga y al azar — por
> ejemplo `openssl rand -base64 48`. **El servidor se niega a arrancar** con la
> clave de ejemplo o con una de menos de 32 caracteres.

**En producción no hace falta Vite:** `pnpm build` y `node apps/server/dist/main.js`
sirven el API *y* la pantalla en el mismo puerto 3000. Los `:5173` de abajo son
solo del modo desarrollo.

Abre <http://localhost:5173> y entra con:

| Usuario | Rol | PIN |
|---|---|---|
| Administrador | ADMIN | `111111` |
| Vendedor | SELLER | `222222` |

> **Estos PIN son públicos.** Sirven para probar el proyecto recién clonado.
> Una tienda de verdad los define en `apps/server/.env` (`SEED_ADMIN_PIN` y
> `SEED_SELLER_PIN`) **antes** del primer `pnpm preparar`, o los cambia después
> desde Usuarios → Editar. El seed nunca pisa un usuario que ya existe.

`pnpm preparar` deja además un catálogo de demostración —productos con marcas,
proveedores, categorías, saldo en bodega e historia en el kardex— porque sin
productos media aplicación no se puede juzgar: el kardex es una pantalla en
blanco y el buscador de la venta no tiene qué sugerir. Es idempotente y **no**
es parte del seed: `pnpm db:seed` deja solo lo que una ferretería necesita para
existir.

## Cómo se usa

El mesón se opera **con teclado**. El foco vuelve siempre a la caja de escaneo,
y los atajos están impresos en pantalla:

| Tecla | En Venta |
|---|---|
| `F2` | Cobrar |
| `F4` | Descuento |
| `F6` | Dejar en espera |
| `F8` | Recuperar una espera |
| `↑` `↓` | Moverse entre las líneas |
| `Supr` | Quitar la línea |
| `Enter` | Agregar lo buscado; con la caja vacía, la cantidad de la línea elegida |

Dentro del cobro: `F2` efectivo, `F4` débito, `Enter` cobra. Se puede pagar una
parte con la máquina y el resto en efectivo — el saldo que falta y el vuelto se
calculan solos.

`F3`, `F5`, `F10` y `F11` no se usan: se las queda Chrome.

## Cómo está hecho

| | |
|---|---|
| Servidor | Node 22, Fastify 5, Prisma 6, SQLite en modo WAL |
| Web | React 18, Vite 5, Tailwind 3, TypeScript estricto |
| Monorepo | pnpm workspaces: `apps/server`, `apps/web`, `packages/shared` |

`packages/shared` no es una carpeta de utilidades sueltas: ahí viven las reglas
que la pantalla y el servidor **tienen que** calcular igual —el total de una
venta, el redondeo del efectivo, la conversión de unidades—. Tenerlas dos veces
es tenerlas mal.

## Trampas que ya costaron caro

1. **`connection_limit=1` en `DATABASE_URL` no es cosmético.** Sin él, dos
   ventas simultáneas del mismo producto corrompen el saldo del libro de stock
   sin dar error. El servidor se niega a arrancar si falta.
2. **La migración inicial tiene dos `CHECK` agregados a mano** que Prisma no
   genera. `prisma migrate dev` y `prisma db push` los borran en silencio y el
   invariante de caja vuelve a estar suelto. Usar `migrate deploy`. El test
   `prisma/migracion.test.ts` es la única alarma.
3. **Prisma 6, no 7.** Con la 7 el schema no valida.
4. **El vendedor no ve costos, y eso se impone en el servidor**, no en la
   pantalla: los campos no existen en su DOM, no están grises.
5. **Todo redondeo es simétrico respecto del signo.** `Math.round` no lo es, y
   con él una venta y su anulación no suman cero.
6. **Ningún color fuera de `apps/web/src/tokens.css`.** `pnpm check:tokens` lo
   vigila y no perdona ni un comentario.

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm preparar` | Compila `shared`, genera Prisma, migra, siembra y carga el catálogo de prueba |
| `pnpm dev` | Servidor y web, en paralelo |
| `pnpm check` | Todo lo que corre el CI: offline, tokens, typecheck y tests |
| `pnpm check:offline` | Falla si algo depende de internet |
| `pnpm check:tokens` | Falla si hay un color fuera de `tokens.css` |
| `pnpm test` | Tests de los tres paquetes |
| `pnpm db:seed` | Solo lo mínimo para existir. Idempotente |
| `pnpm db:demo` | Solo el catálogo de prueba. Idempotente |
| `pnpm --filter @ferrehouse/server db:backup` | Respalda ahora, con la tienda vendiendo |
| `pnpm --filter @ferrehouse/server db:restore --lista` | Ver respaldos; `--ultimo` restaura el más reciente |

**El respaldo no es copiar `ferrehouse.db`.** La base corre en modo WAL: lo
recién escrito vive en el `-wal` hasta el checkpoint, y copiar solo el `.db` se
lleva una base vieja y consistente —abre sin errores y sin las últimas ventas—.
Se usa `VACUUM INTO`, y hay un test que hace la comparación.

## Lo que falta

| Falta | Por qué importa |
|---|---|
| **Excel** | Importar y exportar catálogo andan; faltan los reportes exportables |

## Licencia

Sin licencia declarada todavía. Mientras no la haya, todos los derechos
reservados por el autor.
