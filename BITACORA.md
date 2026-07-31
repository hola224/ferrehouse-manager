# BITACORA.md — Ferrehouse Manager

> Una entrada por hito. Lo más reciente arriba.
> Acá va **qué pasó y qué se aprendió**; las decisiones viven en `.agents/DECISIONS/`.

---

## 2026-07-30 — Revisión de la documentación y cierre del schema

**Estado: Sprint 0 en curso. El schema quedó cerrado y validado; falta el repo.**

### Qué se hizo

Revisión cruzada de `STATE.md`, `SPRINTS.md`, `USE-CASES.md` y `schema.prisma`,
con validación ejecutable y un barrido caso-MVP → tabla que lo sostiene.

Aparecieron **dos casos marcados MVP sin ningún soporte en el modelo** (venta en
espera y devolución parcial múltiple), más un error que impedía que el schema
validara. Se cerraron todos antes de correr la migración inicial, que es el único
momento en que salen gratis.

### Lo aprendido

- **`prisma validate` en verde no dice nada sobre si el modelo sirve.** Prueba que
  el archivo parsea. Las dos brechas graves las encontró el barrido manual de
  casos de uso contra tablas, no la herramienta.
- **Un campo `@unique` puesto por prolijidad puede prohibir un caso de negocio.**
  `reversesId @unique` se veía correcto y hacía imposible que un cliente devolviera
  algo el martes y otra cosa el jueves.
- **Agregar un estado a una tabla traslada la corrección a la disciplina.** Tanto
  la venta en espera como la devolución parcial se podían resolver con un valor
  nuevo en `Sale.status`; en los dos casos habría obligado a recordar un filtro en
  cada consulta futura, y en direcciones opuestas (una inflando las ventas del día,
  la otra subcontándolas). Las dos se resolvieron sin tocar `status`.
- **El sufijo `Milli` significaba dos denominadores distintos.** Al arreglar la
  precisión del costo casi se repite el defecto que se estaba cerrando. De ahí
  `MilliPeso`, verboso a propósito.
- **Un invariante que la base puede imponer, lo impone la base.** "Una sola sesión
  de caja abierta por estación" estaba escrito en el plan y no lo sostenía nadie;
  ahora es un índice único, probado contra SQLite real.
- **Lo que más costó fue decir que no.** Los diseños propuestos traían una tabla de
  dispositivos, veinte settings de más y varias restricciones que no habrían
  funcionado. La lista de descartes está al final de `REVISION.md`.

### Verificado

- `prisma@6 validate` → `migrate diff --from-empty` (470 líneas) → aplicado en
  SQLite real: **28 tablas**, sin errores.
- La restricción de sesión única probada contra la base: la segunda sesión abierta
  en la misma estación es rechazada; tras cerrar se puede abrir otra; las cerradas
  conviven.
- Aritmética comprobada: conversión de unidades ida y vuelta, IVA por residuo
  cuadrando al peso, redondeo de una venta mixta, y la demo de cierre del Sprint 4
  (comprar 100 m, vender 7,5 → 92,5; devolver 2 → 94,5).

### Segunda pasada: revisión adversarial de lo corregido

Cinco revisores independientes volvieron sobre la entrega con lentes distintos
(coherencia entre documentos, cobertura de casos, aritmética, calidad técnica del
schema, y utilidad para quien llegue nuevo). Encontraron **cuatro defectos que
habrían llegado a producción**:

- **El pago justo en efectivo dejaba `receivedAmount` y `changeAmount` en nulo**,
  y la fórmula del arqueo los suma. Veinte pagos exactos habrían desaparecido del
  cierre y el turno acusaría un faltante igual a casi toda la venta en efectivo
  del día — culpando al vendedor. El pago justo es la transacción más común del
  mesón. Ahora son obligatorios en toda pata de efectivo.
- **El redondeo "medio hacia arriba" rompía la anulación.** Una pata de $17.495
  redondea a $17.500 y su contraria a −$17.490: el par quedaba debiendo $10.
  Como los reportes suman todas las filas sin filtrar por estado, ese residuo se
  habría quedado en el total para siempre. El redondeo pasó a ser simétrico.
- **El índice único no imponía lo que este mismo documento afirmaba.** Probado
  contra SQLite: se podían abrir *tres* sesiones en la misma caja, y una sesión
  de CAJA-1 podía bloquear CAJA-2. Faltaban dos `CHECK` que Prisma no genera.
- **La fórmula del costo promedio no estaba escrita en ninguna parte.** "Recalcular
  el PMP" admite lecturas que dan números distintos; ahora está en ADR-005, con
  las reglas de qué movimientos la aplican y qué pasa con saldo cero o negativo.

### Lo aprendido en la segunda pasada

- **Afirmar "probado" no es haberlo probado del todo.** La primera versión de
  ADR-004 decía que la base imponía el invariante de caja. La prueba que corrí
  verificaba el caso feliz y el choque directo, no las formas de esquivar el
  mecanismo. La diferencia la encontró alguien que fue a buscar el agujero.
- **Los errores más caros estaban en los casos rutinarios, no en los raros.**
  Pagar justo y anular una venta: las dos cosas que más pasan en un mesón.

### Qué sigue

Sprint 0 desde la tarea 0.1: crear el repo y el monorepo. El schema ya está listo
para la migración inicial.

**Pendiente de Cristian:**

1. Las tres preguntas abiertas de `STATE.md`. La primera —si los dos puntos de
   venta futuros son dos cajas o dos sucursales— es la única que puede cambiar
   decisiones ya tomadas (el motor de base de datos y si el costo promedio pasa a
   ser por ubicación).
2. **Qué hacer con `STATE UI.md`.** Apareció en el directorio junto con
   `UI-BRIEF.md` mientras corría esta ronda, y es una copia del `STATE.md`
   anterior a los cambios: fija Prisma sin versión, no tiene
   `connection_limit=1`, usa la fórmula de margen vieja y trae la lista de fases
   que se eliminó por duplicar el plan. Un agente que lo abra el lunes creyendo
   que es el `STATE.md` bueno se equivoca justo en las tareas 0.2 y 0.3. No se
   tocó por ser trabajo del dueño; lo razonable es borrarlo y que `UI-BRIEF.md`
   —que sí es nuevo y sí sirve— quede enlazado desde `STATE.md`.

---

## 2026-07-30 — Ronda 3: el diseño entra al plan

