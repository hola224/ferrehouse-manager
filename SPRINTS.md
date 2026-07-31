# SPRINTS.md — Plan de desarrollo Ferrehouse Manager

> Modo: plan. Nada de esto está construido aún — salvo el schema, que ya está
> cerrado y validado (ver `BITACORA.md`, entrada del 2026-07-30).
> Los IDs (CAT-xx, POS-xx, etc.) refieren a USE-CASES.md.
> **Este documento es la única fuente del plan.** `STATE.md` solo apunta al sprint actual.
> Última actualización: 2026-07-30

## Marco de trabajo

- **Duración de sprint: 1 semana.** Con Claude Code implementando, el cuello de botella no es escribir código sino probar, decidir y corregir rumbo. Sprints cortos = correcciones baratas.
- **Regla de cierre:** cada sprint termina con algo que Cristian puede *tocar* — no con "avance de backend". Si no se puede demostrar en pantalla o en terminal, el sprint no cerró.
- **Orden de dependencias:** el kardex (S4) va *antes* que el POS venda de verdad contra stock (fin de S4), pero el POS se construye antes (S3) vendiendo contra un stock ficticio. Motivo: la pantalla de venta es donde van a aparecer los casos de uso imprevistos, y conviene descubrirlos temprano.
- **Cada sprint incluye sus tests.** No hay sprint de "testing" al final: eso es donde los planes van a morir.
- **El diseño no es un sprint, va repartido.** [`UI-BRIEF.md`](UI-BRIEF.md) manda sobre todo lo visual. Primero una **fundación visual** (tokens + tematizado + fuentes) que es un PR propio en S0, antes de cualquier pantalla; después **una pantalla clave por sprint** (S1 catálogo, S2 cierre, S3 venta, S4 kardex, S5 dashboard). Esas cinco pasan por wireframe aprobado por Cristian **antes** de codearse, y cada una cierra contra la *definition of done* visual del brief (§6). Las cinco puertas de aprobación cuestan medio día cada una: están dentro de las 9-10 semanas presupuestadas, no encima.
- **Los invariantes de aplicación se implementan en el sprint que los estrena, no después.** Están listados abajo, sprint por sprint. La base de datos no puede imponerlos y no hay una segunda oportunidad de agregarlos: si el kardex se llena de datos sin ellos, la corrección es una migración de datos.

---

## Sprint 0 — Fundaciones (Semana 1) ✅ cerrado el 2026-07-30

> Las 12 tareas entregadas y la demo corrida de punta a punta. Lo que se
> aprendió está en `BITACORA.md`; lo que quedó pendiente, al final del sprint.

**Objetivo:** repo funcionando, base de datos creada, login operativo. El "hola mundo" institucional.

| # | Tarea | Referencia |
|---|---|---|
| 0.1 | Crear repo `ferrehouse-manager`, monorepo pnpm (`apps/server`, `apps/web`, `packages/shared`) | — |
| 0.2 | Migración inicial desde `schema.prisma` (**ya validado**: 28 modelos, aplica limpio en SQLite). Fijar `prisma@^6` — con la 7 el schema no valida. **Editar la migración a mano para agregar los dos `CHECK` de `CashSession`**, que Prisma no genera y sin los cuales el invariante de caja no se sostiene: [`.agents/MIGRACION-INICIAL.md`](.agents/MIGRACION-INICIAL.md) | ADR-004 |
| 0.3 | `DATABASE_URL` con **`connection_limit=1`** y WAL activado. No es cosmético | ADR-006 |
| 0.4 | Seed completo — **las filas exactas están en [`.agents/SEED.md`](.agents/SEED.md)**: 4 grupos de unidades, 25 unidades, `Location` "Local", `Station` "CAJA-1", usuarios (admin, vendedor y SYSTEM), `Counter` de SKU y 14 settings | ADR-005 |
| 0.5 | Auth: login con PIN (argon2), JWT, roles ADMIN/SELLER. **Se elige usuario de una lista y luego se digita el PIN** — con dos vendedores, entrar solo con PIN atribuiría mal la auditoría al primero que calce. **La estación se elige al iniciar sesión y viaja en el token** | USR-01, USR-02, ADR-004 |
| 0.6 | Esqueleto React: layout, router, pantalla de login, guard por rol | — |
| 0.7 | `AuditLog` como servicio transversal desde el día uno. `entityId` es texto (`PrintJob` y `WhatsAppJob` tienen id uuid) | USR-04 |
| 0.8 | Helper tipado de settings (`getSetting<T>`) y registro central de claves. Son 14 y todas se leen como texto | — |
| 0.9 | Generador de SKU con reserva de rango (`Counter`), no un número por fila | ADR-006 |
| 0.10 | CI mínimo: typecheck + tests en cada push. **Más un chequeo que falle si aparece `fonts.googleapis` o `fonts.gstatic` en el bundle** | UI-BRIEF §4 |
| 0.11 | **Fundación visual, PR propio antes de cualquier pantalla**: `tokens.css` con las variables `--fh-*` del brief, shadcn tematizado con esos tokens, y las fuentes **Archivo + IBM Plex Mono en woff2 dentro del repo** (ambas **SIL OFL 1.1**, verificado el 2026-07-30: se redistribuyen dentro del repo sin problema; la única prohibición del OFL es venderlas por separado). Archivo tiene versión variable con eje de ancho, que es lo que el brief usa para los totales condensados. Ningún color hardcodeado en componentes | UI-BRIEF §3, §4 |
| 0.12 | **DTO por rol en `packages/shared`**: un solo lugar decide qué campos ve un `SELLER`. Los de costo se omiten al serializar, no al pintar | decisión sellada 17, USR-03 |

