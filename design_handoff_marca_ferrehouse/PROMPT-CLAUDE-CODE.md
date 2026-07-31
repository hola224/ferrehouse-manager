# Qué pegarle a Claude Code

Copia esta carpeta completa dentro del repo, en la raíz:

```
ferrehouse/
  design_handoff_marca_ferrehouse/     ← esta carpeta
```

Después abre Claude Code en la raíz del repo y pega **este mensaje**, tal cual:

---

Lee `design_handoff_marca_ferrehouse/README.md` completo antes de escribir
nada. Es el traspaso de un rediseño de marca e interfaz para Ferrehouse
Manager, y manda sobre `UI-BRIEF.md` en todo lo que contradiga (el brief pasa
a ser el registro histórico; el ADR de la carpeta explica qué cambió).

Trabaja en este orden, un PR por paso, y no empieces el siguiente hasta que
el anterior pase `pnpm check`:

1. **Tokens.** Reemplaza `apps/web/src/tokens.css` por
   `design_handoff_marca_ferrehouse/tokens.css`. Ajusta
   `apps/web/tailwind.config.js` para exponer los nombres nuevos
   (`accent-600`, `accent-tint`, `accent-ink`, `line-soft`). Corre
   `pnpm check:tokens` y `pnpm --filter @ferrehouse/web test`: el test de
   tokens va a fallar donde el amarillo esté escrito a mano — esa es la lista
   de lo que hay que tocar.
2. **Marca.** Copia los SVG de `design_handoff_marca_ferrehouse/brand/` a
   `apps/web/public/brand/`. Favicon y `<title>` en `apps/web/index.html`.
3. **Componentes base.** Actualiza `apps/web/src/components/ui.tsx` según la
   sección «Componentes» del README: `Boton`, `Campo`, `Chip`, `Tarjeta`,
   `Modal`, `Selector`, `Acciones`. Radio 0, reglas de 2px, etiquetas de
   botón alineadas a la izquierda.
4. **Cascarones de navegación.** Ese es el cambio grande: hoy hay una sola
   barra superior con hasta 9 pestañas para el admin. Pasa a DOS cascarones
   —`PosShell` y `AdminShell`— como describe la sección «Navegación» del
   README, elegidos por rol en `apps/web/src/App.tsx`.
5. **Pantallas, en este orden:** Login → Venta → Caja → Devoluciones →
   Dashboard → Alertas (pantalla nueva) → Catálogo → Kardex → Reportes →
   Compras → Usuarios → WhatsApp.

Reglas del repo que siguen valiendo y que este rediseño no toca:

- Ningún color hardcodeado fuera de `tokens.css`.
- El vendedor no ve costos ni márgenes: no existen en su DOM, no están grises.
- El foco vuelve siempre a la caja de escaneo en Venta.
- Fuentes servidas desde el repo. `pnpm check:offline` no puede fallar.
- Atajos F2/F4/F6/F8, visibles en pantalla.
- Sin animación decorativa; transiciones ≤150ms.
- Estados con color **y** palabra, nunca solo color.

Abre `design_handoff_marca_ferrehouse/prototipo/ferrehouse-manager.html` en
el navegador para ver el diseño objetivo. Es una referencia visual en HTML,
no código para copiar: recréalo con React + Tailwind + los componentes que ya
existen en el repo.

Antes de empezar el paso 4, escribe un ADR corto en `.agents/DECISIONS/`
explicando el cambio de navegación. Es lo que pide el brief para desviarse
de él.

---

## Si prefieres ir por partes

Para un solo paso, pégale esto y cambia el número:

> Lee `design_handoff_marca_ferrehouse/README.md`. Haz **solo el paso 3**
> (componentes base). No toques pantallas todavía. Al terminar, corre
> `pnpm check` y muéstrame el diff.

## Para que no se le olvide entre sesiones

Agrega esta línea al `CLAUDE.md` del repo (o créalo):

```markdown
## Dirección visual
La dirección visual vigente es "Mesón rojo": acento #F9353F (rojo del logo),
radio 0, reglas de 2px, Archivo + IBM Plex Mono. Está documentada en
`design_handoff_marca_ferrehouse/README.md`, que manda sobre `UI-BRIEF.md`
donde se contradigan. Ningún color fuera de `apps/web/src/tokens.css`.
```