Cristian eligió la dirección visual ("Mesón") y escribió `UI-BRIEF.md`. Esta
ronda lo integró al plan. **No se creó un sprint de UI**: el propio brief
reparte el diseño en una fundación visual dentro del S0 y una pantalla clave
por sprint, y así quedó en `SPRINTS.md`.

**Lo que el brief destapó, que no era un problema de diseño:**

1. **El principio "el vendedor no ve costos" no se puede cumplir en el
   frontend.** Si el endpoint devuelve `lineCostNet`, el dato ya cruzó la red
   y se lee en la pestaña de red del navegador; que la pantalla no lo pinte es
   irrelevante. Pasó a ser decisión sellada 17 y tarea 0.12: los DTO por rol
   se definen una vez en `packages/shared`, y un test recorre los endpoints
   con token de vendedor buscando los nombres de campo prohibidos.
2. **El brief pedía dos estados de venta y el modelo produce cinco.** Una
   venta con devoluciones parciales sigue en `COMPLETED`; una devuelta entera
   por partes también, y anularla se rechaza; y la fila contraria es un
   documento propio que aparece en el listado del día. Con dos chips, la
   pantalla de venta se diseñaba en el S3 para rehacerse en el S4. La tabla
   canónica quedó en `STATE.md` y el brief corregido.
3. **Las fuentes son un modo de falla silencioso.** La tienda no tiene
   internet: un `<link>` a Google Fonts anda en el PC del desarrollador y cae
   al fallback en el mesón. Es un chequeo de CI (tarea 0.10), no una
   esperanza de revisión de código.
4. **Los atajos no se pueden imprimir en pantalla todavía.** El brief promete
   F2/F4/F6/F8/F10 visibles, pero F5, F3 y F11 se las queda el navegador y F10
   le abre la barra de menú. Y nadie anotó nunca qué navegador corren los
   terminales: es la pregunta abierta 4. La tarea 3.11 define la tabla y exige
   verificar en el navegador real antes de enseñarle una tecla al vendedor.
5. **Nada implementaba "el foco siempre vuelve a la caja de escaneo".** El
   lector es un teclado: si el foco quedó en el campo de cantidad, el código
   escaneado se escribe ahí y se cobran 8.451 unidades. Quedó como invariante
   del S3.

**Lo aprendido:** un brief de interfaz honesto es una prueba de esfuerzo para
el modelo de datos. Tres de estos cinco hallazgos son de backend, y aparecieron
solo porque alguien escribió qué tiene que ver el vendedor en pantalla.

**Pendiente para Cristian:**

- `STATE UI.md` ya no contiene nada único: su sección "Diseño de interfaz"
  está integrada en `STATE.md`. El resto es la copia del `STATE.md` anterior a
  la ronda 2 y contradice lo vigente. Se puede borrar: `rm 'STATE UI.md'`.
- Responder la pregunta abierta 4 (navegador de los terminales) desbloquea
  la tarea 3.11.
- `ui-direcciones.html`, citado por el brief, no está en el repositorio.

---

## 2026-07-30 — Sprint 0: fundaciones, cerrado

12/12 tareas. 61 tests en verde. La demo corrió completa: admin y vendedor
entran con su PIN desde la misma pantalla y ven dashboards distintos servidos
por el mismo endpoint; el seed corre dos veces sin duplicar nada; las fuentes
salen del repo sin tocar internet.

**El hallazgo del sprint: la fórmula del PMP estaba mal escrita en el ADR-005.**

`valorAnterior` dividía por 1.000 cuando hay **dos** denominadores en juego —el
saldo en milésimas de unidad base y el costo en milésimas de peso—, así que
correspondía 1.000.000. El error es invisible en la primera compra, porque parte
de saldo cero y `valorAnterior` vale 0. Aparece en la segunda: comprar 100 m a
$1.000 y después 100 m a $2.000 daba **$501.000 por metro** en vez de $1.500.

Lo encontró un test al escribir `money.ts`, no la lectura del documento — y eso
después de que la fórmula pasara por una ronda de verificación numérica. La
lección es sencilla: una fórmula escrita en Markdown no está verificada hasta
que se ejecuta. Habría llegado al Sprint 4 convertida en un costo promedio
absurdo y un margen negativo en todos los reportes.

**Decisiones de implementación que valen la pena recordar:**

1. **El filtro de costos por rol es un hook global de Fastify**, no un `select`
   por endpoint. Se aplica antes de serializar, y sin token usa el criterio más
   restrictivo, no el más laxo. El endpoint 30 queda cubierto sin que nadie se
   acuerde de cubrirlo. Lo prueba un test contra una ruta que devuelve costos a
   propósito.
2. **Los dos `CHECK` de `CashSession` tienen guardián.** `prisma migrate dev` y
   `db push` los borrarían en silencio; `prisma/migracion.test.ts` levanta una
   base desde el SQL, verifica que las restricciones están y corre la matriz de
   7 casos del invariante de caja. Es la única alarma que existe.
3. **`connection_limit=1` se verifica al arrancar** y el servidor se niega a
   partir sin él, igual que con los autochequeos del seed. Un invariante que
   solo está escrito en un `.md` no es un invariante.
4. **Ningún color fuera de `tokens.css`**, impuesto por `pnpm check:tokens`. Y
   `pnpm check:offline` falla si algo apunta a un host remoto de fuentes o a un
   CDN: la tienda no tiene internet y ese modo de fallar es silencioso.
5. **argon2 vía `@node-rs/argon2`**, que publica binario `win32-x64-msvc`. Un
   módulo compilado con node-gyp en WSL no carga en el Windows de la tienda, y
   eso se habría descubierto recién en el Sprint 7, al instalar.

**Pendiente para Cristian:**

- **Mirar la interfaz en el navegador del terminal.** Se verificó por HTTP que
  las fuentes y los tokens se sirven; no que se vean bien a 1,5 m en el mesón.
- Responder la pregunta abierta 4 (qué navegador corren los terminales): sin eso
  no se puede cerrar la tabla de atajos del Sprint 3.
- Los PIN del seed se imprimen **una sola vez**. Si se perdieron, borrar la base
  de desarrollo y volver a sembrar.

---

## 2026-07-30 — Sprint 1: catálogo, capa de servidor

**Estado: las 8 tareas de servidor entregadas y probadas. La interfaz espera el
wireframe aprobado (tarea 1.7b).**

### Qué se hizo

Todo el backend del catálogo: productos con su alta, edición y baja (1.1),
códigos de barra múltiples (1.2), etiquetas Code128 encoladas en `PrintJob`
(1.3), categorías/marcas/proveedores (1.4), la caja única de búsqueda (1.5),
importador de Excel en dos pasos (1.6), el invariante de unidades con su texto
explicativo (1.7) y el CRUD de usuarios (1.8).