**Invariantes que estrena este sprint** (Zod / servicio, la BD no puede):
- Exactamente una `Location` con `isDefault = true`, y exactamente una `Unit` con `isBase = true` por grupo. Autochequeo al arrancar, que impide arrancar si falla.
- El usuario `SYSTEM` no puede iniciar sesión nunca: el login rechaza `role = SYSTEM` **antes** de comparar el hash.
- El seed es idempotente y **nunca pisa** lo que el dueño ya configuró: ni un PIN cambiado, ni un setting editado.
- Ningún PIN por defecto en el repositorio. O viene por variable de entorno, o se genera al azar y se imprime una sola vez en la consola de instalación.
- **Ninguna respuesta a un token `SELLER` contiene `costNetMilliPeso`, `lineCostNet`, `totalCostNet`, `balanceCostNetMilliPeso` ni datos de `Purchase`.** Se prueba con un test que golpea cada endpoint con token de vendedor y falla si esos nombres aparecen en el cuerpo. Ocultarlo en el frontend no es cumplirlo: el dato ya viajó y se ve en la pestaña de red.
- **Cero valores de color fuera de `tokens.css`.** Un `#` de color en un componente es un error de CI, no una observación de revisión: si se cuelan cinco, la dirección visual deja de ser cambiable.

**Demo de cierre:** Cristian entra con PIN de admin, ve un dashboard vacío; entra con PIN de vendedor y ve otro menú, **con la tipografía y el amarillo definitivos, y sin internet en la máquina**. El seed corre dos veces seguidas sin duplicar nada.

**Riesgo del sprint:** tentación de "avanzar pantallas" antes de que el seed y la auth estén sólidos. Resistir.

**Cómo cerró:** 12/12 tareas. 61 tests en verde (32 en `shared`, 26 en `server`,
3 en `web`). La demo se corrió completa: admin y vendedor entran con su PIN y
ven dashboards distintos desde el mismo endpoint, el seed corre dos veces sin
duplicar, y las fuentes se sirven desde el repo sin tocar internet.

**Verificado en pantalla** a 1366×768 con Chrome headless: login, dashboard de
admin (5 tarjetas) y dashboard de vendedor (2 tarjetas, sin equipo ni alertas),
con Archivo y el amarillo cargando desde el repo. La captura destapó un chip
"Caja cerrada" escrito a mano en el dashboard: la caja recién existe en el
Sprint 2, así que el sistema afirmaba en verde un estado que nadie había
verificado. Eliminado.

**Lo que queda pendiente, y no bloquea el Sprint 1:**
- Mirarlo en el **monitor real de la tienda**. Chrome headless confirma que
  renderiza y que las fuentes cargan; no que se lea a 1,5 m con el brillo y el
  ángulo del mesón.
- El `check:tokens` mira `apps/web/src`; si mañana hay colores en otro paquete,
  hay que ampliarlo.

---

## Sprint 1 — Catálogo (Semana 2) 🟡 servidor entregado el 2026-07-30

> Las 8 tareas de servidor están hechas y probadas. **Wireframe de la 1.7b
> aprobado por Cristian el 2026-07-30**, junto con las cuatro preguntas
> abiertas que quedaban. La interfaz ya no está bloqueada.

**Objetivo:** poder crear, buscar y etiquetar productos. Sin esto no hay nada que vender.

