# SEED.md — Datos iniciales (tarea 0.4 del Sprint 0)

> Qué filas existen antes de que alguien cargue el primer producto.
> El seed es **idempotente**: se puede correr N veces sin duplicar nada, y
> **nunca pisa** lo que el dueño ya configuró.

## 1. Grupos de unidades

| Grupo | Unidad base | `allowsFraction` |
|---|---|---|
| PESO | Kilogramo | sí |
| LONGITUD | Metro | sí |
| CONTEO | Unidad | **no** — medio tornillo no existe |
| VOLUMEN | Litro | sí |

**Por qué VOLUMEN aunque hoy no se use:** sin él, el día que entre diluyente a
granel alguien lo mete en PESO asumiendo "1 litro = 1 kilo". El diluyente pesa
0,87 kg/L — el kardex mentiría un 13% y nadie se enteraría, porque la conversión
*funciona*, solo que sobre la magnitud equivocada.

**Por qué SUPERFICIE no:** su modo de fallar es benigno. Quien cargue cerámica
sin grupo m² la va a poner en CONTEO como "caja", y eso es correcto mientras la
caja no se abra. El día que se venda el m² suelto, un grupo nuevo es un INSERT,
no una migración.

## 2. Unidades

`factorMilli` = cuántas milésimas de la unidad base vale una de estas. La base
vale exactamente 1000.

Hay **dos clases** de unidad no base, y confundirlas es el bug clásico de este
módulo:

- **CONVERSIÓN** (`factorMilli ≠ 1000`) → el envase se abre y el contenido se
  vende fraccionado.
- **ALIAS** (`factorMilli = 1000`) → el envase nunca se abre; existe para que el
  ticket diga "3 planchas" en vez de "3 un".

Regla para decidir: *¿se puede vender una parte del envase?* Sí → conversión, en
el grupo de la magnitud del contenido. No → alias en CONTEO.

| Grupo | Nombre | Símbolo | `factorMilli` | Base | Para qué |
|---|---|---|---|---|---|
| PESO | Kilogramo | kg | 1.000 | ✅ | clavos, electrodos, alambre a granel |
| PESO | Saco 25 kg | sc25 | 25.000 | | cemento, cal, mortero, yeso |
| PESO | Caja 20 kg | cj20 | 20.000 | | electrodos: se compra caja, se vende por kilo |
| PESO | Caja 5 kg | cj5 | 5.000 | | clavos y tornillos a granel |
| LONGITUD | Metro | m | 1.000 | ✅ | cable, cadena, manguera, pita |
| LONGITUD | Rollo 100 m | rl100 | 100.000 | | cable eléctrico |
| LONGITUD | Rollo 50 m | rl50 | 50.000 | | cable, manguera |
| LONGITUD | Rollo 25 m | rl25 | 25.000 | | manguera de jardín |
| LONGITUD | Tira 6 m | tr6 | 6.000 | | tubo PVC, perfil, fierro **que se corta** |
| LONGITUD | Tira 3 m | tr3 | 3.000 | | tubo PVC sanitario |
| CONTEO | Unidad | un | 1.000 | ✅ | todo lo que se cuenta |
| CONTEO | Par | par | 2.000 | | guantes |
| CONTEO | Docena | doc | 12.000 | | brocas, discos de corte |
| CONTEO | Caja 100 un | cj100 | 100.000 | | tornillos, tarugos |
| CONTEO | Caja 50 un | cj50 | 50.000 | | |
| CONTEO | Caja 25 un | cj25 | 25.000 | | |
| CONTEO | Bolsa 10 un | bl10 | 10.000 | | tarugos, terminales |
| CONTEO | Millar | mil | 1.000.000 | | tarugos, remaches |
| CONTEO | Plancha | pl | 1.000 | | *alias*: zinc, OSB, terciado, yeso-cartón |
| CONTEO | Tarro | tarro | 1.000 | | *alias*: pintura y pasta muro **selladas** |
| CONTEO | Balde | balde | 1.000 | | *alias*: pintura 4 gl sellada |
| CONTEO | Tira | tira | 1.000 | | *alias*: perfil/fierro que se vende **entero** |
| VOLUMEN | Litro | L | 1.000 | ✅ | diluyente, aguarrás, cloro a granel |
| VOLUMEN | Bidón 20 L | bd20 | 20.000 | | así se compra el diluyente |
| VOLUMEN | Bidón 5 L | bd5 | 5.000 | | |

