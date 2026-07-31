# UI-BRIEF.md — Ferrehouse Manager

> Prompt de diseño para el agente Frontend Senior en Claude Code.
> Complementa STATE.md y SPRINTS.md. Este documento manda sobre cualquier
> intuición estética del agente: si algo no está definido acá, se pregunta
> o se decide siguiendo los principios de la sección 2.
> Dirección elegida por Cristian: **A — "Mesón"** (2026-07-30). Las secciones
> B y C quedan abajo solo como registro de lo descartado.

---

## 1. Qué es esta interfaz (y qué no es)

Ferrehouse Manager es una **herramienta de trabajo que se usa 8 horas al día
de pie, en un mesón, con apuro y con un cliente esperando al frente**.
No es una landing, no es un dashboard de startup, no necesita impresionar
a nadie: necesita que un vendedor de 55 años que nunca usó un sistema
venda su tercera venta sin ayuda.

Toda decisión visual se evalúa contra una sola pregunta:
**¿esto hace la venta más rápida o más lenta?**

Dos aplicaciones en una:

| Zona | Usuario | Densidad | Prioridad |
|---|---|---|---|
| **POS** (venta, caja) | Vendedor | Baja: pocos elementos, gigantes | Velocidad y legibilidad a 1,5 m |
| **Backoffice** (catálogo, kardex, compras, reportes, alertas, config) | Admin | Alta: tablas densas | Encontrar y comparar datos |

Comparten tokens y componentes, pero **no comparten escala tipográfica**:
el POS usa la escala XL, el backoffice la normal.

## 2. Principios no negociables

1. **Teclado primero.** El flujo completo de una venta (escanear → cantidad
   → cobrar → medio de pago → vuelto) se hace sin tocar el mouse. El lector
   de códigos es un teclado; el foco SIEMPRE vuelve solo a la caja de escaneo
   después de cualquier operación. Atajos **F2/F4/F6/F8** visibles en
   pantalla, no escondidos en un menú de ayuda.
   *(Corregido el 2026-07-30: decía F2/F4/F6/F8/F10. Respondida la pregunta
   abierta 4 —los terminales corren Chrome en modo normal— F10 le abre la barra
   de menú al navegador, igual que F3, F5 y F11 quedan tomadas. Quedan cuatro
   teclas, y se decidió ahora y no cuando el vendedor ya las hubiera aprendido.)*
2. **Números tabulares en todo lo que sea plata o cantidad**
   (`font-variant-numeric: tabular-nums`). Las columnas de montos se alinean
   a la derecha, siempre. Formato chileno: punto de miles, sin decimales
   en pesos ($12.990), coma decimal en cantidades (7,5 m).
3. **El total se lee a 1,5 metros.** Mínimo 40px en el POS. El vuelto
   calculado, igual de grande — es el número que más errores humanos evita.
4. **Estados imposibles de confundir.** Color + palabra, nunca solo color
   (daltonismo) y nunca solo icono. Caja ABIERTA / CERRADA, WhatsApp
   CONECTADO / CAÍDO. Para las ventas son **cinco etiquetas, no dos**:
   completada, con devoluciones, devuelta, anulada, y la fila que *es* la
   devolución o la anulación. La tabla canónica está en `STATE.md`
   §Diseño de interfaz y se deriva en el servidor, no en cada pantalla.
   *(Corregido el 2026-07-30: decía "COMPLETADA / ANULADA", binario que el
   modelo sellado no produce — una venta con devoluciones parciales sigue
   en COMPLETED.)*
5. **Errores que dicen qué hacer.** "Stock insuficiente: quedan 3,5 m.
   Vender igual requiere PIN de administrador" — no "Error de validación".
   (Ese mensaje concreto recién aplica desde el Sprint 4, tarea 4.5: en el
   Sprint 3 la venta todavía descuenta sin validar saldo.)
   Los errores no piden disculpas ni son vagos.
6. **Sin animación decorativa.** Transiciones ≤150ms solo donde comunican
   (aparición de línea de venta, confirmación de cobro). `prefers-reduced-motion`
   respetado. Un POS que "anima" se siente lento aunque no lo sea.
7. **Touch targets ≥44px en el POS** — hay dedos con guantes y mesones
   con polvo. Backoffice puede ser más fino.
8. **El rol define lo que se ve, no lo que se deshabilita.** El vendedor
   no ve costos ni márgenes: los elementos no existen en su DOM, no están
   "grises". Un botón deshabilitado invita a preguntar por qué.
9. **Vacíos que invitan.** Pantalla de catálogo vacía = botón "Importar
   desde Excel" + "Crear primer producto", no un ilustración triste.
10. **Español chileno, sentence case, verbos activos.** "Cobrar", no
    "Procesar transacción". "Cerrar caja", no "Finalizar sesión". El mismo
    verbo en el botón, en el toast y en el reporte.

## 3. Stack y componentes

- React 18 + Vite, Tailwind, **shadcn/ui como base** — pero tematizado con
  los tokens de la dirección elegida, no con el look default de shadcn.
- Tokens en CSS variables (`--fh-bg`, `--fh-ink`, `--fh-accent`, …) definidos
  UNA vez. Ningún color hardcodeado en componentes.
- Íconos: lucide-react, trazo consistente, siempre acompañados de texto
  en acciones principales.
- Tablas del backoffice: TanStack Table (orden, filtro, paginación) con
  los estilos propios.

## 4. Dirección visual: "Mesón" (industrial) — ELEGIDA

> **Enlace pendiente:** `ui-direcciones.html` no está en el repositorio ni en
> el resto del equipo (verificado el 2026-07-30). Los tokens de abajo alcanzan
> para tematizar sin él. Si el archivo existe en otra parte, súbelo; si no, la
> referencia visual pasa a ser el PR de la tarea 0.11.

