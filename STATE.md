# STATE.md — Ferrehouse Manager

> Traspaso a Claude Code (WSL). Leer completo antes de escribir código.
> Última actualización: 2026-07-31

## Qué es

Software de gestión para una ferretería en Concepción. Corre **en local**, sobre un PC con Windows que hace de servidor; otros 2-3 terminales acceden por navegador en la LAN.

**No es Aura.** Comparte stack con `aura-core` pero es un producto distinto: no va a xCloud, no tiene license server, no maneja datos clínicos. Las reglas selladas de Aura no aplican acá salvo donde se repiten abajo.

## Stack

| Capa | Elección |
|---|---|
| Runtime | Node 22, TypeScript estricto |
| Backend | Fastify |
| ORM / BD | **Prisma 6** + SQLite (modo WAL, `connection_limit=1`) |
| Frontend | React 18 + Vite, Tailwind, shadcn/ui |
| Validación | Zod end-to-end |
| Monorepo | pnpm workspaces |
| Servicio Windows | NSSM (auto-arranque + auto-restart) |

SQLite en vez de MariaDB: una sola tienda, 2-3 terminales, respaldo = copiar un archivo. Si crece a sucursales, Prisma migra a MySQL sin reescribir la capa de datos.

**Prisma 6, no 7.** Con `prisma@7` este schema no valida: la propiedad `url` ya no se admite en el bloque `datasource`. Fijar `prisma@^6` y `@prisma/client@^6` en `package.json`.

## Decisiones selladas

1. **Precios con IVA incluido. Costos netos.** El IVA de compra es crédito fiscal, no costo.
   - En pantalla y repisa: precio final. Al cobrar y en reportes: desglose neto + IVA.
   - Margen de una línea vendida: `round(brutoLinea / (1 + taxRatePercent/100)) − SaleItem.lineCostNet`, donde `brutoLinea` es `lineTotalGross` menos la parte proporcional de `Sale.discountAmount`. Ignorar el descuento de cabecera infla el margen de toda venta con descuento.
   - **El IVA se calcula como residuo**: `neto = round(bruto / 1,19)`, `iva = bruto − neto`. Nunca `neto × 0,19`, porque el redondeo por línea descuadra el total.
   - La tasa se congela en `Sale.taxRatePercent`. Si el IVA cambia algún día, los reportes del año pasado no se mueven.
2. **Dinero en `Int`,** y hay **dos categorías que no se mezclan**:
   - **Montos** (plata que cambia de manos) → pesos exactos. CLP no tiene decimales.
   - **Razones** (costo por unidad) → milésimas de peso, sufijo **`MilliPeso`**. Solo dos campos: `Product.costNetMilliPeso` y `StockMovement.balanceCostNetMilliPeso`. Motivo en [ADR-005](.agents/DECISIONS/005-unidades-y-costos.md): una caja de 1.000 tarugos a $3.500 da $3,5 por tarugo, y redondear eso a entero mete 14% de error en el margen.
3. **Cantidades en `Int` de milésimas, y el nombre del campo dice de qué:**
   - `qtyBaseMilli` → milésimas de la **unidad base** (libro de stock).
   - `qtyMilli` → milésimas de la unidad de **esa línea**, dada por su `unitId`.
   - `qtyBaseMilli = round(qtyMilli × unit.factorMilli / 1000)`, convertido una sola vez al escribir el movimiento.