| # | Tarea | Referencia |
|---|---|---|
| 1.1 ✅ | CRUD de productos con unidad de compra/venta, precio bruto, costo (solo visible admin). **Crear un producto crea su fila de `StockLevel` en cero** para cada ubicación activa | CAT-01, CAT-04, USR-03 |
| 1.2 ✅ | Múltiples códigos de barra por producto | CAT-03 |
| 1.3 ✅ | Generador de SKU interno (`FH-00001`) + impresión de etiqueta Code128 | CAT-02 |
| 1.4 ✅ | Categorías, marcas, proveedores (CRUD simple) | CAT-06 |
| 1.5 ✅ | Búsqueda rápida: por escaneo, por nombre parcial, por SKU — **una sola caja de búsqueda** | POS-03 |
| 1.6 ✅ | Importador Excel: plantilla descargable, validación con reporte de errores por fila, carga en lote **con reserva de rango de SKU** | CAT-11 |
| 1.7 ✅ | Conversión de unidades en la UI: mostrar "se compra en Rollo 100 m, se vende en Metro" y validar que ambas sean del mismo grupo | CAT-04 |
| 1.7b ✅ | **Pantalla clave del sprint: búsqueda/catálogo.** Una sola caja que acepta escaneo, nombre parcial o SKU; resultados con precio y stock a la vista. Para el vendedor es solo lectura y **sin columna de costo**. Wireframe aprobado antes de codear | UI-BRIEF §5.3 |
| 1.8 ✅ | **CRUD de usuarios** (solo admin): crear, desactivar y cambiar PIN. El seed deja tres usuarios y ningún sprint permitía agregar un cuarto — si entra un vendedor nuevo, la alternativa era editar la base a mano | USR-01, USR-02 |

**Invariantes que estrena este sprint:**
- `saleUnit` y `purchaseUnit` de un producto son del **mismo `UnitGroup`**.
- Un usuario **no se borra nunca**: se desactiva. Sus ventas, movimientos de stock y auditoría lo referencian, y esas tablas son inmutables.
- Todo producto tiene fila en `StockLevel` para cada ubicación activa, aunque nunca se haya movido. Si no, el quiebre de stock (ALE-02) no lo ve y la validación de venta (INV-10) consulta un registro inexistente. La ausencia de fila se trata como saldo cero en toda lectura, por si acaso.
- Semántica de baja: `active = false` sale del POS pero sigue en el catálogo del admin; `deletedAt` lo saca de toda pantalla operativa. **El SKU nunca se reutiliza**, ni tras `deletedAt`: está impreso en etiquetas pegadas en la repisa.

**Demo de cierre:** se escanea un producto real de la ferretería y aparece; se cargan 50 productos desde Excel; se imprime una etiqueta y el lector la lee de vuelta.

**Cómo va:** 9 de 9 tareas de servidor y la pantalla clave. **172 tests en
verde.** La 1.7b se codeó después del ok de Cristian al wireframe y se verificó
en pantalla a 1366×768 con los dos roles: el admin ve costo y margen, el
vendedor no —ni las columnas ni los campos en el JSON—, el escaneo abre el
producto sin lista intermedia y los estados de stock salen con color **y**
palabra.

Quedan sin interfaz, y no bloquean la demo de búsqueda: el formulario de alta
de producto, la pantalla de importación y la de usuarios. Los tres endpoints
están y probados; les falta la pantalla.

**Lo que se agregó al plan sobre la marcha:**
- **`Product.searchKey`, con migración propia.** El `LIKE` de SQLite ignora
  mayúsculas solo en ASCII: sin una columna normalizada, buscar "caneria" no
  encuentra "Cañería" ni "CAÑERÍA". La 1.5 no se podía cumplir sin esto.
- **El costo se digita solo hasta el primer movimiento del producto.** Hasta el
  Sprint 4 no hay compras y el inventario inicial no tiene otra forma de cargar
  su costo; desde el primer movimiento lo manda el libro. La regla se apaga
  sola, sin que nadie tenga que acordarse.

**Lo que la 1.3 no puede cerrar desde acá:** que el lector lea de vuelta la
etiqueta impresa. Se genera el Code128 —verificado contra la especificación— y
el trabajo entra en la cola `PrintJob`, pero el worker que vacía la cola llega
en el Sprint 3 con el ticket, y el lector es físico.

---

## Sprint 2 — Caja (Semana 3) ✅ cerrado el 2026-07-30

> Las 8 tareas entregadas, incluida la pantalla clave. El **conteo ciego** se
> decidió y se implementó en el servidor, no en la pantalla.

**Objetivo:** el ciclo de la plata completo, sin ventas todavía. Apertura → movimientos → cierre con arqueo.

