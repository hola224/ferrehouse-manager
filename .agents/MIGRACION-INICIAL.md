# MIGRACION-INICIAL.md — Lo que hay que agregar a mano

> Prisma no genera restricciones `CHECK`. La migración inicial (tarea 0.2) se
> genera con `prisma migrate dev` y **después se editan estas líneas a mano**,
> antes de aplicarla. Es la única oportunidad: agregarlas después obliga a
> recrear la tabla.

## `CashSession` — los dos CHECK que cierran el invariante de caja

`openStationId Int? @unique` por sí solo **no** impone "una sola sesión abierta
por estación". Comprobado contra SQLite: sin estos `CHECK` se pueden insertar
tres sesiones abiertas en la misma caja (todas con `openStationId` nulo y
`closedAt` nulo), y una sesión de CAJA-1 puede marcar CAJA-2, dejando bloqueada
una estación que no tiene sesión.

En el `CREATE TABLE "CashSession"` generado, agregar como restricciones de tabla:

```sql
CONSTRAINT "ck_marcador_es_su_estacion"
  CHECK ("openStationId" IS NULL OR "openStationId" = "stationId"),
CONSTRAINT "ck_abierta_sii_marcador"
  CHECK (("closedAt" IS NULL) = ("openStationId" IS NOT NULL))
```

Verificado que, con ambos puestos:

| Intento | Resultado |
|---|---|
| Abrir sesión sin marcador | rechazada — `ck_abierta_sii_marcador` |
| Marcar una estación distinta a la propia | rechazada — `ck_marcador_es_su_estacion` |
| Abrir sesión correctamente | funciona |
| Segunda sesión abierta en la misma caja | rechazada — `UNIQUE` |
| Dos cajas distintas abiertas a la vez | funciona |
| Cerrar dejando el marcador puesto | rechazada — `ck_abierta_sii_marcador` |
| Cerrar bien y reabrir | funciona |

Con esto el *drift* entre `closedAt` y `openStationId` deja de ser
representable: no queda ningún invariante de caja a cargo de la aplicación.

## Al terminar

Correr la migración contra una base vacía y verificar que crea **28 tablas**.
