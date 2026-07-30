# ADR-003 — Vuelto, redondeo y cuadratura de pagos

**Fecha:** 2026-07-30 · **Estado:** Vigente · **Cierra:** POS-06, refuerza POS-05

## Contexto

`SalePayment.amount` era el único campo de plata del pago, y POS-06 exige
calcular vuelto. Venta de $17.500 y el cliente paga con $20.000: si
`amount = 20000` la suma de pagos deja de cuadrar con el total y el reporte por
medio de pago se infla $2.500 cada vez; si `amount = 17500` cuadra, pero se
pierde cuánto efectivo entró físicamente al cajón, que es justo lo que el
arqueo necesita.

## Decisión

`SalePayment.amount` es **siempre lo imputado a la venta**. Se agregan dos
campos, **obligatorios en toda pata `CASH`** (haya vuelto o no) y nulos en el
resto de los medios:

- `receivedAmount` — el billete que puso el cliente
- `changeAmount` — `receivedAmount − amount`, la plata que volvió

Si el cliente paga justo, `receivedAmount = amount` y `changeAmount = 0`.
**Nunca `NULL`**: el arqueo suma esos campos y SQL descarta las filas nulas, así
que veinte pagos justos desaparecerían del cierre y el turno acusaría un
faltante igual a casi toda la venta en efectivo del día. El pago exacto en
efectivo es la transacción más común del mesón.

**El redondeo es simétrico respecto del signo:**

```
round10(x) = signo(x) × round(|x| / 10) × 10
```

Redondear "medio hacia arriba" a secas parece equivalente y no lo es: una pata
de $17.495 redondearía a $17.500 y su contraria a −$17.490, dejando el par
venta + anulación debiendo **$10**. Como los reportes de plata suman todas las
filas sin filtrar por estado (ADR-002), ese residuo se quedaría en el total del
día para siempre. Con la versión simétrica el par suma exactamente cero.

La **regla** de redondeo es fija; el **múltiplo** es el setting `cash.roundTo`
(hoy 10), porque la moneda de $10 puede desaparecer como desaparecieron las de
$1 y $5. Lo que no es configurable es el criterio de desempate: dos reglas de
redondeo conviviendo son descuadres que nadie va a diagnosticar.

En una venta **mixta el redondeo se aplica a la pata de efectivo**, nunca al
total: las patas con tarjeta se cobran al peso exacto porque Transbank no
redondea.

## Consecuencias

- Ecuación de cuadratura, válida para toda venta:
  `Σ SalePayment.amount = Sale.totalGross`
  `Sale.totalGross = subtotalGross − discountAmount + roundingAmount`
- Movimiento de caja de una venta:
  `CashMovement.amount = Σ (receivedAmount − changeAmount)` de las patas `CASH`
  `= Σ amount` de las patas `CASH`. Las dos formas dan el mismo número; el
  arqueo puede usar cualquiera.
- Si no hay pata en efectivo, `roundingAmount` es 0. Una venta pagada entera
  con tarjeta no se redondea.
- Si la pata de efectivo redondea a $0 (residuo de $1 a $4), **no se crea fila
  de pago en efectivo**: el residuo se absorbe en `roundingAmount` y la venta
  queda pagada solo con tarjeta. Una fila de $0 en el cajón es una mentira
  contable.
- Ejemplo trabajado (verificado): venta $17.493, paga $10.000 con débito.
  Pata de efectivo ideal $7.493 → redondeada $7.490, `roundingAmount = −3`,
  `totalGross = $17.490`. Con un billete de $10.000 el vuelto es $2.510 y al
  cajón entran $7.490.
- Las devoluciones en efectivo son plata que **sale** del cajón:
  `SalePayment.amount` negativo y `CashMovement.type = REFUND`. El movimiento
  va en la sesión de caja **abierta al momento de devolver**, no en la de la
  venta original, que puede llevar días cerrada.
- Por lo anterior, la reconciliación de caja compara el efectivo contra los
  movimientos de tipo `SALE` **y** `REFUND` juntos. Compararlo solo contra
  `SALE` acusa un descuadre falso cada vez que hay una devolución.