**150 tests en verde** (64 en `shared`, 83 en `server`, 3 en `web`), estables en
dos corridas completas seguidas.

### Lo que se aprendió

1. **`setErrorHandler` después de un `await register()` no cubre las rutas ya
   montadas, y falla en silencio.** Fastify cierra el contexto de arranque al
   esperar un plugin. Las rutas del Sprint 0 quedaron con el manejador por
   omisión: respondían el código correcto —por eso los tests pasaban— pero el
   cuerpo decía `{"error":"Bad Request"}` en vez del mensaje escrito a mano. El
   vendedor habría leído "Bad Request" donde el brief promete que lea qué
   corregir. Se descubrió recién cuando un test miró **el mensaje además del
   código**. El manejador ahora va antes de todo lo demás.

2. **SQLite no encuentra "Cañería" buscando "caneria", y tampoco "CAÑERÍA".**
   Su `LIKE` ignora mayúsculas solo en ASCII: para el motor la Ñ y la ñ son
   letras distintas, y las tildes no se ignoran nunca. En una ferretería chilena
   eso deja media repisa invisible desde la caja de búsqueda. Se agregó
   `Product.searchKey`, una columna con nombre + SKU + códigos ya normalizados,
   que se escribe en la misma transacción que el producto.

3. **El costo se digita solo hasta el primer movimiento.** Hasta el Sprint 4 no
   hay compras, así que el inventario inicial no tiene otra forma de cargar su
   costo que tecleándolo. Pero en cuanto entra mercadería, `costNetMilliPeso`
   pasa a ser el PMP —un caché reconstruible desde el libro— y dejarlo editable
   permitiría que un tecleo contradiga al libro sin dejar rastro. La regla se
   apaga sola: nadie tiene que acordarse de quitar el campo en el Sprint 4.

4. **El importador es todo o nada.** Cargar 497 de 500 productos es peor que no
   cargar ninguno: el admin no sabe cuáles entraron y la corrección es revisar
   500 filas a mano. El informe previo devuelve **todas** las filas con
   problema, no las diez primeras, y muestra qué categorías y marcas se
   crearían — que es donde se ven los errores de tipeo antes de que existan.

5. **Code128 se implementó a mano y se probó contra la especificación**, no
   contra sí mismo: los patrones de Start B (11010010000) y Stop (1100011101011)
   y el dígito de control de `FH-00001` calculado a mano. Un código que se ve
   como código de barras pero codifica mal se descubre con el cliente al frente.
   Una dependencia menos en un PC que nadie va a actualizar.

6. **La validación del producto vive una sola vez, en `packages/shared`.** Este
   sprint le abrió dos puertas al mismo dato —el formulario y el Excel—. Si el
   importador validara por su cuenta sería la puerta por donde entra lo que el
   formulario rechaza, y no se sabría hasta que el kardex mintiera.

7. **La prueba de la decisión sellada 17 ahora golpea rutas reales.** En el
   Sprint 0 se probaba contra un endpoint escrito a propósito para ser atrapado;
   ahora `costNetMilliPeso` sale de verdad desde `/api/products`, y los tests
   verifican que al vendedor no le llega —ni ahí, ni en la búsqueda, ni en el
   detalle— y que el cuerpo no venga vacío, que haría pasar el test sin probar
   nada.

### Pendiente para Cristian

- **Aprobar el wireframe de la pantalla de búsqueda/catálogo (1.7b).** Es una de
  las cinco pantallas clave y el brief (§7.2) exige el visto bueno antes de
  codear. Toda la interfaz del sprint espera eso: las decisiones de densidad y
  de columnas de esa pantalla se propagan al formulario de producto y a la
  pantalla de importación, así que construirlas antes es la retrabajo que la
  puerta existe para evitar.
- Responder la **pregunta abierta 4** (qué navegador corren los terminales, y en
  modo normal o kiosco). Sigue bloqueando la tabla de atajos del Sprint 3.

### El test intermitente, explicado y corregido

Quedó anotado acá como "observado, sin explicar": una de cada tres o cuatro
corridas, un archivo de test entero fallaba y sus casos salían como omitidos.
La sospecha inicial —una carrera al borrar la base compartida— **era falsa**.

El error real, una vez capturado, decía `Hook timed out in 60000ms`. Midiendo:
la preparación de cada archivo tardaba **33 segundos**, con 485 ms por sentencia
de migración y 341 ms por insert. Los tests nunca activaban WAL, así que SQLite
quedaba en su modo por omisión y hacía un `fsync` **por sentencia**; el
`beforeAll` rozaba su límite de 60 s y a veces lo pasaba.

Con `journal_mode=WAL` y `synchronous=NORMAL`, y las 69 sentencias de migración
en una sola transacción: **1,9 segundos**. La suite del servidor bajó de 217 s a
10,5 s, y `pnpm check` corrió cinco veces seguidas en verde.

Además cada archivo de test recibe ahora **su propia base**, con nombre único
puesto antes de que se construya el cliente de Prisma. Ya no había carrera que
arreglar, pero compartir un archivo entre tests no aportaba nada.

Lo que se aprendió: perseguir un test intermitente hasta el mensaje literal vale
la pena. Con la primera hipótesis —plausible, y equivocada— habría "arreglado"
una carrera inexistente y el timeout habría seguido ahí, más raro todavía.

### Corrección del mismo día, tras revisar el importador

Tres cosas que los 150 tests no podían ver, porque ninguna es un error de
formato:

1. **Las dos columnas de plata del Excel estaban en unidades distintas y
   ninguna lo decía.** `priceGross` va por unidad de VENTA y
   `costNetMilliPeso` por unidad BASE. Coinciden solo cuando la unidad de venta
   *es* la base, y dejan de coincidir justo en los productos que motivaron todo
   el sistema de unidades: el saco de 25 kg, la caja de 100, la docena. Quien
   llena la plantilla escribe el precio del saco donde el sistema espera el del
   kilo, la carga no da ningún error —el número es válido— y el margen, el
   inventario valorizado y la alerta de reposición heredan el error para
   siempre. Se corrigió por tres lados: los títulos de las columnas dicen la
   unidad, la plantilla trae notas con un ejemplo concreto, y **el informe
   previo ahora devuelve cómo entendió cada fila** (`$6.490 por sc25 · costo
   $180 por kg · mínimo 200 kg`). Eso último es lo que hace útil el paso previo:
   antes, una fila que parseaba limpio era invisible.
