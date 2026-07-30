# ADR-006 — Escrituras serializadas con una sola conexión

**Fecha:** 2026-07-30 · **Estado:** Vigente · **Cierra:** una brecha de concurrencia no detectada antes

## Contexto

`StockMovement.balanceBaseMilli` se calcula leyendo el saldo anterior y
sumándole el delta. Con 2-3 terminales vendiendo a la vez, dos ventas del mismo
producto pueden leer el mismo saldo y escribir dos balances iguales.

Hay que separar dos casos, porque no son igual de graves:

- **Leer y escribir fuera de una transacción** → las dos escrituras commitean y
  el libro queda corrupto **en silencio**: no hay error, solo dos filas que dicen
  que el saldo quedó en el mismo número.
- **Leer y escribir dentro de una `$transaction`** → Prisma abre la transacción
  en modo diferido, así que la segunda escritura choca y falla con
  `database is locked` (P2010). No se corrompe nada, pero la venta se cae.

Medido sobre este mismo schema con Prisma 6.19.3 y SQLite en WAL, 200
incrementos concurrentes del contador: con el pool por defecto, **156 exitosos y
44 caídos** con P2010; con `connection_limit=1`, **200 exitosos**. En ambos
casos, cero duplicados y cero huecos.

El mismo patrón afecta al correlativo del SKU y a la apertura de caja.

## Decisión

`connection_limit=1` en la URL de conexión:

```
DATABASE_URL="file:./ferrehouse.db?connection_limit=1"
```

Con una sola conexión en el pool, las transacciones de escritura se serializan
de verdad y el patrón leer-calcular-escribir es seguro sin candados explícitos.

## Alternativa descartada

Un mutex en proceso por `productId`. Adquirir varios candados por venta —una
venta toca varios productos— sin orden definido ni timeout produce
interbloqueo en la ruta más caliente del sistema. Un mutex global es
equivalente a `connection_limit=1` pero hay que mantenerlo a mano y no protege
al proceso del seed ni a los jobs.

## Consecuencias

- Elimina las dos variantes de una vez: la corrupción silenciosa y el
  `database is locked`.
- Es viable porque el sistema tiene 2-3 terminales, no 200 — a esa escala el
  pool por defecto tampoco falla, así que esto es el cinturón, no el tirante.
  Contrapartida a tener presente: **serializa también las lecturas**. Si alguna
  pantalla de reportes se pone lenta, es el primer sospechoso.
- `PRAGMA busy_timeout` no reemplaza esta decisión: es por conexión, y el pool
  tiene varias, así que aplicarlo por raw solo toca una de ellas.
- Vale para **todo** proceso que escriba: el servidor, el seed y los jobs.
- El importador de Excel reserva un rango de correlativos de golpe
  (`value = value + N`) en vez de pedir un número por fila. Con una sola
  conexión, 5.000 transacciones de una fila serían 5.000 esperas en cola.
- Si algún día el sistema deja de ser de una tienda, esta decisión se revisa
  junto con el motor: es una consecuencia de SQLite, no del dominio.
