# ADR-007 — El acento pasa al rojo de marca, y el POS se separa del backoffice

**Fecha:** 2026-07-31 · **Estado:** Vigente · **Reemplaza parcialmente:** `UI-BRIEF.md` §4 (dirección "Mesón") y §5

> Llega desde `design_handoff_marca_ferrehouse/ADR-marca-y-navegacion.md`, que
> es el traspaso de diseño. Se copia acá porque el registro de decisiones del
> repo es donde se busca el *por qué* de algo, y una decisión que solo vive en
> la carpeta de una entrega se pierde en cuanto la entrega se archiva.

## Contexto

`UI-BRIEF.md` eligió el 2026-07-30 la dirección **A — "Mesón"**: amarillo
seguridad #FFC400 como acento único, sobre blanco frío y tinta #16181A. La
elección se hizo antes de tener el logo del negocio a la vista.

Ferretería House tiene una identidad establecida: rojo #F9353F, geometría de
ángulo recto, monograma FH dentro de la silueta de una casa. El amarillo no
aparece en ninguna parte de esa identidad.

Además, la barra de navegación única acumuló nueve destinos para el
administrador y cinco para el vendedor. El vendedor abre Venta el 100% de las
veces y usa Caja al empezar y al terminar el turno; las otras tres pestañas son
ruido en una barra que mira ocho horas al día.

## Decisión

**1. El acento pasa a #F9353F, el rojo del logo.** El amarillo se retira por
completo, no queda como color secundario. Se conserva íntegra la disciplina que
tenía: rojo pleno **solo** en la acción principal de cada pantalla y en la
franja de alerta crítica. Todo lo demás es blanco, negro y gris.

**2. Radio cero en todo.** `--fh-radio` pasa de 6px a 0px. El logo es todo
ángulo recto; el 6px era un default heredado, no una decisión.

**3. Dos cascarones de navegación.** `PosShell` para el vendedor —barra
superior negra de 56px y riel izquierdo de 104px con cuatro destinos— y
`AdminShell` para el administrador —barra lateral oscura de 236px con la
navegación agrupada en Hoy, Inventario, Plata y Tienda—. El administrador
alterna con «Ir a vender» y con la celda ADMIN del riel.

**4. Las alertas salen del panel a una pantalla propia.** El panel muestra las
tres más graves y un enlace. El contador vive en la barra lateral.

**5. Kardex sale del POS.** El vendedor consulta saldo desde Buscar; el libro de
movimientos es del administrador.

## Consecuencias

### El costo de mover el acento al rojo

El error también es rojo. Es la razón por la que "Mesón" había elegido amarillo,
y hay que resolverlo explícitamente o el sistema deja de comunicar:

- **El rojo pleno significa "aprieta acá"**, y aparece una sola vez por
  pantalla.
- **El error nunca es rojo pleno**: superficie `--fh-accent-tint`, borde,
  y **la palabra**. Nunca solo color, que ya era la regla §2.4 del brief.
- **`--fh-error` pasa de #C0392B a #B3111A**, un paso profundo de la misma
  familia. Un rojo ladrillo al lado del rojo de marca se lee como un error de
  impresión.

Esto agrega una regla que revisar en cada PR: si una pantalla tiene dos cosas
rojas plenas, una de las dos está mal.

### Contraste

Blanco sobre #F9353F da 3,74:1. Alcanza para texto grande y en negrita (≥19px
bold, que es todo botón principal de este sistema) y para chrome. **No alcanza
para texto de párrafo.** Cualquier frase en rojo usa `--fh-accent-ink` #B3111A,
que da 6,9:1 sobre blanco. Sobre el rojo, el texto va siempre en blanco —al
revés que con el amarillo, donde iba siempre en tinta.

### Lo que no cambia

Nada del modelo ni de los flujos. El conteo ciego sigue ciego, el vendedor sigue
sin ver costos y eso se sigue imponiendo en el servidor, los atajos siguen
siendo F2/F4/F6/F8, las fuentes se siguen sirviendo desde el repo y
`pnpm check:offline` tiene que seguir pasando.

### Lo que cuesta

- Un PR de tokens que va a romper el test de tokens en todos los lugares donde
  el amarillo esté escrito a mano. Eso es una función, no un bug: la lista de
  fallos es la lista de trabajo.
- Un PR de navegación que toca `App.tsx` y todas las pantallas, porque el
  contenedor cambia de tamaño: el POS pasa de `max-w-6xl` centrado a ancho
  completo menos 104px, y el backoffice a ancho completo menos 236px. Las
  tablas del backoffice ganan espacio; el panel de total del POS pasa de 320px
  a 372px.
- Un endpoint nuevo: `GET /alerts?severity=` para la pantalla de alertas.

## Alternativas descartadas

**Amarillo para la acción, rojo solo en la marca.** Deja el logo como una
calcomanía pegada en la esquina de una interfaz que no es suya. Si el rojo no
llega a los botones, la aplicación no se ve de la ferretería.

**Rojo para la acción, amarillo para las alertas.** Dos colores de "acá". El
brief ya explicaba por qué el amarillo que aparece en seis lugares deja de
significar "acá"; dos acentos son el mismo problema con un paso más.

**Mantener la barra única y solo cambiar los colores.** Resuelve la marca y no
resuelve el problema real: nueve pestañas para el admin y cinco inútiles para el
vendedor. El rediseño de marca era la oportunidad de tocar la navegación con un
solo período de reaprendizaje en vez de dos.