4. **El stock es un libro append-only** (`StockMovement`). `StockLevel` es caché reconstruible. El libro guarda el **monto exacto** del movimiento (`totalCostNet`), no una razón: sumar razones acumula error y el job de reconciliación acusaría divergencias falsas.
5. **Ventas y movimientos de stock nunca se editan ni se borran.** Anulación y devolución = registro contrario que apunta al original.
6. **El costo se congela en `SaleItem.lineCostNet`** (costo neto exacto de la línea completa). Si no, el margen histórico cambia solo cuando sube un precio de proveedor.
7. **Una venta admite N devoluciones parciales.** `reversesId` no es único y `SaleItem.reversesSaleItemId` ata cada línea devuelta a la que revierte. **No existe** un estado "parcialmente devuelta": los reportes de plata **suman todas las filas sin filtrar por estado**, y el par original + reversa suma cero. Ver [ADR-002](.agents/DECISIONS/002-devoluciones-parciales.md).
8. **N pagos por venta** (`SalePayment`). `amount` es siempre **lo imputado a la venta**, y la suma de los pagos es exactamente `totalGross`. El efectivo físico va en `receivedAmount`/`changeAmount`. Ver [ADR-003](.agents/DECISIONS/003-vuelto-y-cuadratura.md).
9. **Redondeo de efectivo a $10**, aplicado a la **pata de efectivo** (nunca al total: la tarjeta se cobra al peso exacto), registrado en `Sale.roundingAmount`. La regla es fija —`round10(x) = signo(x) × round(|x|/10) × 10`, **simétrica** para que el par venta + anulación sume cero— y solo el múltiplo es configurable (`cash.roundTo`).
10. **Sin enums ni Json en Prisma** — SQLite no los soporta. String + validación Zod.
11. **Impresión vía tabla `PrintJob`**, con `Station.printerTarget` como destino.
12. **`Location` existe desde el día uno con una sola fila.** Las consultas de stock filtran por ubicación; la UI la oculta hasta que exista la 2ª bodega (`ui.showLocations`).
13. **`Station` también es tabla, por el mismo motivo que `Location`.** Y "una sola sesión de caja abierta por estación" lo impone la **base de datos**: `CashSession.openStationId Int? @unique` **más dos `CHECK`** que hay que agregar a mano a la migración inicial ([`.agents/MIGRACION-INICIAL.md`](.agents/MIGRACION-INICIAL.md)) — el índice único solo no basta. Ver [ADR-004](.agents/DECISIONS/004-estaciones.md).
14. **La venta en espera vive en tabla aparte** (`SuspendedSale`), sin ninguna relación con caja ni con stock. El aislamiento es estructural, no de disciplina. Ver [ADR-001](.agents/DECISIONS/001-venta-en-espera.md).
15. **WhatsApp e impresión son colas con reintentos.** Una venta jamás se bloquea porque falle una de las dos.
16. **Escrituras serializadas**: `connection_limit=1` en la URL de SQLite. Sin eso, dos ventas simultáneas del mismo producto corrompen el saldo del libro en silencio. Ver [ADR-006](.agents/DECISIONS/006-concurrencia-sqlite.md).
17. **Lo que el vendedor no puede ver no sale del servidor.** USR-03 —el vendedor no ve costos ni márgenes— es regla de negocio, no `display:none`. Los campos de costo (`Product.costNetMilliPeso`, `SaleItem.lineCostNet`, `StockMovement.totalCostNet`, `StockMovement.balanceCostNetMilliPeso` y todo `Purchase`) **se omiten al serializar** cuando el token es de rol `SELLER`. Los DTO por rol viven en `packages/shared` desde el Sprint 0: si se parchan endpoint por endpoint, basta que uno se olvide para que el costo viaje en el JSON aunque la pantalla no lo pinte. El principio 8 del brief de UI ("no existe en su DOM") es inaplicable si el dato ya cruzó la red.
18. **El costo de un producto se digita solo hasta su primer movimiento de stock.** Después lo manda el libro. Hasta el Sprint 4 no existen compras, así que el inventario inicial no tiene otra forma de cargar su costo que tecleándolo; pero en cuanto entra mercadería, `Product.costNetMilliPeso` pasa a ser el PMP —un caché reconstruible desde `StockMovement`— y dejarlo editable permitiría que un tecleo contradiga al libro sin dejar rastro. La regla se apaga sola: nadie tiene que acordarse de quitar el campo en el Sprint 4. Corregirlo después es un ajuste de stock, que sí queda registrado.
   **Precisión del Sprint 4:** el bloqueo lo disparan solo los movimientos que
   traen costo propio (`PURCHASE`, `INITIAL`, `RETURN_IN`, `TRANSFER_IN`), no
   todos. Una venta no fija ningún costo —lo copia del vigente—, y contarla
   dejaba sin corrección posible a cualquier producto vendido antes de cargar
   el inventario inicial.