| # | Tarea | Referencia |
|---|---|---|
| 2.1 ✅ | Apertura de sesión de caja. **Una sola sesión abierta por estación la impone la BD** (`openStationId @unique`), no un chequeo previo | POS-01, ADR-004 |
| 2.2 ✅ | `CashMovement` con `balanceBefore`/`balanceAfter` en cada operación | 2.3 de USE-CASES |
| 2.3 ✅ | Retiros e ingresos de efectivo con motivo y registro de auditoría | POS-13 |
| 2.4 ✅ | Cierre: el sistema calcula lo esperado, el vendedor cuenta, la diferencia queda registrada. **Cerrar pone `openStationId = NULL` y `closedAt` en la misma sentencia** | POS-12 |
| 2.5 ✅ | Reporte de cierre imprimible (cola `PrintJob` hacia `Station.printerTarget`, puede salir a archivo si la impresora no está integrada) | — |
| 2.6 ✅ | Alerta si la diferencia supera `alert.cashDiffLimit` | ALE-03 |
| 2.7 ✅ | CRUD mínimo de estaciones (admin): nombre, ubicación, destino de impresión | ADR-004 |
| 2.8 ✅ | **Pantalla clave del sprint: cierre de caja en 3 pasos.** **Conteo ciego** (decidido el 2026-07-30): el vendedor cuenta e ingresa → confirma → recién ahí aparece la diferencia, con color **y palabra**. El servidor ya no le sirve el monto esperado, con tests que lo comprueban. La franja diagonal amarillo/negro se reserva para el banner de caja descuadrada. Wireframe aprobado antes de codear | UI-BRIEF §5.2 |

**Invariantes que estrena este sprint:**
- `closedAt IS NULL ⟺ openStationId IS NOT NULL` — **lo impone la base** vía los `CHECK` de la tarea 0.2, no el código. Es la única señal de abierta/cerrada: no hay campo `status`.

**Demo de cierre:** turno completo simulado: abrir con $50.000, retirar $10.000 para el flete, cerrar contando — la diferencia aparece sola. Intentar abrir una segunda caja en la misma estación y ver que el sistema la rechaza.

**Cómo cerró:** 8 de 8 tareas. **218 tests en verde en el repo**, 45 de ellos
nuevos. La demo de cierre está escrita como test de punta a punta —abrir con
$50.000, rechazo de la segunda apertura, retiro de $10.000 por el flete, contar
$39.500 y ver aparecer la diferencia—, así que no depende de que alguien se
acuerde de correrla a mano.

**Decisiones que se tomaron construyendo:**
- **La apertura duplicada la rechaza la base, y el servidor solo traduce el
  error.** No hay chequeo previo, a propósito: entre el SELECT y el INSERT cabe
  una segunda apertura desde el otro terminal. El mensaje nombra a quién la
  abrió.
- **El signo de un movimiento lo pone el servidor, no el cliente.** Si el
  cliente pudiera mandar `-5000` en un ingreso, un tipeo en la pantalla se
  convertiría en un retiro sin motivo registrado.
- **No se puede retirar más de lo que hay.** Un saldo esperado negativo hace que
  la diferencia del arqueo deje de significar algo.
- **El movimiento de cierre lleva la diferencia como monto**, para que el libro
  termine en lo que hay de verdad en el cajón y no en lo que el sistema creía.
- **Gana el error de fondo.** Con la caja cerrada y el motivo en blanco, el
  mensaje dice que la caja está cerrada — no "escribe el motivo", que haría
  escribirlo para recién entonces enterarse.
- **Que sobre plata descuadra igual que si faltara**: significa que algo no se
  registró. El umbral se compara en valor absoluto.

---

## Sprint 3 — POS, la venta (Semana 4) ✅ cerrado el 2026-07-30

> Las 11 tareas entregadas, incluida la pantalla de venta. La 3.11 quedó
> cerrada en el Sprint 1 al responderse la pregunta del navegador.
> Lo único que no se puede verificar desde acá es lo físico: el ticket y el
> cajón reales.

**Objetivo:** vender. Escanear, cobrar con pagos múltiples, redondear, imprimir, abrir el cajón.

| # | Tarea | Referencia |
|---|---|---|
| 3.1 ✅ | Pantalla de venta: escaneo agrega línea, cantidad editable (decimales para kg/m), teclado-primero | POS-02, CAT-05 |
| 3.2 ✅ | Pagos múltiples en una venta (efectivo + tarjeta), **vuelto en `receivedAmount`/`changeAmount`** | POS-04, POS-06, ADR-003 |
| 3.3 ✅ | Redondeo a $10 **sobre la pata de efectivo**, registrado en `roundingAmount`. Sin pata en efectivo no hay redondeo | POS-05, ADR-003 |
| 3.4 ✅ | Desglose neto/IVA por residuo al cobrar, con `taxRatePercent` congelado en la venta | decisión sellada 1 |
| 3.5 ✅ | Campo folio + tipo de documento del POS tributario (la doble digitación) | POS-07 |
| 3.6 ✅ | Descuentos por línea y por venta; tope `discount.maxSeller` para vendedor, override admin con PIN | POS-09 |
| 3.7 ✅ | **Venta en espera**: `SuspendedSale`/`SuspendedSaleItem`. Suspender, listar, recuperar, descartar. Al recuperar **se re-leen los precios** y se avisa el delta | POS-08, ADR-001 |
| 3.8 ✅ | Ticket ESC/POS + pulso de cajón en el mismo trabajo de impresión; integración real con la térmica USB | POS-06 |
| 3.9 ✅ | Reimpresión de comprobante desde `PrintJob.saleId`, marcada con `isReprint` | POS-18 |
| 3.10 ✅ | **Pantalla clave del sprint: la venta.** Dos columnas —líneas a la izquierda, total y cobro a la derecha— dentro de 1366×768. Total y vuelto en ≥40px. Wireframe aprobado antes de codear | UI-BRIEF §5.1 |
| 3.11 ✅ | **Tabla canónica de atajos**, definida una vez en `packages/shared` y mostrada en pantalla: cobrar, editar cantidad, descuento, suspender, recuperar espera, buscar por nombre, quitar línea. **Decidido el 2026-07-30**: los terminales corren Chrome en modo normal, así que las teclas son **F2, F4, F6 y F8**. F3, F5 y F11 se las queda el navegador y F10 le abre la barra de menú, así que quedan fuera. La tabla vive en `packages/shared/atajos.ts` desde el Sprint 1, porque la pantalla de catálogo ya las muestra | UI-BRIEF §2.1 |

