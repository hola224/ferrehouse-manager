# ADR-001 — La venta en espera vive en tabla aparte

**Fecha:** 2026-07-30 · **Estado:** Vigente · **Cierra:** POS-08

## Contexto

POS-08 ("venta en espera") estaba marcado MVP en `USE-CASES.md` y agendado en
el sprint del POS, pero no existía en el modelo de datos: `Sale.status` solo
admitía `COMPLETED | REVERSED`. El caso es cotidiano — el cliente arma el
carro, dice "voy a buscar el otro fitting" y el mesón tiene que liberarse.

## Decisión

Dos tablas nuevas y aisladas: `SuspendedSale` y `SuspendedSaleItem`. Sin
`cashSessionId`, sin relación con `CashSession`, `CashMovement`,
`SalePayment` ni `StockMovement`.

Al recuperar la espera **los precios se re-leen** de `Product.priceGross`. La
línea guarda `unitPriceGrossAtHold` solo para mostrarle al vendedor el delta
("$1.290 → $1.390"), nunca para cobrar.

La espera **se edita y se borra de verdad** al recuperarla o descartarla.

## Alternativa descartada

Agregar `SUSPENDED` a `Sale.status` y hacer `cashSessionId` opcional. Es más
barata de migrar, pero convierte la corrección en disciplina: cada consulta de
venta, caja, kardex y reporte tendría que acordarse de filtrar
`status = 'COMPLETED'`, y un solo reporte que lo olvide infla las ventas del
día. Con tabla aparte el aislamiento es **estructural**: no existe columna por
la cual una espera pueda entrar a una consulta de plata o de stock.

## Consecuencias

- El arqueo del cierre no puede verse afectado aunque el turno termine con
  esperas colgadas. No hace falta ninguna regla que lo recuerde.
- Borrar no viola la decisión sellada de inmutabilidad: esa regla protege la
  historia de plata y de stock, y una espera nunca tocó ninguna de las dos —
  no tiene folio, no movió un peso ni una tuerca. Es un papelito del mesón.
  Lo innegociable es el rastro: suspender, recuperar y descartar escriben
  `AuditLog` en la misma transacción, y el descarte guarda las líneas en el
  `payload`.
- `touchedAt` la escribe la aplicación, **no** es `@updatedAt`: la forma normal
  de editar una espera es agregar o quitar líneas, y eso no dispara
  `@updatedAt` sobre la fila padre. La alerta de espera añeja mide `touchedAt`.
- La línea guarda `unitId`. Al recuperar se compara contra
  `Product.saleUnitId`: si cambió, la línea **no** se recupera en silencio.
  Sin esa comparación se cobraría el precio nuevo sobre una cantidad expresada
  en la unidad vieja — y las dos unidades pueden ser del mismo grupo (un rollo
  y un metro), así que ninguna validación de grupo lo detectaría.
- Sin `customerId` y sin descuentos guardados. Un descuento guardado es una
  *autorización* guardada, y la autorización no debe sobrevivir en un borrador
  que cualquier terminal levanta y al que se le pueden haber agregado líneas.
- El listado de esperas aparece en la pantalla y en el reporte de cierre de
  turno de forma **informativa**: se muestran, no se suman. Ningún total del
  arqueo las toca.