19. **El texto que se busca se guarda normalizado.** `Product.searchKey` lleva nombre + SKU + códigos en minúsculas y sin tildes, escrito en la misma transacción que el producto. El `LIKE` de SQLite ignora mayúsculas **solo en ASCII**: sin esta columna, buscar "caneria" no encuentra "Cañería" y buscar "CAÑERIA" tampoco, o sea media repisa invisible desde la caja de búsqueda.

20. **Con saldo bajo cero, el costo del ingreso pasa a ser el costo del
    producto.** El promedio ponderado divide por el saldo resultante; con saldo
    anterior negativo estaría promediando contra una deuda cuyo costo nunca
    existió, y el resultado sale por debajo de lo que se acaba de pagar.
    Conservar el costo anterior —como estaba— es peor y además silencioso: se
    digita la factura con el precio nuevo del proveedor y el margen se sigue
    calculando con el viejo. La regla vale también para el saldo cero.

21. **El libro de stock tiene un solo escritor** (`apps/server/src/stock-ledger.ts`).
    Ninguna ruta escribe `StockMovement` ni `StockLevel` por su cuenta. Los seis
    tipos de movimiento hacen los mismos cuatro pasos con distinto signo, y una
    copia que olvide la foto del costo deja el kardex mintiendo sin que el saldo
    —lo único que se mira— acuse nada.

22. **Lo devuelto de una línea se deriva en un solo lugar** (`resumirLineas`, en
    `packages/shared/src/returns.ts`). No es columna de `SaleItem`: se cuenta
    sumando las líneas de reversa que la apuntan. De ahí viven el invariante que
    impide devolver más de lo vendido, la etiqueta visible de la venta y el
    prorrateo del costo. Con tres implementaciones, dos discrepan y el descuadre
    aparece en el margen, que es donde menos se mira.

23. **El prorrateo de una devolución parcial es acumulativo.** Se calcula cuánto
    corresponde al total devuelto hasta ahora y se resta lo ya devuelto, en vez
    de prorratear cada trozo. Así la devolución que agota la línea se lleva el
    residuo sin ninguna regla especial, y la suma de las parciales es exacta.

24. **La plata de una venta se reparte en un solo lugar** (`desglosarVenta`,
    en `packages/shared/src/reports.ts`). El total del día, el margen por
    producto, el margen por categoría y la venta por vendedor son cuatro cortes
    de los mismos números; calculados por separado dan cifras **parecidas y
    distintas**, que es lo peor que pueden dar, porque nadie sospecha. El
    reparto es acumulativo (decisión 23) tanto para el ajuste de cabecera como
    para el neto del documento, y el residuo se lo lleva siempre la línea de
    `id` mayor, con el orden explícito: si lo decidiera la base, el mismo
    reporte le atribuiría el peso sobrante a otro producto en cada corrida.

25. **Hay dos clases de alerta y no se escriben igual.** Las de ESTADO
    (`LOW_STOCK`, `OUT_OF_STOCK`) se evalúan dentro del movimiento que cambia
    el saldo y se cierran solas cuando dejan de ser ciertas: una alerta que
    dice "quedan 3 m" cuando hay 200 es una mentira en pantalla, y el panel
    entero pierde credibilidad por ella. Las de HECHO (`CASH_DIFFERENCE`,
    `STOCK_RECONCILE_DIFF`) no se deduplican ni se cierran solas.
    **Lo que no tiene evento que lo dispare no se guarda: se deriva al leer.**
    `SUSPENDED_SALE_STALE` no es una fila —que pase el tiempo no es un evento—
    y persistirla obligaría a un barrido periódico que escribiría la misma
    alerta veinte veces mientras la espera sigue ahí.

26. **El inventario valorizado a una fecha se reconstruye SUMANDO el libro**,
    no leyendo la última foto de saldo. `balanceBaseMilli` y
    `balanceCostNetMilliPeso` son fotos tomadas en orden de ESCRITURA, y
    `createdAt` es la fecha del HECHO: una factura digitada hoy con recepción de
    la semana pasada lleva fecha vieja y un saldo calculado sobre el stock de
    hoy. Sumar `qtyBaseMilli` y `totalCostNet` es exactamente para lo que la
    decisión 4 guardó el monto exacto en vez de una razón.