2. **Hay un aviso cuando el costo, llevado a la unidad de venta, no queda por
   debajo del precio.** Comparar los números crudos no habría servido: cemento
   a $6.490 el saco con costo "4.900" tecleado creyendo que era por saco se
   guarda por kilo, o sea $122.500 el saco — y "4900 contra 6490" se ve
   perfectamente sano. La comparación convertida lo atrapa. Avisa, no bloquea:
   hay liquidaciones de verdad.
3. **El nombre del producto iba a la térmica en latin1.** Las ESC/POS usan una
   tabla tipo CP437/CP850, donde la ñ es 0xA4 y no 0xF1: "Cañería PVC" habría
   salido como basura, y no hay forma de comprobarlo sin la impresora en la
   mano. Ahora se manda sin tildes —"Caneria PVC" se lee, el mojibake no— y hay
   un test que verifica que ni un byte del trabajo pase de 0x7F. Cuando en el
   Sprint 3 se conecte la térmica de verdad se sabrá qué tabla usa; el ticket
   va a necesitar la misma decisión.

Y una cuarta, encontrada al mirar la etiqueta renderizada en vez de solo
verificar que el endpoint devolviera un SVG: **el Code128 no tenía zona muda**.
La norma pide 10 módulos en blanco a cada lado; el lector localiza el código
buscando la transición blanco→barra, y sin margen no encuentra dónde empieza.
El código estaba perfectamente codificado —verificado contra la
especificación— y se veía impecable en pantalla. La etiqueta impresa
simplemente no habría leído.

**92 tests en el servidor y 160 en el repo.**

---

## 2026-07-30 — Sprint 1: la pantalla de catálogo, y dos errores de unidad

Cristian aprobó el wireframe y respondió las cuatro preguntas abiertas. **No
queda ninguna pregunta abierta en el proyecto.**

- **2 cajas en la misma tienda.** Cierra la más importante. El costo promedio
  global deja de ser una decisión provisional y pasa a ser la correcta.
- **Un turno, 1 o 2 personas.** Una apertura y un cierre de caja al día.
- **Balanza aparte, el peso se digita.** Confirma lo asumido.
- **Chrome en modo normal.** Los atajos quedan en F2, F4, F6 y F8; F3, F5, F10
  y F11 se las queda el navegador. La tabla vive en `packages/shared/atajos.ts`
  con un test que rechaza cualquier tecla que Chrome no suelte, y el brief se
  corrigió: prometía F10.

### El mismo error, dos veces, en dos lugares distintos

La captura de la pantalla nueva mostró el cemento con **96,7% de margen**. El
real es 17,5%. La columna COSTO traía pesos por unidad **base** y el precio de
al lado, por unidad de **venta**: $180 el kilo contra $6.490 el saco de 25.

Es exactamente el error que un día antes se había corregido en el importador, y
lo volví a cometer al escribir la tabla — que es la mejor prueba de que no
alcanza con saberlo. La conversión se mudó a `packages/shared`
(`costoPorUnidadDeVenta`, `margenPorcentaje`), donde el reporte de margen del
Sprint 4 y el inventario valorizado la van a encontrar hecha.

### Los tokens llevaban todo el Sprint 0 sin poder tener opacidad

El velo oscuro del diálogo no oscurecía nada. Al medir en el navegador:
`bg-ink/40` daba `rgba(0,0,0,0)`, `bg-error/10` también, y `border-error/30`
caía al gris por defecto de Tailwind.

Causa: los tokens estaban en hexadecimal. Tailwind sirve `bg-ink/40` como
`rgb(var(--fh-ink) / 0.4)`, y con `#16181a` adentro eso es CSS **inválido**, así
que el navegador descarta la declaración entera sin decir nada. O sea que el
`Chip` de estado —el componente que existe para cumplir "color + palabra", el
principio 4 del brief— nunca tuvo color de fondo desde que se escribió.

Los tokens ahora son canales (`--fh-ink: 22 24 26`) y Tailwind los pide con
`<alpha-value>`. Hay un test que falla si alguien vuelve a poner un
hexadecimal, porque el que existía comprobaba que la variable estuviera
definida y eso no bastaba: estaba definida, y aun así no pintaba.

**Los dos defectos se encontraron mirando una captura, no fallando un test.**

### Una decisión de rol que la captura también corrigió

Al vendedor se le imprimía "F6 imprimir etiqueta", pero el servidor exige
administrador para encolar una etiqueta. Un atajo que responde "no autorizado"
es peor que ninguno. Al vendedor le quedan ↑↓ y Enter.

---

## 2026-07-30 — Sprint 2: caja, capa de servidor

Las 7 tareas de servidor entregadas. **218 tests en verde**, 45 nuevos. La
pantalla de cierre (2.8) es clave y espera el ok al wireframe.

El repositorio quedó publicado: `hola224/ferrehouse-manager`, privado, con
`main` y `sprint-1-catalogo`. Ninguna de las quince claves SSH de la máquina
servía —todas son de despliegue, atadas a un repositorio ya existente—, así que
se generó una propia siguiendo la misma convención.

### Lo que se decidió construyendo

1. **La apertura duplicada la rechaza la base de datos, y el servidor solo
   traduce el error a castellano.** No hay chequeo previo, y es deliberado: con
   dos terminales, entre el SELECT y el INSERT cabe una segunda apertura. El
   `@unique` sobre `openStationId` no tiene esa ventana. El código atrapa el
   P2002 y responde nombrando a quién dejó la caja abierta.

2. **El signo lo pone el servidor.** El cliente manda tipo y monto positivo. Si
   pudiera mandar `-5000` en un ingreso, un error de tipeo se convertiría en un
   retiro sin motivo registrado, que es exactamente lo que la tarea 2.3 quiere
   impedir.

3. **No se puede retirar más de lo que hay.** No es una preferencia: con saldo
   esperado negativo, la diferencia del arqueo pasa a compararse contra un
   número imposible y deja de medir nada.

4. **El movimiento de cierre lleva la diferencia como monto**, de modo que el
   saldo final del libro sea lo que hay de verdad en el cajón. Si cuadra, el
   monto es cero. Un auditor quiere ver la realidad, no lo que el sistema creía.

5. **Gana el error de fondo, no el primero que encuentra la validación.** Un
   test lo destapó: con la caja cerrada y el motivo en blanco, la respuesta era
   "escribe el motivo". El vendedor lo escribiría y recién entonces se enteraría
   de que la caja estaba cerrada. Ahora la sesión se comprueba antes de validar
   el cuerpo.

