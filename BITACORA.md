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

### Observado, sin explicar

Una corrida de `users.test.ts` + `import.test.ts` falló al **cargar** el primer
archivo. No se reprodujo en cuatro corridas posteriores, incluidas dos de la
suite completa. Los archivos de test comparten una misma base SQLite que cada
uno borra y recrea, así que la sospecha es una condición de carrera con el
archivo WAL; queda anotado sin arreglar, porque arreglar lo que no se sabe
reproducir suele ser cambiar de síntoma.