**"Tira" aparece dos veces y no es un error:** en LONGITUD es la tira de 6 m que
se corta; en CONTEO es el perfil que se vende entero. Son dos productos distintos
del mundo real.

**La pintura en tarro sellado no va en VOLUMEN:** cada formato (¼ gl, 1 gl, 4 gl)
es un SKU propio en CONTEO con alias "Tarro" o "Balde", igual que decidió CAT-10.

## 3. Ubicación y estación

| Tabla | Fila |
|---|---|
| `Location` | `Local`, `isDefault = true` |
| `Station` | `CAJA-1`, en `Local`, `printerTarget` = la térmica compartida del servidor |

Nombre de estación canónico `CAJA-<n>`, en mayúsculas y sin espacios, validado
con Zod.

## 4. Usuarios

| id | Nombre | Rol | Notas |
|---|---|---|---|
| 1 | Sistema | `SYSTEM` | `active = false` y hash imposible. Es el autor de lo que hacen los jobs |
| 2 | Cristian | `ADMIN` | |
| 3 | Vendedor Mesón | `SELLER` | |

**Nunca un PIN por defecto en el repositorio.** O viene por variable de entorno,
o se genera al azar y se imprime **una sola vez** en la consola de instalación.
Si el usuario ya existe, el seed no lo toca: jamás pisar un PIN que el dueño ya
cambió.

`SYSTEM` no es un adorno: `AuditLog.userId` y `StockMovement.userId` son
obligatorios, y el job de reconciliación, las alertas y el importador no tienen
un humano detrás. Sin esa fila, o el campo se vuelve opcional —y se pierde la
trazabilidad— o los jobs no pueden escribir en el libro. El login rechaza
`role = SYSTEM` antes de comparar el hash.

El vendedor se siembra aunque el sprint solo pida el admin: la demo de cierre del
Sprint 0 dice "entra con PIN de vendedor y ve otro menú", y sin esa fila el
sprint no puede cerrar.

## 5. Contadores

| `name` | `value` |
|---|---|
| `product.sku` | 0 → el primer SKU otorgado es `FH-00001` |

## 6. Settings

El valor por defecto y el tipo lógico viven **en un solo lugar**
(`packages/shared/settings.ts`, un registro `clave → Zod → default`); el seed
hace *upsert* desde ahí. Así el default no se duplica en dos archivos y
`getSetting<T>` valida contra el mismo esquema que sembró la fila. El *upsert* no
actualiza: el seed no pisa lo que el admin ya configuró.

| Clave | Inicial | Tipo |
|---|---|---|
| `store.name` | `Ferrehouse` | texto |
| `tax.rate` | `19` | entero (%) |
| `cash.roundTo` | `10` | entero |
| `stock.allowNegative` | `false` | booleano |
| `stock.adminOverride` | `true` | booleano |
| `discount.maxSeller` | `5` | entero (%) — se evalúa sobre el total de la venta |
| `alert.cashDiffLimit` | `2000` | entero (pesos) |
| `ui.showLocations` | `false` | booleano |
| `sku.prefix` | `FH-` | texto |
| `sku.padding` | `5` | entero |
| `pos.suspendedStaleHours` | `48` | entero |
| `print.maxAttempts` | `3` | entero |
| `whatsapp.maxAttempts` | `5` | entero |
| `whatsapp.template` | `Hola {nombre}, gracias por tu compra en Ferrehouse...` | texto |
| `backup.dir` | `respaldos` | texto — relativa va junto a la base; absoluta manda |
| `backup.copyTo` | *(vacío)* | texto — pendrive o nube. Vacío = sin copia externa |
| `backup.keepDays` | `30` | entero (días) |
| `backup.hour` | `13` | entero (0-23) |

**`backup.copyTo` nace vacío a propósito.** No hay un valor por defecto
razonable —la letra del pendrive cambia de PC en PC— y adivinar uno haría que el
panel dijera "copia al día" apuntando a una carpeta que no existe. Vacío, el
panel dice la verdad: el respaldo está solo en este PC.

**No existe `location.default`**: duplicaba `Location.isDefault`. Dos fuentes de
verdad para la misma cosa siempre terminan discrepando, y gana la que está
protegida por clave foránea.

## 7. Autochequeos al arrancar

El servidor verifica al partir, y se niega a arrancar si algo falla:

- Exactamente una `Location` con `isDefault = true`.
- Exactamente una `Unit` con `isBase = true` por grupo.
- El usuario `SYSTEM` existe y está inactivo.
- Todas las claves del registro de settings tienen fila.