6. **Que sobre plata descuadra igual que si faltara.** Sobrar significa que algo
   no se registró —una venta cobrada y no ingresada, un vuelto mal dado— y es
   tan sintomático como que falte. El umbral se compara en valor absoluto, y el
   mensaje nombra la causa probable.

7. **El papel y la pantalla dicen lo mismo**, porque los dos llaman a
   `estadoArqueo` de `shared`. En papel térmico no hay color, así que la palabra
   no es un complemento del color: es la única señal que queda.

### Conteo ciego: la decisión, y por qué costó más que reordenar la pantalla

Cristian eligió el **conteo ciego**: el sistema no muestra cuánto debería haber
hasta que el vendedor ingresó lo que contó. El motivo es el anclaje — cuando la
cuenta da $226.930 y la pantalla dice $227.430, la tentación de pensar "habré
contado mal" y teclear el número redondo es real, y ahí el arqueo deja de medir.

Lo que no era obvio: **implementarlo solo en la pantalla lo dejaba decorativo**.
Si el monto esperado igual viaja en el JSON, basta abrir la pestaña de red. Es
exactamente el razonamiento de la decisión sellada 17 con los costos, aplicado a
otra cosa. Hubo que cerrar cuatro fugas, y tres no eran evidentes:

1. `GET /api/cash/expected` pasó a ser solo del administrador.
2. `GET /api/cash/current` le devolvía el saldo corrido y el `balanceAfter` de
   cada movimiento. También el monto de apertura, que sumado a los movimientos
   da el esperado.
3. La respuesta de cada movimiento traía el saldo resultante y un mensaje
   "Quedan $40.000 en la caja".
4. El error al retirar de más decía cuánto había: probando retiros cada vez
   menores, un vendedor podía averiguar el esperado antes de contar. Ahora al
   vendedor le dice "no alcanza el efectivo" y al administrador el número.

El vendedor **sí** sigue viendo la lista de movimientos con su motivo: es con
eso que detecta un olvido antes de cerrar, y no permite deducir el total. Seis
tests nuevos golpean cada endpoint con token de vendedor y fallan si el número
se filtra, incluido uno que busca el número crudo en el cuerpo de la respuesta.

El brief quedó corregido: §5.2 prometía "sistema muestra esperado → vendedor
cuenta".

### Pendiente para Cristian

- **Aprobar el wireframe del cierre de caja (2.8)**, ya reescrito con el conteo
  ciego.

### La pantalla de cierre, y el texto que pedía algo imposible

Wireframe aprobado y construido. Verificada en pantalla a 1366×768 recorriendo
el turno completo con token de vendedor: abrir, retirar por el flete, contar,
confirmar y ver la diferencia.

Mirarla destapó tres cosas que ningún test veía:

1. **`$-10.000`.** El signo quedaba después del peso, y en una columna angosta
   se lee como un guion perdido. Está en `formatCLP`, o sea que afectaba a toda
   la plata negativa del sistema —el reporte impreso, y las devoluciones que
   vienen en el Sprint 3—. Ahora es `-$10.000`.

2. **"09:01 p. m."** en la tabla de movimientos. `es-CL` devuelve 12 horas por
   omisión; en una tienda se habla en 24. Se agregó `formatHora` a `shared`
   para que no lo decida cada pantalla.

3. **El texto pedía algo imposible.** El mensaje decía "cuenta de nuevo antes de
   cerrar" justo encima de una nota que decía que la caja ya estaba cerrada. Y
   las dos eran ciertas: con conteo ciego, mostrar el esperado ES comprometer el
   conteo, y comprometerlo es cerrar. No hay forma de que el paso 3 sea previo
   al cierre.

   La corrección no fue cambiar el flujo sino las palabras: el paso 3 habla en
   pasado —"quedó registrado"— y su botón imprime el respaldo en vez de prometer
   un cierre que ya ocurrió. La advertencia se movió al **paso 2**, que es donde
   todavía se puede volver atrás, y ahí dice con todas sus letras que es el punto
   de no retorno. Un texto que pide algo imposible enseña a no leer los textos,
   y eso se paga en la pantalla siguiente.

---

## 2026-07-30 — Sprint 3: el POS, capa de servidor

Las 9 tareas de servidor del sprint más pesado del plan. **278 tests en verde**,
52 nuevos. La pantalla de venta (3.10) espera el ok al wireframe.

### Lo que se decidió construyendo

1. **La aritmética de la venta vive en `packages/shared`, sin tocar la base.**
   Es lo único del sistema donde un error de un peso se multiplica por todas las
   ventas del día y aparece recién en el arqueo. Separada así se prueba con
   tablas de casos, y eso es lo que hace `sale.test.ts`: 24 casos que incluyen
   el redondeo hacia arriba y hacia abajo, pago justo, pago mixto y una venta de
   mesón completa.

2. **El cliente no manda el monto en efectivo: manda lo que el cliente PUSO
   sobre el mesón.** Pedirle un `amount` obligaría a la pantalla a calcular el
   redondeo, y entonces el redondeo tendría dos implementaciones que un día se
   van a separar. Con `receivedAmount`, el servidor calcula el redondeo, la
   imputación y el vuelto, y la pantalla solo muestra.

3. **El redondeo solo existe si hay pata en efectivo.** Con todo pagado con
   tarjeta, un ajuste de $5 quedaría sin contraparte: el banco cobra el monto
   exacto. Si la tarjeta no cubre el total y no hay efectivo, se rechaza.

4. **El tope de descuento se mide sobre el total, no por línea.** Tres
   descuentos del 5% en tres líneas suman 15% de la boleta y habrían pasado sin
   autorización.

5. **El PIN de override se valida contra cualquier administrador activo**, no
   contra uno fijo: lo digita quien esté en el mesón. Y la bitácora guarda quién
   autorizó, que es la única razón por la que el override existe.

6. **El pulso del cajón va en el mismo trabajo que el ticket, y después del
   corte.** El cajón cuelga de la impresora: en trabajos separados, si la cola
   se atasca entre uno y otro, el vendedor tiene el ticket en la mano y el cajón
   cerrado con el cliente esperando el vuelto. Y no se abre en una venta pagada
   entera con tarjeta, ni en una reimpresión — abrir el cajón sin una venta
   detrás es justo lo que un arqueo no puede explicar.