**Invariantes que estrena este sprint:**
- `Σ SalePayment.amount = Sale.totalGross`, y `totalGross = subtotalGross − discountAmount + roundingAmount`.
- El movimiento de caja de una venta es `Σ (receivedAmount − changeAmount)` de las patas en efectivo.
- Si la pata de efectivo redondea a $0 (residuo de $1 a $4), **no se crea fila de pago en efectivo**: el residuo se absorbe en `roundingAmount`.
- El tope de descuento del vendedor se evalúa sobre el **total de la venta**, no línea por línea: si no, se burla repartiendo el descuento entre las líneas.
- Al recuperar una espera, si `unitId` de la línea ya no coincide con `Product.saleUnitId`, la línea **no se recupera en silencio** — se le muestra al vendedor.
- Las esperas se listan en el cierre de turno de forma **informativa**: se muestran, no se suman al arqueo.
- **Leer el saldo y escribir el `StockMovement` van en la misma `$transaction`.** Es el invariante que sostiene la decisión sellada 16: fuera de una transacción, dos ventas simultáneas del mismo producto escriben el mismo saldo y corrompen el libro sin dar error (ADR-006).
- Toda pata de pago en efectivo lleva `receivedAmount` y `changeAmount` con valor, también cuando el cliente paga justo (`received = amount`, `change = 0`). Nunca nulos.
- **El escaneo se captura globalmente**, sin importar dónde esté el foco, salvo en los campos que lo reclaman explícitamente (cantidad, monto recibido, búsqueda por nombre). El brief promete que "el foco siempre vuelve solo a la caja de escaneo" y nada más lo implementa: el lector es un teclado, y si el foco quedó en el campo de cantidad, el código del producto se escribe ahí y el vendedor cobra 8.451 unidades.
- El nombre visible de una venta sale de la tabla de estados de `STATE.md`, **no de un campo**: son cinco etiquetas, no dos.

**Demo de cierre:** venta real de principio a fin en el hardware de la tienda: escanear, cobrar mixto, cajón se abre, ticket sale cortado. Suspender una venta, atender a otro cliente, recuperarla y cobrarla.

**Nota — y la trampa que esconde:** en este sprint la venta descuenta stock "a ciegas" (el movimiento se registra pero sin validar el saldo). Como todavía no hay compras, el PMP vale 0 y toda venta de este sprint congela `lineCostNet = 0` en filas que son **inmutables**. Es aceptable solo porque son datos de prueba: **la base de datos del Sprint 3 se descarta**. Antes de la primera venta real —marcha blanca incluida— hay que cargar el inventario inicial con sus costos (tarea 4.4). Una venta con costo cero no se puede corregir después: se anula y se rehace.

**Ojo con el texto de los errores:** el brief usa de ejemplo "Stock insuficiente: quedan 3,5 m. Vender igual requiere PIN de administrador". Ese mensaje **no aplica todavía** — la validación de stock y su override llegan en la tarea 4.5. En S3 la venta descuenta a ciegas, y prometer en pantalla un bloqueo que no existe es peor que no decir nada.

**Riesgo:** la integración USB/ESC-POS con la impresora específica. Reservar medio día de pruebas físicas en la tienda. Si el modelo de impresora da problemas, el fallback es imprimir vía driver compartido de Windows mientras se resuelve.

---

## Sprint 4 — Kardex y compras (Semana 5) — **CERRADO 2026-07-30**

**Objetivo:** que el inventario diga la verdad.

**Estado: 9/9 tareas.** 331 tests en verde. Detalle en [`BITACORA.md`](BITACORA.md).
Sin interfaz, con su endpoint listo: el registro de compras al proveedor.