### Tokens
- Fondo #F4F5F4 / blanco, tinta #16181A, acento **amarillo seguridad #FFC400**,
  gris técnico #8A8F94.
- Tipografía: **Archivo** (variable, condensable) para display y UI;
  **IBM Plex Mono** para SKU, folios y códigos.
- Firma: totales en Archivo black condensado, gigantes, como display de
  balanza; franja diagonal amarillo/negro como marcador de alertas críticas.
- Regla de disciplina: el amarillo SOLO en la acción principal de cada
  pantalla y en alertas. Todo lo demás es blanco/negro/gris.

### Tokens derivados (definidos al elegir)

```css
:root {
  --fh-bg:        #F4F5F4;  /* fondo app */
  --fh-surface:   #FFFFFF;  /* tarjetas, panel de líneas */
  --fh-ink:       #16181A;  /* texto principal */
  --fh-ink-soft:  #6B7075;  /* texto secundario */
  --fh-line:      #ECECEC;  /* separadores */
  --fh-accent:    #FFC400;  /* amarillo seguridad: acción principal + alerta */
  --fh-mono-ink:  #8A8F94;  /* SKU, códigos */
  --fh-ok:        #2F7D46;  /* verde estado (caja abierta, WhatsApp ok) */
  --fh-warn:      #B7791F;  /* ámbar derivado del acento (stock bajo) */
  --fh-error:     #C0392B;  /* rojo (anulación, quiebre, caja descuadrada) */
}
```

- Sobre amarillo #FFC400 el texto va SIEMPRE en tinta #16181A, nunca blanco
  (contraste insuficiente).
- La franja diagonal amarillo/negro (repeating-linear-gradient 45°) se usa
  únicamente en alertas CRITICAL y en el banner de "caja descuadrada".
  Máximo una por pantalla.
- Tipografía: Archivo se sirve **local** (variable, woff2 en el repo, licencia
  OFL) — el sistema corre sin internet y no puede depender de Google Fonts.
  Igual IBM Plex Mono.

---

### Descartadas (registro)

### B — "Ficha técnica" (catálogo/plano)
- Blanco puro, tinta #13202E, acento **azul acero #2364AA**, superficie
  #F2F6FA, líneas #C9D4DE.
- Tipografía: **IBM Plex Sans** para UI; **IBM Plex Mono** protagonista
  en códigos, precios unitarios y kardex.
- Firma: los SKU como chips monoespaciados; separadores punteados estilo
  lista de precios; encabezados de tabla con regla superior fina.

### C — "Tienda" (SaaS cálido)
- Fondo #F7F7F5, tinta #20241F, acento **verde bosque #2E6B34**,
  superficie #ECEEE9.
- Tipografía: **Manrope** para todo, pesos 400-800; tabular-nums activado
  globalmente.
- Firma: tarjetas con radio 10px y sombra apenas perceptible; botón de
  cobro como el único elemento de color pleno en la pantalla de venta.

En las tres: rojo de error #C0392B-familia y verde/ámbar de estado se
derivan con el mismo tono de la paleta elegida (definir al tematizar).

## 5. Las cinco pantallas que definen el producto

Orden de diseño = orden de sprints. Diseñar la primera de cada sprint
antes de codear el resto.

1. **Venta (S3).** Dos columnas: líneas a la izquierda, total + cobro a la
   derecha. Caja de escaneo arriba, siempre con foco. La cantidad se edita
   con Enter sobre la línea. Cobro abre panel de medios de pago con
   calculadora de vuelto en grande.
2. **Cierre de caja (S2).** Guiado en 3 pasos: **vendedor cuenta e ingresa →
   confirma → diferencia en pantalla con color y palabra**. Imprime resumen.
   *(Corregido el 2026-07-30: decía "sistema muestra esperado → vendedor cuenta".
   Cristian eligió el conteo ciego, que es la práctica habitual en manejo de
   efectivo: ver el número esperado ancla, y la tentación de teclearlo cuando la
   cuenta no calza es real. El esperado no se muestra —ni se sirve— hasta que el
   conteo está ingresado.)*
3. **Búsqueda/catálogo (S1).** Una sola caja: escaneo, nombre parcial o SKU.
   Resultados con precio y stock visible. Para el vendedor es solo lectura.
4. **Kardex de producto (S4).** Tabla cronológica: fecha, tipo de movimiento
   (chip con color por tipo), cantidad con signo, saldo, usuario, referencia.
   Es la pantalla que responde "¿por qué el stock dice esto?".
5. **Dashboard admin (S5).** Venta del día, estado de caja, margen del día,
   alertas activas. Cuatro datos, no cuarenta.

## 6. Definition of done visual (por pantalla)

- [ ] Funciona el flujo completo solo con teclado
- [ ] Legible en 1366×768 (el PC de la tienda no es 4K) y usable en tablet
- [ ] Foco visible en todos los elementos interactivos
- [ ] Números tabulares y alineados en toda columna de montos
- [ ] Estados vacío / cargando / error diseñados, no improvisados
- [ ] Cero colores fuera de los tokens
- [ ] Textos revisados contra la sección 2.10

## 7. Proceso con los agentes

1. Frontend Senior lee este brief + la dirección elegida y arma
   `tokens.css` + tematiza shadcn. Eso es un PR propio, antes de
   cualquier pantalla.
2. Cada pantalla nueva: wireframe en comentario del PR (ASCII o captura)
   → ok de Cristian si es una de las cinco clave → implementación.
3. Desviarse del brief requiere ADR corto en `.agents/DECISIONS/`
   explicando qué se cambió y por qué.