7. **Al recuperar una espera, el precio guardado nunca se cobra.** Se relee el
   vigente y se muestra el delta. Si además cambió la unidad de venta, eso se
   avisa **antes** que el precio: dos unidades del mismo grupo —un rollo y un
   metro— pasan cualquier validación de grupo, y la cantidad guardada
   significaría otra cosa.

8. **La venta descuenta stock sin validar saldo**, y es deliberado: está en el
   plan que la validación llega en el Sprint 4 con el kardex. Queda escrito en
   el wireframe para que nadie lo lea como un olvido.

### Un test que probaba menos de lo que decía

La aserción "ningún byte del ticket pasa de 0x7F" fallaba, y no por un acento:
el pulso del cajón termina en **250**, que es un comando. Con la aserción a
secas habría bastado con quitar el pulso para que "pasara", sin probar nada del
nombre del producto. Ahora el test vende una "Cañería PVC" y comprueba dos
cosas por separado: que en el papel diga "Caneria PVC", y que los únicos bytes
altos sean exactamente los del pulso.

### La pantalla de venta, y el ticket que nunca salió

Wireframe aprobado y construido. Verificada vendiendo de verdad con token de
vendedor: escanear, sumar a una línea existente, cobrar mixto y confirmar.

**La vista previa de los totales usa `calcularVenta` de `shared`, la misma
función que el servidor ejecuta al cobrar.** No hay una aritmética "de pantalla"
y otra "de verdad": el redondeo que el vendedor ve es el que se va a cobrar,
porque es el mismo código.

Vender de verdad destapó tres cosas:

1. **El tipo de documento no se distinguía.** Boleta, Factura y Ninguno eran
   tres botones idénticos, y "Boleta" ya estaba elegido sin que se notara. El
   borde condicional que los diferenciaba competía en especificidad con el borde
   base y perdía. Se reemplazaron por radios de verdad: el punto no depende del
   color y además se recorren con las flechas, que en una pantalla que se opera
   sin mouse no es un detalle.

2. **Una nota afirmaba algo que nadie había verificado.** Con los montos sin
   cuadrar, la vista previa es nula y aun así el pie decía "el cajón no se abre:
   esta venta va toda con tarjeta", cuando sí había efectivo escrito. Es el
   mismo error del chip de caja del Sprint 0: afirmar un estado que no se
   calculó. Ahora la nota solo aparece cuando el cálculo es válido.

3. **La venta se cobró y no salió ticket, en silencio.** La caja de pruebas no
   tenía impresora configurada, así que el trabajo de impresión no se creó — y
   eso está bien, la decisión sellada 15 dice que una venta jamás se bloquea por
   la impresión. Lo que estaba mal era callarlo: la pantalla decía "Cobrado" y
   prometía un ticket que nunca llegó. En la tienda eso significa vender toda una
   mañana sin comprobante y enterarse cuando un cliente lo pida. Ahora la venta
   sigue igual y aparece un aviso ámbar que nombra la caja.

Las tres salieron de usar la pantalla, no de los tests. Los 280 pasaban.

---

## 2026-07-30 — Sprint 4: kardex, compras y devoluciones

Las 9 tareas del sprint. **331 tests en verde**, 51 nuevos. El inventario
empieza a decir la verdad: hasta acá el stock era un número que solo bajaba.

### Un solo escritor para el libro

Escribir un movimiento son cuatro pasos que van juntos o no van: leer el saldo
anterior, calcular saldo y costo promedio resultantes, insertar la fila con esas
dos fotos, actualizar el caché `StockLevel`. Compra, venta, ajuste, merma,
devolución e inventario inicial hacen lo **mismo** con distinto signo.

Copiado seis veces, basta que una copia olvide `balanceCostNetMilliPeso` para
que el kardex mienta sobre el costo sin que ninguna prueba lo note: el saldo
—que es lo que se mira— seguiría bien. Por eso `stock-ledger.ts` es el único
lugar del sistema que escribe en `StockMovement`, y recibe la transacción por
parámetro: nunca abre la suya, porque el movimiento y lo que lo origina tienen
que ser atómicos entre sí.

### Tres cosas que estaban mal y no se veían

1. **El promedio ponderado con saldo negativo.** `recalcAverageCost`
   conservaba el costo viejo cuando el saldo anterior era bajo cero — que es
   exactamente el estado con que llega este sprint, porque el Sprint 3 vendió
   contra stock sin cargar. Se digitaba la factura con el precio nuevo del
   proveedor y el sistema seguía calculando el margen con el costo obsoleto, en
   silencio. Ahora, con saldo bajo cero, **manda el costo de lo que entra**: es
   el único dato real que hay. Promediar contra una deuda cuyo costo nunca
   existió da un promedio por debajo de lo que se acaba de pagar.

2. **El bloqueo del costo contaba las ventas.** La decisión sellada 18 dice que
   el costo se teclea hasta el primer movimiento; el código contaba *todos* los
   movimientos, y una venta no fija ningún costo — lo copia del vigente. Un
   producto vendido antes de cargar el inventario inicial quedaba con el costo
   bloqueado para siempre, sin forma de corregir un tecleo malo. Ahora solo lo
   bloquean los tipos que traen costo propio: compra, inventario inicial,
   devolución y traslado que entra.

3. **`deriveSaleStatus` pedía un campo que no existe.** Recibía
   `returnedQtyMilli` por línea, que no es columna de `SaleItem` y que nada
   calculaba: un molde sin nadie que lo llenara, escrito en el Sprint 3 y nunca
   alimentado. Ahora la cantidad devuelta se deriva en **un** solo lugar
   (`resumirLineas`) y de ahí viven las tres cosas que la necesitan: el
   invariante que impide devolver más de lo vendido, la etiqueta que ve el
   usuario y el prorrateo del costo.

### El prorrateo es acumulativo, no por trozo

Para repartir el costo de una línea entre varias devoluciones parciales no se
prorratea cada trozo por separado: se calcula cuánto corresponde al **total
devuelto hasta ahora** y se resta lo que ya se había devuelto. Así la devolución
que agota la línea se lleva el residuo sola, sin ninguna regla especial.

Tres devoluciones de un tercio de $1.000 devuelven 333, 334 y 333 —exactamente
$1.000—. Prorrateando cada trozo por su cuenta, cada una se lleva 333 y el peso
que sobra no vuelve nunca: el costo histórico de la venta queda descuadrado
contra el libro de stock, en el número con que se calcula el margen.

La misma regla reparte el descuento y el redondeo de cabecera. Ignorar el
descuento al devolver es devolverle al cliente más plata de la que pagó.