| # | Tarea | Referencia |
|---|---|---|
| 4.1 | Registro de compra a proveedor: entra en unidad de compra, convierte a base vía `factorMilli` | INV-02, CAT-04 |
| 4.2 | Recalculo de costo promedio ponderado en cada ingreso, **con guarda de saldo ≤ 0** | INV-05, ADR-002 |
| 4.3 | Ajustes de inventario con motivo obligatorio; mermas | INV-03, INV-04 |
| 4.4 | Carga de inventario inicial (tipo INITIAL) desde el importador Excel | — |
| 4.5 | Validación de stock en venta: bloqueo con override de admin, **registrado como `STOCK_OVERRIDE` en `AuditLog`** | INV-10 |
| 4.6 | **Anulación y devolución**: `reversalKind` VOID/RETURN, N devoluciones parciales por venta, `reversesSaleItemId` línea a línea, `RETURN_IN` al kardex | POS-10, POS-11, ADR-002 |
| 4.7 | Job de reconciliación: recalcula `StockLevel` desde el libro y **registra las divergencias como `Alert` tipo `STOCK_RECONCILE_DIFF`** | 2.1 de USE-CASES |
| 4.8 | **Pantalla clave del sprint: kardex por producto.** Tabla cronológica —fecha, tipo de movimiento en chip de color, cantidad con signo, saldo, usuario, referencia—: es la pantalla que contesta "¿por qué el stock dice esto?". Wireframe aprobado antes de codear | INV-01, UI-BRIEF §5.4 |
| 4.9 | **Chips de estado de venta**, las cinco etiquetas de la tabla de `STATE.md`, derivadas en el servidor y no en cada pantalla. Aparecen en el listado del día, en el kardex y en el detalle de la venta | decisión sellada 7 |

**Invariantes que estrena este sprint:**
- Para cada `SaleItem` original, `Σ |qtyMilli|` de las líneas que lo revierten **nunca supera** su `qtyMilli`. Se evalúa **dentro** de la transacción de la devolución.
- **La línea de devolución usa el mismo `unitId` que la línea que revierte**, o el invariante anterior compararía milésimas de denominadores distintos.
- `lineCostNet` de una devolución parcial se prorratea por cantidad; la devolución que agota la línea se lleva **el residuo**, para que la suma cuadre exacto con el costo original.
- **Anular una venta con devoluciones parciales previas** revierte solo lo que queda vivo por línea. Si no queda nada, la anulación se rechaza.
- Una devolución contra una venta ya anulada (`VOID`) se rechaza.
- El `StockMovement` de una compra se fecha con `Purchase.receivedAt`, no con el momento de digitarla: si no, el valorizado a una fecha y el reporte de compras del mismo día no coinciden cuando la factura se digita al día siguiente.
- El PMP lo recalculan **solo los movimientos que ingresan** (`PURCHASE`, `RETURN_IN`, `INITIAL`, `ADJUSTMENT` positivo, `TRANSFER_IN`). Los que sacan no lo tocan: sacar mercadería no cambia lo que costó la que queda.
- El movimiento de caja de una devolución va en la sesión **abierta al momento de devolver**, no en la de la venta original, que puede llevar días cerrada.
- `reason` es obligatorio en `ADJUSTMENT` y `SHRINKAGE`.

**Demo de cierre:** comprar 1 rollo de cable (100 m), vender 7,5 m, ver el kardex mostrando saldo 92,5 m y el costo promedio correcto. Devolver 2 m y ver el reingreso (saldo 94,5 m). Devolver otro metro después y comprobar que la segunda devolución parcial funciona.

---

## Sprint 5 — Reportes y alertas (Semana 6) — **CERRADO 2026-07-30**

**Objetivo:** que el sistema le hable al admin.

| # | Tarea | Referencia |
|---|---|---|
| 5.1 | Reporte de ventas por día/rango: total, desglose neto/IVA, por medio de pago, por vendedor. **Suma todas las filas sin filtrar por estado** | ADR-002 |
| 5.2 | Margen por producto y por categoría (solo admin), con `lineCostNet` congelado | 2.4 de USE-CASES |
| 5.3 | Inventario valorizado a la fecha, reconstruido desde `balanceBaseMilli` + `balanceCostNetMilliPeso` | INV-06 |
| 5.4 | Cuadratura de folios: ventas del día vs folios registrados, huecos y duplicados acusados **en el reporte** (no con una restricción de BD que impediría corregir un tipeo) | POS-07 |
| 5.5 | Alertas de stock bajo y quiebre con `locationId`, panel de alertas con resolución | ALE-01, ALE-02 |
| 5.6 | Alerta de venta en espera añeja (`pos.suspendedStaleHours`, medida sobre `touchedAt`) | ADR-001 |
| 5.7 | **Pantalla clave del sprint: dashboard de admin.** Cuatro datos y no cuarenta: venta del día, estado de caja, **margen del día** y alertas activas. Wireframe aprobado antes de codear | UI-BRIEF §5.5 |