27. **El transporte de WhatsApp vive detrás de un puerto**
    (`apps/server/src/whatsapp/transporte.ts`: `estado()`, `qr()`,
    `enviar(e164, mensaje)`). Ninguna otra parte del sistema sabe que WhatsApp
    existe. El motivo no es purismo: **instanciar el cliente manda mensajes a
    teléfonos reales**, así que es lo único del proyecto que no se puede
    ejercitar sin consecuencias hacia afuera. El puerto deja que todo lo demás
    —captura, cola, baja, plantilla, panel— sea código probado, y confina a un
    archivo lo que hay que escribir a ciegas. Ese archivo lleva sus
    instrucciones adentro; la que más importa: **resolver el JID con
    `getNumberId()`, nunca pegarle `@c.us` al número**, y que el `error` que
    devuelva sea texto para el administrador, porque se muestra tal cual en el
    panel.
28. **La baja de WhatsApp no se deshace desde el mesón.** El checkbox de
    consentimiento del vendedor no vuelve a suscribir a un cliente con
    `optOutAt`: la venta se registra y el cliente queda atribuido, pero no se
    encola nada y la pantalla lo dice. Alguien puede marcar la casilla por
    costumbre, y eso no es el consentimiento que una baja exige revertir.
    Corolario en la cola: la baja se vuelve a mirar **al enviar**, no solo al
    encolar — entre que un mensaje se agenda y sale pueden pasar horas, y
    mandarlo "porque ya estaba en la cola" es justo lo que la baja prohíbe.
29. **Un WhatsApp jamás pone en riesgo una venta** (refinamiento operativo de la
    15). `WhatsAppJob.saleId` es único, así que el encolado va **fuera** de la
    transacción de la venta —adentro, un duplicado haría rollback de una venta
    cobrada— y además **detrás de un `catch`**: una excepción sin atrapar
    devolvería 500 sobre una venta que sí quedó escrita, el vendedor leería
    "error" y volvería a cobrar. Del mismo orden: **sin sesión conectada el
    worker no toca la cola**; no marca intentos ni falla trabajos, porque
    gastar uno por pasada dejaría todo en FALLIDO tras dos horas sin internet y
    nada saldría al volver la conexión.

**Precisión de la decisión 17 (Sprint 5):** al vendedor tampoco le viaja **la
venta del día**, no solo el margen. El arqueo es a ciegas y casi toda la venta
es efectivo, así que decirle cuánto se vendió es decirle cuánto debería tener el
cajón. Por eso el vendedor entra directo a Venta: su panel no tendría ninguna
cifra que mostrarle.

## Decisiones provisionales

**Ya no queda ninguna.** La pregunta abierta 1 se cerró el 2026-07-30 como *dos cajas en la misma tienda*, y con eso lo que estaba provisional pasó a sellado:

- **El PMP es global al producto**, no por ubicación (`Product.costNetMilliPeso`). Con una sola tienda es lo correcto, no una simplificación. Sigue siendo reversible si algún día aparece una segunda dirección: el libro guarda `locationId` y el costo de cada movimiento, así que el PMP por ubicación es recomputable sin perder historia.
- El **inventario valorizado por ubicación** (INV-06) usa ese PMP global, y con una sola tienda no hay aproximación que corregir.

## Fuera de alcance

- Emisión de DTE (la boleta la emite el POS tributario; acá solo se registra folio y tipo)
- Fiado / cuenta corriente — **confirmado que no aplica**
- UI de bodegas, traslados y reportes por ubicación — el modelo lo soporta, no se construye aún
- Ecommerce, fidelización, gift cards
- Campañas masivas de WhatsApp (riesgo de bloqueo del número)
- Bloqueo de cuenta por PIN errado. Es una LAN privada de una ferretería con 2-3 terminales; el costo (persistir intentos, sobrevivir al auto-restart de NSSM, desbloquear a alguien en pleno mesón) no se paga con el riesgo que cubre.

## Plan

**La única fuente del plan es [`SPRINTS.md`](SPRINTS.md).** Antes había acá una lista de fases que numeraba distinto que los sprints y decía cosas distintas del 2 en adelante; se eliminó para que no haya dos planes.

