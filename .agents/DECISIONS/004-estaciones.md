# ADR-004 — La estación es una tabla, y la sesión única la impone la BD

**Fecha:** 2026-07-30 · **Estado:** Vigente · **Cierra:** una brecha estructural de POS-01/POS-12

## Contexto

`stationId` era `String` libre en `CashSession` y `PrintJob`. `"CAJA-1"`,
`"Caja 1"` y `"caja-1"` son tres cajas distintas para la base de datos, y el
cierre de caja agrupa por ese campo. Era el criterio opuesto al que se usó para
`Location`, que se hizo tabla desde el día uno justamente para no pagar ese
refactor después.

Además, "una sola sesión abierta por estación" estaba enunciado en el plan pero
nada lo imponía.

## Decisión

1. Tabla `Station` (`name` único, `locationId`, `active`, `printerTarget`).
   `CashSession.stationId` y `PrintJob.stationId` pasan a ser relaciones.
2. `CashSession.openStationId Int? @unique` — vale `stationId` mientras la
   sesión está abierta, `NULL` cuando se cierra. SQLite no hace colisionar los
   `NULL` entre sí, así que el índice único impide dos sesiones abiertas con el
   mismo marcador.
3. **Más dos `CHECK` en la migración inicial**, porque el índice único **solo no
   alcanza** (ver Consecuencias):
   ```sql
   CHECK ("openStationId" IS NULL OR "openStationId" = "stationId")
   CHECK (("closedAt" IS NULL) = ("openStationId" IS NOT NULL))
   ```
4. **Se elimina `CashSession.status`.** `openStationId` es la única señal de
   abierta/cerrada.

## Alternativa descartada

Imponer el invariante con una transacción `BEGIN IMMEDIATE`. Prisma 6 sobre
SQLite abre las transacciones en modo diferido, no expone `isolationLevel` en
este conector, y un `BEGIN IMMEDIATE` por raw no compone con el pool de
conexiones. El candado de aplicación no era emitible; el índice único sí.

También se descartó una tabla `Device` para registrar los navegadores: la
estación se elige al iniciar sesión y viaja en el token. Registrar dispositivos
es un problema que la ferretería no tiene.

## Consecuencias

- **El índice único solo no bastaba, y conviene decirlo porque la primera
  versión de este ADR afirmaba que sí.** Probado contra SQLite: sin los `CHECK`
  se pueden abrir *tres* sesiones en la misma caja —basta dejar `openStationId`
  nulo con `closedAt` nulo— y una sesión de CAJA-1 puede marcar CAJA-2,
  bloqueando una estación que no tiene sesión. El índice único impone que no
  haya dos marcadores iguales; los `CHECK` imponen que el marcador **signifique**
  lo que dice significar.
- Con los tres puestos, verificado: abrir sin marcador → rechazado; marcar otra
  estación → rechazado; segunda sesión en la misma caja → rechazado; dos cajas
  distintas a la vez → funciona; cerrar dejando el marcador → rechazado; cerrar
  bien y reabrir → funciona.
- Se elimina `status` **para que el drift no sea representable**. Con `status`,
  `closedAt` y `openStationId` conviviendo habría tres fuentes de verdad para la
  misma pregunta. Y con los `CHECK`, la equivalencia
  `closedAt IS NULL ⟺ openStationId IS NOT NULL` deja de ser un invariante a
  cargo de la aplicación: la impone la base.
- `Station.printerTarget` es a dónde salen los tickets: hoy el nombre del
  recurso compartido de Windows de la térmica USB; mañana `host:9100` cuando
  llegue una Ethernet. Antes no había dónde guardarlo, aunque el plan de
  impresión dependía de eso.
- `Station.locationId` es configuración editable, mientras que `Sale.locationId`
  es un hecho histórico congelado. **No son el mismo dato** y no se derivan uno
  del otro fuera del instante de la venta.
- El seed crea una estación (`CAJA-1`). Un terminal de consulta que no vende
  no necesita estación con impresora: `printerTarget` queda nulo.
