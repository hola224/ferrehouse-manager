# Ferrehouse Manager — instrucciones del repositorio

## Dirección visual

La dirección visual vigente es "Mesón rojo": acento #F9353F (rojo del logo),
radio 0, reglas de 2px, Archivo + IBM Plex Mono. Está documentada en
`design_handoff_marca_ferrehouse/README.md`, que manda sobre `UI-BRIEF.md`
donde se contradigan. Ningún color fuera de `apps/web/src/tokens.css`.

El razonamiento completo —y lo que se descartó— está en el
[ADR 007](.agents/DECISIONS/007-marca-y-navegacion.md).

**La regla que se rompe sola si nadie la cuida:** el rojo pleno significa
"aprieta acá" y aparece **una sola vez por pantalla**. El error nunca es rojo
pleno: se pinta con superficie `--fh-accent-tint`, borde, y **la palabra**. Si
una pantalla tiene dos cosas rojas plenas, una de las dos está mal.

## Comprobaciones antes de dar algo por terminado

`pnpm check` corre las cuatro en orden y es la única señal que vale:

| Comando | Qué protege |
|---|---|
| `pnpm check:offline` | Que nada dependa de internet. La tienda no tiene. |
| `pnpm check:tokens` | Que ningún color se escriba fuera de `tokens.css` |
| `pnpm typecheck` | TypeScript estricto en los tres paquetes |
| `pnpm test` | Las pruebas de `shared`, `server` y `web` |

## Reglas que ningún test alcanza a ver

- **El vendedor no ve costos ni márgenes.** No existen en su DOM: no se ocultan
  con CSS ni se pintan de gris. Se impone en el servidor, no en la pantalla.
- **El foco vuelve siempre a la caja de escaneo** en Venta, después de cerrar
  un diálogo, de cambiar una cantidad y de cobrar.
- **Atajos F2/F4/F6/F8, visibles en pantalla.** F3, F5, F10 y F11 se las queda
  Chrome. Los atajos viven en `apps/web/src/lib/atajos.ts` y en ninguna parte
  más.
- **Estados con color y palabra, nunca solo color.** Hay daltonismo en el mesón.
- **Fuentes servidas desde el repo** (`apps/web/public/fonts`).
- **Sin animación decorativa.** Transiciones ≤150ms, y solo donde comunican.
- **Ningún corner redondeado.** `--fh-radio` es 0px, pero un `rounded-full`
  suelto se lo salta: se busca a mano.