### Lo que decidió el resto

- **La venta valida saldo y junta todas las líneas que no alcanzan antes de
  reclamar.** Fallar en la primera obliga a corregir, reintentar y descubrir la
  segunda: en el mesón, con el cliente al frente, son tres viajes a la bodega en
  vez de uno. Un administrador puede autorizar igual —la ferretería no deja de
  vender porque el sistema esté atrasado—, y la autorización queda como
  `STOCK_OVERRIDE` en la bitácora.
- **La reconciliación escribe la alerta ANTES de corregir el caché.** Al revés,
  la corrección borraría la única evidencia de que hubo descuadre: el saldo
  quedaría bien y nadie se enteraría de que el caché se había despegado del
  libro, que es justo lo que ese job existe para detectar.
- **El efectivo de una devolución sale de la caja abierta ahora**, no de la del
  día de la venta, que puede llevar semanas cerrada. Y si no hay suficiente en
  el cajón se dice con el saldo a la vista, en vez de dejar el arqueo en
  negativo.
- **La devolución la autoriza un administrador**, igual que un descuento fuera
  de tope. No es desconfianza: es que la autorización quede registrada y sea de
  alguien.

### La pantalla de kardex (4.8)

Wireframe aprobado por Cristian, con una decisión propia: **el orden es el de
tecleo, no el de fecha**. El saldo de cada fila es una foto tomada al escribir
el movimiento; ordenando por fecha, una factura del viernes digitada el lunes
aparecería entre los movimientos del viernes con un saldo que no calza con la
fila de arriba. La fecha del hecho se lee en su columna.

Cuatro defectos aparecieron al usarla, con los 329 tests de entonces en verde:

1. **El costo promedio decía `$486 / m` cuando era `$485,59`.** Redondear a
   pesos enteros un costo *por unidad* es exactamente el error de 14% que la
   decisión sellada 2 existe para evitar: un tarugo de $3,5 se vería como $4.
   `formatCLP` es para plata que cambia de manos; las razones ahora tienen su
   propio `formatCostoMilli`.
2. **Una devolución se referenciaba como «Venta #3».** La fila #3 *es* la nota
   de crédito: quien siguiera esa referencia para entender por qué volvieron 2 m
   encontraría la devolución misma, no la venta que la originó. Ahora dice
   «Devolución #3 — de la venta #2».
3. **El estado vacío mandaba a buscar algo que no existe.** Un producto recién
   creado decía «no hay movimientos con ese filtro, prueba con toda la
   historia», y toda la historia tampoco tenía nada. El mensaje ahora depende de
   si hay historia, dato que el servidor calcula ignorando los filtros.
4. **La barra decía que uno estaba en Venta** estando en el kardex: la pestaña
   activa era una clase fija, no un `NavLink`.

Y una defensa que no salió de un defecto sino de imaginar el error: el campo de
ajuste pide **la diferencia**, y lo natural es teclear lo que uno contó. Ahora,
mientras se escribe, la pantalla dice en cuánto queda. Escribir 275 donde iba
−3 muestra «Queda en 553 m» antes de confirmar.

### Dos limpiezas al cerrar

`formatCostoMilli` entró a `money.ts` —el archivo con la disciplina más
estricta del repo— sin un solo test; ahora tiene cuatro, incluido el del signo
delante del peso, que es el que se rompe solo al copiar el patrón.

Y se borró `costoUnitarioBaseMilliPeso`: se escribió con dos tests que pasaban
y nadie lo llamaba nunca. Es la misma clase de cosa que este sprint arregló en
`deriveSaleStatus` —un molde sin nadie que lo llene—, y dejarlo con tests
verdes es peor que no tenerlo: parece verificado.

### Lo que no se construyó

La **pantalla de compras**: la tarea 4.1 entrega el endpoint y el sprint pide
solo el kardex. Digitar una factura sigue siendo por API. Es la primera
candidata para el próximo sprint, junto con las tres pantallas que el Sprint 1
dejó pendientes.

---

## Sprint 5 — Reportes y alertas — cerrado el 2026-07-30

Las 7 tareas, incluida la pantalla clave. **390 tests en verde** (150 shared,
233 servidor, 7 web). El sistema empezó a hablarle al administrador: cuánto se
vendió, cuánto de eso quedó, qué hay en repisa y qué hay que reponer.

### Un solo lugar reparte la plata de una venta (5.1 y 5.2)

`desglosarVenta`, en `packages/shared/src/reports.ts`. El total del día, el
margen por producto, el margen por categoría y la venta por vendedor son cuatro
cortes de los mismos números. Calculados por separado darían cifras **parecidas
y distintas**, que es lo peor que pueden dar: nadie sospecha, y el que decide
con el reporte de márgenes decide con otra plata que la que cuadró en caja.

Dos repartos, los dos acumulativos como manda la decisión sellada 23:

1. **El ajuste de cabecera.** El descuento y el redondeo se aplican a la venta
   entera. Repartirlos por línea y redondear cada trozo deja migajas que no
   suman el original; se calcula cuánto corresponde al bruto acumulado hasta
   cada línea y se resta el de la anterior. La última línea se lleva el residuo
   sola, porque su acumulado es exactamente el subtotal.
2. **El neto.** El IVA es por residuo sobre el total del documento (decisión
   sellada 1), no línea por línea. Mismo truco sobre el bruto ya ajustado.

Resultado: Σ bruto === totalGross y Σ neto === netFromGross(totalGross), al
peso, con o sin descuento, con o sin devoluciones.

**El residuo se lo lleva siempre la misma línea**, la de `id` mayor, con el
orden explícito en el código. Si lo decidiera la base de datos, el mismo reporte
corrido dos veces le atribuiría el peso sobrante a un producto distinto y el
margen de dos productos bailaría sin que nadie haya vendido nada.

### El valorizado no lee la última foto: suma el libro (5.3)

El plan del sprint decía "reconstruido desde `balanceBaseMilli` +
`balanceCostNetMilliPeso`". **Eso no funciona**, y la razón la puso el propio
Sprint 4: esas dos columnas son fotos tomadas en orden de ESCRITURA, mientras
que `createdAt` es la fecha del HECHO. Una factura digitada hoy con recepción de
la semana pasada lleva `createdAt` de la semana pasada y un `balanceBaseMilli`
calculado sobre el saldo de hoy, ventas de esta semana incluidas. Buscar "la
última fila con fecha ≤ X" y creerle su foto devuelve un número que **nunca fue
cierto**.

