# Registro de decisiones (ADR)

Una decisión por archivo, numerada y con fecha. El formato es corto a
propósito: **contexto → decisión → alternativa descartada → consecuencias**.

Regla del proyecto (`SPRINTS.md`, ritual del sprint): toda decisión nueva que
no estuviera en `STATE.md` se escribe acá antes de implementarla. Las
decisiones *selladas* viven en `STATE.md`; acá vive el razonamiento completo
que las sostiene, incluyendo lo que se descartó y por qué.

Una decisión que se revierte no se borra: se marca `SUPERADA POR ADR-xx` en
la cabecera y se deja. El historial de por qué algo se pensó distinto vale
más que la prolijidad.

Además, en este mismo directorio: [`SEED.md`](../SEED.md) (los datos iniciales
exactos) y [`MIGRACION-INICIAL.md`](../MIGRACION-INICIAL.md) (lo que hay que
agregar a mano a la migración porque Prisma no lo genera).

| ADR | Título | Estado |
|---|---|---|
| [001](001-venta-en-espera.md) | Venta en espera en tabla aparte | Vigente |
| [002](002-devoluciones-parciales.md) | Devoluciones parciales múltiples | Vigente |
| [003](003-vuelto-y-cuadratura.md) | Vuelto, redondeo y cuadratura de pagos | Vigente |
| [004](004-estaciones.md) | Estación como tabla y sesión única de caja | Vigente |
| [005](005-unidades-y-costos.md) | Convención de unidades y precisión del costo | Vigente |
| [006](006-concurrencia-sqlite.md) | Escrituras serializadas en SQLite | Vigente |