**Invariantes que estrena este sprint:**
- El job de alertas inserta solo si no hay ya una alerta activa del mismo tipo y producto (`WHERE NOT EXISTS ... resolvedAt IS NULL`). Nada de reemplazar la fila existente: eso borraría quién la resolvió.
- **Esa deduplicación vale solo para las alertas de stock** (`LOW_STOCK`, `OUT_OF_STOCK`), que describen un estado que persiste. `CASH_DIFFERENCE` y `SUSPENDED_SALE_STALE` describen **hechos**: la diferencia de caja del martes no es la del lunes, y suprimirla porque hay una sin resolver esconde justo lo que hay que mirar.
- El reporte de valorizado declara en pantalla que el PMP es global al producto (decisión provisional de `STATE.md`).

**Demo de cierre:** al final de un día simulado, el dashboard muestra cuánto se vendió, cuánto margen dejó, y qué hay que reponer. Anular una venta del día y ver que el total baja solo, sin tocar nada más.

---

## Sprint 6 — WhatsApp (Semana 7) 🟡 todo menos el transporte, 2026-07-31

**Objetivo:** el mensaje post-venta, sin poner en riesgo ni la venta ni el número.

| # | Tarea | Referencia |
|---|---|---|
| 6.1 | Captura opcional de cliente en el pago: nombre + teléfono **normalizado a E.164** + **checkbox de consentimiento** | WA-01 |
| 6.2 | Integración whatsapp-web.js: sesión persistente, QR de vinculación en pantalla de admin | — |
| 6.3 | Worker de cola: reintentos con backoff, jitter aleatorio entre envíos (anti-patrón de bot) | WA-02 |
| 6.4 | Plantilla del mensaje editable en Settings, variables `{nombre}` `{total}` | WA-04 (adelantado) |
| 6.5 | Opt-out: palabra clave de baja registrada en `optOutAt`, no se le escribe nunca más | WA-03 |
| 6.6 | Panel de estado: sesión conectada/caída, mensajes pendientes/fallidos | — |

**Invariantes que estrena este sprint:**
- `Customer.phone` se normaliza a E.164 **antes** de guardar (móvil chileno `+569XXXXXXXX`, fijo de Concepción `+5641XXXXXXX`). Sin eso, `+56912345678` y `912345678` son dos clientes distintos y el opt-out de uno no protege al otro.
- Un número inválido no bloquea la venta: se guarda la venta sin cliente y se avisa en pantalla.

**Demo de cierre:** venta con cliente que acepta → le llega el WhatsApp. Se desconecta el internet, se hace otra venta → la venta cierra igual y el mensaje sale cuando vuelve la conexión.

**Riesgo:** whatsapp-web.js depende del DOM de WhatsApp Web y se rompe cuando Meta cambia cosas. Mitigación: fijar versión, y el panel 6.6 para que la falla sea visible y no silenciosa. **Número dedicado, no el personal.**

**Cómo va (2026-07-31):** 6.1, 6.3, 6.4, 6.5 y 6.6 entregadas y probadas; de la
6.2, todo salvo el adaptador. 456 tests en verde (178 en `shared`, 271 en
`server`, 7 en `web`), 62 nuevos.

Todo se apoya en un puerto de tres métodos (`whatsapp/transporte.ts`) y **el
adaptador de whatsapp-web.js no está escrito a propósito**: instanciarlo abre
una sesión de verdad y manda mensajes a teléfonos de verdad, y la vinculación
exige escanear un QR con el número dedicado en la mano. Escribirlo a ciegas
sería escribir contra una API imaginada; el puerto confina ese riesgo a un
archivo, cuyas instrucciones —incluida la de resolver el JID con `getNumberId()`
en vez de concatenar `@c.us`— están escritas adentro.

**Lo que falta para cerrar, y no se puede hacer sin alguien presente:** un
número dedicado, `pnpm add whatsapp-web.js`, el adaptador y el escaneo del QR.
Recién ahí se corre la demo. La mitad de "se corta el internet" ya está
construida y probada: sin sesión conectada el worker no gasta intentos, así que
la cola sobrevive intacta y sale cuando vuelve la conexión.

**Verificado en pantalla** a 1366×768: la captura del cliente en el diálogo de
cobro (plegada por omisión, alcanzable con Tab, sin robarle el foco al efectivo)
y el panel, incluido el estado de sesión caída fingiendo la respuesta del
servidor. Cuatro defectos corregidos que los tests no veían — están en
`BITACORA.md`.

---

## Sprint 7 — Instalación y marcha blanca (Semana 8) 🟡 lo que se puede hacer sin la tienda, 2026-07-31

**Objetivo:** que sobreviva en la tienda sin nadie técnico al lado.