**Sprint 0 cerrado el 2026-07-30.** Repo, migración con sus dos `CHECK`, seed
idempotente, auth por PIN con roles, fundación visual y CI. 61 tests en verde.
Detalle en [`BITACORA.md`](BITACORA.md).

**Sprint 1 — Catálogo: cerrado el 2026-07-31.** El servidor y la pantalla clave
salieron el 2026-07-30; las tres pantallas que quedaban sin interfaz —alta y
edición de producto, importación de Excel y usuarios— se construyeron el
2026-07-31 junto con la de compras del Sprint 4.

**Sprint 2 — Caja: cerrado el 2026-07-30.** Las 8 tareas, incluida la pantalla
de cierre en 3 pasos. El **arqueo es a ciegas**: el vendedor cuenta y escribe
antes de que aparezca nada, y el servidor tampoco le sirve el monto esperado.

**Sprint 3 — POS: cerrado el 2026-07-30.** Las 11 tareas, incluida la pantalla
de venta. 280 tests en verde. Falta lo físico: el ticket y el cajón reales.

**Sprint 4 — Kardex y compras: cerrado el 2026-07-30.** Las 9 tareas, incluida
la pantalla de kardex. **331 tests en verde.** La venta ya valida saldo antes
de descontar, con override de administrador registrado. Queda sin interfaz, con
su endpoint listo y probado: el registro de compras al proveedor.
**Su pantalla se construyó el 2026-07-31.**

**Sprint 5 — Reportes y alertas: cerrado el 2026-07-30.** Las 7 tareas,
incluido el dashboard de admin. **390 tests en verde.** Reporte de ventas por
rango con cuadratura de folios, margen realizado por producto y por categoría,
inventario valorizado a una fecha reconstruido desde el libro, alertas de stock
que se cierran solas y panel con resolución. El vendedor entra directo a Venta.

**2026-07-31 — Las cuatro pantallas pendientes.** Antes de abrir el Sprint 6 se
construyeron las cuatro que quedaban debiendo: alta y edición de producto,
importación de Excel, compras al proveedor y usuarios. Los endpoints existían y
estaban probados desde los sprints 1 y 4, pero digitar una factura seguía siendo
por API. **394 tests en verde.**

**2026-07-31 — Sprint 6 (WhatsApp), todo menos el transporte.** Entregadas 6.1,
6.3, 6.4, 6.5 y 6.6; de la 6.2, todo salvo el adaptador. **456 tests en verde.**

**Sprint actual: sigue el 6, y no se puede cerrar sin alguien presente.** Falta
un número dedicado, `pnpm add whatsapp-web.js`, escribir el adaptador contra
`apps/server/src/whatsapp/transporte.ts` y **escanear el QR con ese teléfono**.
Hasta entonces el sistema se comporta como corresponde: dice "Sin vincular",
guarda los clientes, acumula la cola sin perder nada y respeta las bajas.

Si se prefiere avanzar sin esperar a nadie, el **Sprint 7** (servicio Windows,
respaldo automático y restauración probada) se puede hacer entero solo, y la
7.3 —"si no se prueba, no existe"— se puede probar de verdad.

El schema vive ahora en `apps/server/prisma/schema.prisma` (lo pide Prisma por
convención). Sigue siendo la fuente de verdad del modelo.

## Diseño de interfaz

Dirección visual elegida: **"Mesón"** — industrial, fondo frío, tinta `#16181A`, acento amarillo seguridad `#FFC400`, tipografías Archivo + IBM Plex Mono **servidas desde el repo**. Todo lo visual se rige por [`UI-BRIEF.md`](UI-BRIEF.md), donde viven los tokens.

**No hay un sprint de UI**, y el propio brief explica por qué: el diseño va repartido. Una **fundación visual** —tokens, tematizado de shadcn, fuentes— que es un PR propio dentro del Sprint 0, antes de cualquier pantalla; y después **una pantalla clave por sprint**: catálogo (S1), cierre de caja (S2), venta (S3), kardex (S4), dashboard (S5). Esas cinco pasan por wireframe aprobado antes de codearse.

### Estados visibles de una venta

El brief pide "estados imposibles de confundir" y ofrece dos etiquetas —COMPLETADA / ANULADA—, pero el modelo produce **cinco**. La UI los deriva: **no son un campo**, no se guardan y no tocan la decisión sellada 7, porque los reportes de plata siguen sumando todas las filas sin filtrar por estado.

