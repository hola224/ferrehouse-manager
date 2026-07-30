# ADR-002 — Una venta admite varias devoluciones parciales

**Fecha:** 2026-07-30 · **Estado:** Vigente · **Cierra:** POS-10, POS-11

## Contexto

`Sale.reversesId` era `@unique`, lo que permitía revertir cada venta **una
sola vez**. POS-11 exige devolución total *o parcial*, marcada MVP. Caso real:
el cliente devuelve las llaves el martes y 3 m de cable el jueves — la segunda
devolución era imposible de representar.

## Decisión

- `reversesId` deja de ser `@unique`; `reversedBy` pasa a `Sale[]`.
- `Sale.reversalKind`: `VOID` (anulación total) | `RETURN` (devolución total o
  parcial). `NULL` en una venta normal.
- **`SaleItem.reversesSaleItemId`**: cada línea de devolución apunta a la línea
  exacta que revierte.
- **No existe** un estado `PARTIALLY_RETURNED`.

## Alternativa descartada

Agregar `PARTIALLY_RETURNED` a `Sale.status`. Es la trampa opuesta a la de
ADR-001: una venta parcialmente devuelta **sigue siendo una venta real** por su
monto original, así que cualquier reporte que filtrara `status = 'COMPLETED'`
**subcontaría** los ingresos. El estado parcial se deriva mirando las filas de
reversa que apuntan a la venta.

## Consecuencias

- **Regla de los reportes de plata: suman todas las filas, sin filtrar por
  estado.** El par original + reversa suma exactamente cero, así que la
  anulación se neutraliza sola y ningún período ya cerrado se altera nunca.
  Esta regla reemplaza cualquier filtro por `status`, y es más simple de
  sostener que recordar un filtro en cada consulta.
- `reversesSaleItemId` no es un lujo: sin él, el invariante "no se devuelve más
  de lo que se vendió" es **inaplicable**. Si el mismo producto aparece dos
  veces en la venta original con distinto precio o descuento, emparejar por
  `productId` es ambiguo y no hay forma de saber cuánto queda por devolver de
  cada línea.
- Invariante acumulado (Zod, la BD no puede imponerlo): para cada
  `SaleItem` original, `Σ |qtyMilli|` de las líneas que lo revierten
  **nunca supera** su `qtyMilli`. Se evalúa dentro de la transacción de la
  devolución, no antes.
- El redondeo a $10 de la venta original **no se devuelve proporcionalmente**:
  la devolución calcula su propio ajuste sobre su propia pata de efectivo,
  con la misma regla de ADR-003. Prorratear centavos de redondeo entre líneas
  descuadra la caja sin que nadie entienda por qué.
- **La línea de devolución usa el mismo `unitId` que la línea que revierte.**
  Sin esa regla, el invariante acumulado compararía milésimas de denominadores
  distintos: devolver "3" contra una venta de "1 rollo" pasaría el chequeo
  creyendo que son 3 rollos de 1, o 3 metros de 100.000 milésimas.
- **`lineCostNet` de una devolución parcial se prorratea** a prorrata de la
  cantidad devuelta:
  `costoDevuelto = round(lineCostNetOriginal × qtyDevuelta / qtyOriginal)`,
  con **signo negativo**. En la última devolución que agota la línea, el costo
  no se prorratea: se usa **el residuo** de lo que quedaba sin devolver, para
  que la suma de las devoluciones sea exactamente igual al costo original y no
  quede un peso colgando por redondeo.
- **Anular (`VOID`) una venta que ya recibió devoluciones parciales** revierte
  solo **lo que queda vivo**: por cada línea, `qtyMilli − Σ(ya devuelto)`, y su
  costo es el residuo pendiente. Si no queda nada vivo, la anulación se rechaza
  porque no hay nada que anular. Sin esta regla, o se devuelve la plata dos
  veces o la venta queda inanulable.
- Una devolución contra una venta ya anulada (`VOID`) se rechaza: la anulación
  ya devolvió todo lo que quedaba.
- **Fórmula del PMP** (la misma en todos los casos, ver ADR-005).
