# ADR-005 — Convención de unidades y precisión del costo

**Fecha:** 2026-07-30 · **Estado:** Vigente · **Cierra:** brecha transversal de CAT-04, CAT-05, INV-05

## Contexto

Dos problemas distintos que se tocan:

1. **La convención de cantidades era asimétrica.** `PurchaseItem.qtyMilli`
   decía "en la unidad de compra", `StockMovement.qtyMilli` estaba en unidad
   base y `SaleItem.qtyMilli` no decía nada. Tres tablas, tres significados,
   un solo nombre de campo.
2. **El costo unitario en `Int` de pesos pierde precisión.** Una caja de 1.000
   tarugos (unidad `Millar`, `factorMilli = 1.000.000`) a $3.500 netos da $3,5
   por tarugo. Guardado como entero de pesos son $3 o $4: **14% de error** en
   el margen de un producto que se vende de a uno.

## Decisión

**Cantidades — el nombre del campo dice el denominador, siempre:**

| Sufijo | Significa | Dónde |
|---|---|---|
| `qtyBaseMilli` | milésimas de la **unidad base** del grupo | `StockMovement`, `StockLevel`, `reorderLevelBaseMilli` |
| `qtyMilli` | milésimas de la unidad de **esa línea**, dada por su `unitId` | `SaleItem`, `PurchaseItem`, `SuspendedSaleItem` |

`qtyBaseMilli = round(qtyMilli × unit.factorMilli / 1000)`. La conversión
ocurre **una vez**, al escribir el movimiento, y queda congelada en el libro.

**Dinero — dos categorías, y también se distinguen por el nombre:**

| Categoría | Tipo | Dónde |
|---|---|---|
| Montos (plata que cambia de manos) | `Int`, pesos exactos | todo lo demás |
| Razones (costo por unidad) | `Int`, **milésimas de peso**, sufijo `MilliPeso` | `Product.costNetMilliPeso`, `StockMovement.balanceCostNetMilliPeso` |

Solo esos **dos** campos son razones. El sufijo `MilliPeso` es verboso a
propósito: `Milli` a secas ya significa "milésimas de unidad base" y usarlo
para dos denominadores distintos en el mismo archivo reintroduciría exactamente
el defecto que esta decisión cierra.

**El libro guarda el monto exacto, no la razón.** `StockMovement.totalCostNet`
es la plata neta que representa el movimiento, en pesos, con signo.

**La venta congela `SaleItem.lineCostNet`**: el costo neto exacto de la línea
completa, en pesos.

## Alternativa descartada

Guardar un costo por unidad en el libro y multiplicar al leer. Acumula error de
redondeo **por movimiento**, así que el PMP recalculado por el job de
reconciliación no coincidiría con el cacheado y el job acusaría divergencias
falsas justo donde debe ser confiable.

También se descartó guardar dos cantidades por línea (`qtyUnitMilli` +
`qtyBaseMilli`): dos columnas que deben concordar, que la base no puede
conciliar y que se consumen por caminos distintos —el ticket una, el kardex la
otra— es una discrepancia que no se manifestaría en ninguna pantalla.

## Fórmula del costo promedio ponderado

No estaba escrita en ninguna parte, y "recalcular el PMP" admite lecturas que
dan números distintos. Es esta, y solo esta:

```
saldoNuevo = saldoAnterior + qtyBaseMilli            (qtyBaseMilli > 0)

valorAnterior = saldoAnterior × costNetMilliPeso / 1.000.000   (en pesos)
valorNuevo    = valorAnterior + |totalCostNet|

costNetMilliPeso = round(valorNuevo × 1.000.000 / saldoNuevo)
```

**Corregido el 2026-07-30 (Sprint 0).** La primera versión de esta fórmula
dividía `valorAnterior` por 1.000 en vez de 1.000.000. Hay **dos** denominadores
en juego —el saldo está en milésimas de unidad base y el costo en milésimas de
peso por unidad base—, así que el valor en pesos divide por el producto de
ambos. El error no se ve en la primera compra, porque parte de saldo cero y
`valorAnterior` vale 0; aparece en la segunda, inflando el costo mil veces:
comprar 100 m a $1.000 y luego 100 m a $2.000 daba $501.000 por metro en vez de
$1.500. Lo detectó el test `promedia dos compras a distinto precio` al escribir
`packages/shared/src/money.ts`, no la lectura del documento.


Reglas que la acompañan:

- **Solo la recalculan los movimientos que ingresan**: `PURCHASE`, `RETURN_IN`,
  `INITIAL`, `TRANSFER_IN` y `ADJUSTMENT` positivo. Los que sacan (`SALE`,
  `SHRINKAGE`, `TRANSFER_OUT`, `ADJUSTMENT` negativo) **no la tocan**: sacar
  mercadería no cambia lo que costó la que queda.
- **Si `saldoNuevo` es cero o negativo, el PMP no se toca.** Sin esa guarda hay
  división por cero, y el saldo negativo es alcanzable a propósito
  (`stock.allowNegative`).
- **Si `saldoAnterior` es cero o negativo**, el PMP pasa a ser el costo del
  movimiento que entra, sin promediar con un saldo que no existe.
- `totalCostNet` de cada tipo que ingresa:
  `PURCHASE` → lo facturado por el proveedor · `RETURN_IN` → el costo prorrateado
  de la línea devuelta (ADR-002) · `INITIAL` → el costo declarado en la carga
  inicial, que es obligatorio · `ADJUSTMENT` positivo y `TRANSFER_IN` → el PMP
  vigente, porque aparecer en un conteo no es comprar.

## Consecuencias

- El margen se calcula con dos números exactos y sin divisiones:
  `round(brutoLinea / (1 + taxRatePercent/100)) − lineCostNet`, donde
  `brutoLinea` ya descontó la parte proporcional del descuento de cabecera.
- La fórmula del encabezado del schema y la decisión sellada correspondiente de
  `STATE.md` se actualizaron. Un renombre que deja la fórmula vieja viva en un
  comentario es un error que `prisma validate` **no puede** detectar.
- `Unit.factorMilli` es **inmutable** una vez que la unidad tiene movimientos:
  cambiarlo reescribiría el significado de todo el kardex histórico. Si un
  proveedor cambia el formato del envase, se crea una unidad nueva.
- Invariante de Zod: `Product.saleUnit` y `Product.purchaseUnit` deben ser del
  mismo `UnitGroup`, y el `unitId` de cada línea también.
- `UnitGroup.allowsFraction` en `false` (solo `CONTEO`) rechaza cantidades que
  no sean múltiplo de 1000: medio tornillo no existe.
- Se siembra un cuarto grupo, `VOLUMEN` (base litro), aunque hoy no se use. Sin
  él, el día que entre diluyente a granel alguien lo mete en `PESO` asumiendo
  "1 litro = 1 kilo". El diluyente pesa 0,87 kg/L: el kardex mentiría un 13% y
  nadie se enteraría, porque la conversión *funciona*, solo que sobre la
  magnitud equivocada.