| Lo que ve el usuario | De dónde sale |
|---|---|
| **Completada** | `status = COMPLETED`, sin reversas |
| **Con devoluciones** | tiene reversas, pero no agotan las líneas |
| **Devuelta** | las devoluciones agotan todas las líneas. Anularla se rechaza: ya no queda nada vivo |
| **Anulada** | `status = REVERSED` (anulación total) |
| **Devolución** / **Anulación** | la fila **es** la reversa (`reversalKind` RETURN / VOID). Es un documento propio: aparece en el listado del día y lleva su folio de nota de crédito |

Sin esta tabla, la pantalla de venta se diseña con dos chips y el Sprint 4 obliga a rehacerla.

## Preguntas abiertas

**Ninguna.** Las cuatro que quedaban se respondieron el 2026-07-30; abajo queda el registro con lo que cada respuesta implica.

### Cerradas el 2026-07-30

- ~~¿2 cajas o 2 sucursales?~~ → **2 cajas en la misma tienda.** Un servidor, SQLite local, sin sincronización. El PMP global deja de ser provisional (arriba). Era la pregunta más importante del proyecto.
- ~~¿Cuántos turnos por día?~~ → **Un turno, 1 o 2 personas.** La caja se abre en la mañana y se cierra al cerrar la tienda: un arqueo diario. El modelo ya soporta varias sesiones por día, así que si mañana hay dos turnos no hay que cambiar nada — pero el reporte de cierre del Sprint 2 se diseña para uno.
- ~~¿Cómo se pesan los productos a granel?~~ → **Balanza aparte, el peso se digita.** Sin driver ni integración. Confirma lo que ya estaba asumido para el MVP.
- ~~¿Qué navegador corren los terminales?~~ → **Chrome en modo normal.** Los atajos quedan en **F2, F4, F6 y F8**. F3, F5 y F11 se las queda el navegador y F10 le abre la barra de menú, así que no se usan. Esto cierra la tarea 3.11 antes de que el vendedor aprenda una tecla que después haya que cambiarle.

### Cerradas en rondas anteriores


- ~~Formato de SKU~~ → `FH-` + correlativo de 5 dígitos (`FH-00001`), vía tabla `Counter`. Todo producto lleva SKU interno, incluidos los que traen código de fabricante: el código del fabricante va a `ProductBarcode` como alias.
- ~~¿Precio con IVA incluido?~~ → sellada, decisión 1.
- ~~¿Bodega separada?~~ → resuelta por la decisión 12.
- ~~¿Se vende fiado?~~ → no aplica, está en Fuera de alcance.
- ~~Nombre del producto~~ → Ferrehouse Manager.

## Contexto del entorno

- Impresora térmica **USB**, conectada al PC servidor. ESC/POS crudo, no driver gráfico.
- Cajón de dinero cuelga de la impresora, se abre con `ESC p 0 25 250` en el mismo trabajo del ticket.
- El destino de impresión de cada estación vive en `Station.printerTarget`: hoy el nombre del recurso compartido de Windows; mañana `host:9100`.
- Recomendación pendiente: la segunda impresora que se compre, con puerto Ethernet.
- Lector de códigos USB = teclado HID, sin driver.
- Los terminales trabajan a **1366×768**. Es el presupuesto de layout, no una aspiración: el POS a dos columnas, con total de ≥40px y botones de ≥44px, tiene que caber ahí.
- **La tienda no tiene internet.** Fuentes, íconos y toda dependencia visual se sirven desde el repo. Un `<link>` a Google Fonts anda en el PC del desarrollador y cae al fallback en el mesón, sin avisar.

## Convenciones

- Commits: Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`)
- Código en inglés, comentarios y commits en español
- Cristian lee los commits para aprender: explicar la jerga la primera vez que aparece
- Decisiones nuevas → ADR en [`.agents/DECISIONS/`](.agents/DECISIONS/). Bitácora de avance → [`BITACORA.md`](BITACORA.md). Datos iniciales → [`.agents/SEED.md`](.agents/SEED.md). Diseño de interfaz → [`UI-BRIEF.md`](UI-BRIEF.md).
