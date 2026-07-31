# Ferrehouse Manager

Gestión para una ferretería en Concepción: punto de venta, inventario y caja.
Corre **en local**, sobre un PC con Windows que hace de servidor; los terminales
entran por navegador en la LAN.

## Cómo levantarlo

```bash
pnpm install
cp .env.example apps/server/.env      # y editar JWT_SECRET
pnpm --filter @ferrehouse/shared build
pnpm --filter @ferrehouse/server exec prisma generate
pnpm --filter @ferrehouse/server exec prisma migrate deploy
pnpm db:seed                          # imprime los PIN UNA sola vez: anótalos
pnpm dev                              # servidor en :3000, web en :5173
```

## Antes de tocar nada

| Documento | Qué contiene |
|---|---|
| [`STATE.md`](STATE.md) | Decisiones selladas. **Leer completo antes de escribir código.** |
| [`SPRINTS.md`](SPRINTS.md) | El plan. Es la única fuente. |
| [`UI-BRIEF.md`](UI-BRIEF.md) | Todo lo visual. Manda sobre cualquier intuición estética. |
| [`.agents/DECISIONS/`](.agents/DECISIONS/) | Los ADR: por qué las cosas son como son |
| [`BITACORA.md`](BITACORA.md) | Qué se hizo y qué se aprendió, sprint por sprint |

## Trampas que ya costaron caro

1. **`connection_limit=1` en `DATABASE_URL` no es cosmético.** Sin él, dos ventas
   simultáneas del mismo producto corrompen el saldo del libro de stock sin dar
   error. El servidor se niega a arrancar si falta.
2. **La migración inicial tiene dos `CHECK` agregados a mano** que Prisma no
   genera. `prisma migrate dev` y `prisma db push` los borran en silencio y el
   invariante de caja vuelve a estar suelto. Usar `migrate deploy`. El test
   `prisma/migracion.test.ts` es la única alarma.
3. **Prisma 6, no 7.** Con la 7 el schema no valida.
4. **El vendedor no ve costos, y eso se impone en el servidor**, no en la
   pantalla: un hook global filtra los campos antes de serializar.
5. **Todo redondeo es simétrico respecto del signo.** `Math.round` no lo es, y
   con él una venta y su anulación no suman cero.

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm check` | Todo lo que corre el CI |
| `pnpm check:offline` | Falla si algo depende de internet |
| `pnpm check:tokens` | Falla si hay un color fuera de `tokens.css` |
| `pnpm test` | Tests de todos los paquetes |
| `pnpm db:seed` | Siembra idempotente |
| `pnpm --filter @ferrehouse/server db:backup` | Respalda ahora (se puede con la tienda vendiendo) |
| `pnpm --filter @ferrehouse/server db:restore --lista` | Ver los respaldos; `--ultimo` restaura el más reciente |

**Instalar en la tienda:** [`instalacion/README.md`](instalacion/README.md) —
servicio de Windows, red, respaldo y restauración. La guía de una página para el
vendedor está en [`instalacion/GUIA-VENDEDOR.md`](instalacion/GUIA-VENDEDOR.md).

**El respaldo no es copiar `ferrehouse.db`.** La base corre en modo WAL: lo
recién escrito vive en el `-wal` hasta el checkpoint, y copiar solo el `.db` se
lleva una base vieja y consistente, que abre sin errores y sin las últimas
ventas. Se usa `VACUUM INTO`, y hay un test que hace la comparación.