Sumar `qtyBaseMilli` y `totalCostNet` sí funciona, y es exactamente para lo que
la decisión sellada 4 guardó el monto exacto de cada movimiento en vez de una
razón: los montos se suman sin acumular error.

Un producto con saldo bajo cero se muestra en negativo, no se esconde: es una
deuda de stock, y esconderla haría que el valorizado no cuadre contra el libro,
que es lo único que este reporte promete.

### Dos clases de alerta, dos mecanismos (5.5 y 5.6)

- **Estado** — `LOW_STOCK` y `OUT_OF_STOCK` describen cómo está la repisa
  ahora. Se evalúan dentro del movimiento que cambia el saldo (el único instante
  en que el estado puede cambiar) y ahí mismo se cierran solas cuando dejan de
  ser ciertas. Una alerta que dice "quedan 3 m" cuando hay 200 no es una alerta
  vieja: es una mentira en pantalla, y el panel entero pierde credibilidad por
  ella. Resolverlas a mano sigue sirviendo: las calla hasta el próximo
  movimiento de ese producto — "ya lo pedí".
- **Hecho** — `CASH_DIFFERENCE` y `STOCK_RECONCILE_DIFF` describen algo que
  pasó. No se deduplican ni se cierran solas.

**La de venta en espera añeja no se guarda: se deriva al leer.** No existe
ningún evento que dispararla —que pase el tiempo no es un evento—, así que
persistirla obligaría a un barrido periódico, y un barrido cada N minutos sobre
una condición que dura días escribe la misma alerta veinte veces. Derivarla es
la misma doctrina de `deriveSaleStatus`. Sin migración y sin temporizador.

### Cuadratura de folios por serie (5.4)

Cada tipo de documento numera aparte: la boleta 120 y la factura 120 conviven, y
mezclarlas en una sola secuencia inventa huecos que no existen y esconde los que
sí. Solo se buscan huecos **dentro** del mínimo y el máximo observados en el
rango: entre el último folio de ayer y el primero de hoy no hay hueco, hay
noche. Y se acusa en el reporte y no con un `unique` en la base (POS-07), que
impediría corregir el tipeo que casi siempre causa el duplicado.

### El dashboard (5.7)

Wireframe aprobado por Cristian: cuatro números arriba, alertas abajo a lo
ancho. Y una decisión que salió de la pregunta: **el vendedor entra directo a
Venta**. Su panel no tendría ninguna cifra que mostrarle, y no es solo el
margen — **tampoco la venta del día**: el arqueo es a ciegas y casi toda la
venta es efectivo, así que decirle cuánto se vendió es decirle cuánto debería
tener el cajón, que es justo el número que el cierre a ciegas le esconde. La
rama es del servidor: la clave no existe en su JSON.

Tres defectos aparecieron al mirar la pantalla, con los 382 tests de entonces en
verde:

1. **El dashboard mostraba cinco alertas y no había adónde ir a ver el resto.**
   La tarea 5.5 pide un panel con resolución y quedaba a medias: con doce
   alertas, siete eran invisibles. Los reportes tienen ahora una cuarta pestaña
   que es el panel completo.
2. **Las dos acciones de la lista tenían distinto tamaño y distinta posición**
   —una era botón y la otra un enlace chico—, así que la columna de acciones no
   se podía barrer con la vista. Y el ● de crítica y el ▲ de aviso no miden lo
   mismo: el mensaje se corría seis píxeles entre filas.
3. **Dos fechas salían en formato de cable**: "Jueves, 30 de julio" con una coma
   que en español no va, y "neto, al 2026-07-30" en la tarjeta del valorizado.

### Cuatro más, de una segunda pasada por la pantalla

4. **El dashboard llamaba «devolución» a una anulación.** La cuenta sumaba
   todas las filas con `reversalKind`, así que una venta anulada se informaba
   como devuelta. Este proyecto separa las dos palabras en todas partes —la
   tabla de estados de STATE.md las distingue, y el defecto 2 del Sprint 4 fue
   exactamente esta confusión—: ahora se cuentan y se nombran aparte.
5. **Un producto marcado como fuera de línea (`active: false`) seguía
   alertando.** El guard miraba solo `deletedAt`, pero el schema define
   `active: false` como "agotado de línea, fuera de temporada": que esté en
   cero es lo esperado, no una noticia. Alcanzable hoy con una merma.
6. **La cifra grande se comía el padding de la tarjeta con siete cifras.** Un
   sábado de `$1.234.567` mide 236px a 40px de cuerpo, dentro de una tarjeta
   con 232px útiles: no se salía del borde, pero quedaba pegada al filo, y los
   puntos de miles no dan punto de corte para que el texto se parta solo. Se
   vio renderizando el dashboard con un día que todavía no ocurrió, y baja a
   32px cuando el número pasa de nueve caracteres. **1366×768 es el
   presupuesto que fija el brief, no una aspiración.**
7. **El enlace de la alerta al kardex nunca se había hecho clic.** Funciona:
   se agregó y se verificó abriendo el panel y siguiéndolo hasta la historia
   completa del producto.

También se miró **la pantalla de las 9 de la mañana** —cero ventas, cero
alertas, caja cerrada—, que es la que Cristian ve todos los días antes de
abrir y la única que nunca aparece mientras uno prueba con datos cargados.
Está bien: "Todavía no se vende nada hoy", "Sin ventas que medir", "Cerrada"
con el enlace para abrir el turno, y las alertas en cero **en verde**, porque
el panel vacío es la buena noticia.

### Dos endpoints que se movieron

`/api/stock/alerts` → `/api/alerts` (ahora incluye las derivadas y permite
resolver) y `/api/stock/valued` → `/api/reports/inventory`. Los dos valorizados
daban números distintos —uno suma montos exactos, el otro multiplica el caché
por una razón redondeada— y dejar los dos vivos garantizaba que alguien
comparara y no supiera a cuál creerle. Ninguna pantalla los llamaba: mover fue
gratis.

`margenPorcentaje` se llamaba igual en dos partes y medía cosas distintas. Ahora
son `margenDeListaPct` (lo que el producto dejaría al precio de repisa, que es
lo que muestra el catálogo) y `margenRealizadoPct` (lo que la venta dejó de
verdad, con su descuento repartido y el costo congelado). Dan números distintos
para el mismo producto **a propósito**.

### Lo que no se construyó

Sigue sin pantalla la **compra a proveedor** (endpoint del Sprint 4) y las tres
del Sprint 1: alta de producto, importación y usuarios. Digitar una factura
sigue siendo por API.