| # | Tarea | Referencia |
|---|---|---|
| 7.1 | Servicio Windows con NSSM: auto-arranque, auto-restart, logs a archivo | — |
| 7.2 | Respaldo automático: snapshot diario de SQLite (vía `VACUUM INTO`), rotación 30 días, copia a pendrive/nube | — |
| 7.3 | Restauración probada: simular pérdida del PC y levantar desde respaldo (**si no se prueba, no existe**) | — |
| 7.4 | Checklist de instalación: IP fija, firewall, suspensión desactivada, actualizaciones fuera de horario, UPS | — |
| 7.5 | Terminales secundarios: acceso por navegador, acceso directo en escritorio, **selección de estación** | ADR-004 |
| 7.6 | Marcha blanca: 3-5 días operando en paralelo al método actual, con lista de fricciones | — |
| 7.7 | Capacitación al vendedor: guía de 1 página con los 5 flujos del día | — |

**Cómo va (2026-07-31):** 7.1, 7.2, 7.3, 7.4 y 7.7 entregadas. **503 tests en
verde** (200 en `shared`, 296 en `server`, 7 en `web`), 47 nuevos.

El respaldo corre solo —una vez al día y también al encender si el último tiene
más de 24 horas—, se verifica apenas se produce, se copia a una carpeta externa
configurable desde el panel y rota a 30 días guardando siempre los 7 más nuevos.
La restauración es un programa aparte que se niega a correr con el servidor
arriba.

**La 7.3 se probó de verdad**, que es lo que ella misma exige: el test borra la
base —el archivo, su `-wal` y su `-shm`— y la recupera del respaldo, comprobando
que están los datos de antes y no los de después, que el modo WAL vuelve y que
el servidor pasa sus autochequeos contra la base restaurada.

**Lo que NO se probó:** los `.bat` de `instalacion/`, porque no hay una máquina
Windows. Es la única parte del sprint escrita a ciegas y está separada en su
propia carpeta, con su README al lado.

**7.5 a medias, por decisión.** La selección de estación al entrar ya existía
desde el Sprint 2 y el acceso directo de los terminales está documentado; falta
la pantalla de administración de estaciones, cuyo endpoint existe desde la 2.7.
Es la pantalla de menor valor del sprint y arrastra la lista del brief §6.

**7.6 necesita la tienda**, y ya no necesita nada más: las tres pantallas que la
bloqueaban —devoluciones y anulaciones, descuento y venta en espera— se
construyeron el 2026-07-31. **513 tests en verde.**

**Cierre del proyecto v1:** una semana de operación real sin intervención técnica.

---

## Resumen

| Sprint | Semana | Entrega tocable |
|---|---|---|
| 0 | 1 | Login por PIN con roles |
| 1 | 2 | Catálogo + Excel + etiquetas |
| 2 | 3 | Ciclo de caja completo |
| 3 | 4 | **Vender de verdad** (ticket + cajón + venta en espera) |
| 4 | 5 | Kardex confiable + compras + devoluciones parciales |
| 5 | 6 | Reportes + alertas |
| 6 | 7 | WhatsApp post-venta 🟡 (falta vincular el número) |
| 7 | 8 | Instalado y en marcha blanca 🟡 (respaldo probado; falta la tienda) |

**Total: 8 semanas** hasta marcha blanca. Es un plan de mejor caso: lo realista es que S3 y S4 se coman una semana extra entre los dos, porque ahí viven el hardware y los casos de uso imprevistos. Presupuestar 9-10 semanas de calendario.

## Lo que NO está en ningún sprint (a propósito)

Cotizaciones (POS-14), precios mayoristas (POS-16), kits (CAT-07), conteo cíclico (INV-09), devolución a proveedor (INV-07), UI de bodegas, segunda caja, bloqueo de cuenta por PIN errado. Todo eso es v2 y el schema ya lo soporta. **Si aparece la tentación de meterlo "ya que estamos", la respuesta es no** — se anota en el backlog de v2 y se sigue.

Esa regla se aplicó a este mismo plan: al cerrar las brechas del schema se descartaron una tabla de dispositivos, un desglose de IVA congelado por línea, restricciones únicas sobre el folio tributario y una veintena de settings. Ninguno cerraba una brecha real.

## Ritual de cada sprint

1. Lunes: Claude Code lee `STATE.md` + `BITACORA.md`, toma las tareas del sprint.
2. Durante: commits Conventional Commits; decisiones nuevas → ADR en `.agents/DECISIONS/`.
3. Cierre: demo con Cristian → fricciones anotadas → `STATE.md` y `BITACORA.md` actualizados → recién ahí parte el siguiente.
4. **Toda pantalla nueva cierra contra la lista del brief (§6)**: flujo completo con teclado, legible en 1366×768, foco visible, números tabulares, estados vacío/cargando/error diseñados, cero colores fuera de los tokens. Una pantalla que no la pasa no cierra el sprint, igual que un test rojo.
