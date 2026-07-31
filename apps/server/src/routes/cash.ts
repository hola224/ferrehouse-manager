/**
 * Caja (tareas 2.1 a 2.6). El ciclo de la plata: apertura → movimientos →
 * cierre con arqueo.
 *
 * LO QUE HAY QUE ENTENDER ANTES DE TOCAR ESTO:
 *
 * 1. **"Una sola sesión abierta por estación" lo impone la BASE DE DATOS**, no
 *    un `if` previo (ADR-004). `CashSession.openStationId` es `@unique`, más
 *    dos `CHECK` puestos a mano en la migración inicial. Con 2-3 terminales,
 *    un chequeo previo tiene una ventana entre el SELECT y el INSERT por la
 *    que caben dos aperturas; el índice único no la tiene. Acá el trabajo es
 *    **traducir el error de la base a castellano**, no adelantarse a él.
 *
 * 2. **No hay campo `status`.** Abierta ⟺ `openStationId IS NOT NULL` ⟺
 *    `closedAt IS NULL`. Dos columnas que digan lo mismo terminan
 *    contradiciéndose, así que la segunda no existe.
 *
 * 3. **Cada movimiento guarda el saldo antes y después.** Permite auditar sin
 *    recalcular el libro entero, y hace evidente cualquier salto.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "../db.js";
import { audit } from "../audit.js";
import { requireRole } from "../roles.js";
import { getSetting } from "../settings.js";
import { reporteCierreEscPos } from "../cash-report.js";
import {
  cashOpenSchema,
  cashMovementSchema,
  cashCloseSchema,
  estadoArqueo,
  formatCLP,
  type CashMovementType,
} from "@ferrehouse/shared";

function malaPeticion(mensaje: string): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = 400;
  return e;
}

/** La sesión abierta de una estación, o `null`. Una consulta, sin ambigüedad. */
async function sesionAbierta(stationId: number) {
  return db.cashSession.findUnique({ where: { openStationId: stationId } });
}

/** El saldo actual sale del último movimiento, no de una suma cada vez. */
async function saldoActual(sessionId: number): Promise<number> {
  const ultimo = await db.cashMovement.findFirst({
    where: { sessionId },
    orderBy: { id: "desc" },
    select: { balanceAfter: true },
  });
  return ultimo?.balanceAfter ?? 0;
}

export async function registerCashRoutes(app: FastifyInstance): Promise<void> {
  const cualquiera = { preHandler: requireRole("ADMIN", "SELLER") };
  const soloAdmin = { preHandler: requireRole("ADMIN") };

  // ============================================================
  // Estado actual (lo que pinta el dashboard y el encabezado)
  // ============================================================

  app.get("/api/cash/current", cualquiera, async (req) => {
    const sesion = await sesionAbierta(req.user.stationId);
    if (!sesion) return { abierta: false, sesion: null };

    const movimientos = await db.cashMovement.findMany({
      where: { sessionId: sesion.id },
      orderBy: { id: "asc" },
      include: { user: { select: { id: true, name: true } } },
    });

    /**
     * Al vendedor NO le viaja el saldo corrido, ni el `balanceBefore` /
     * `balanceAfter` de cada movimiento. El arqueo es a ciegas, y un conteo a
     * ciegas contra un número que igual está en el JSON no es a ciegas.
     *
     * Sí ve la lista de movimientos con su monto y su motivo: necesita saber
     * qué quedó registrado, y esa es justamente la información con la que se
     * detecta un olvido antes de cerrar.
     */
    if (req.user.role === "SELLER") {
      return {
        abierta: true,
        sesion: { ...sesion, openingAmount: undefined },
        saldo: null,
        movimientos: movimientos.map((m) => ({
          ...m,
          balanceBefore: undefined,
          balanceAfter: undefined,
          // La apertura tampoco: sumada a los movimientos da el esperado.
          amount: m.type === "OPENING" ? undefined : m.amount,
        })),
      };
    }

    return {
      abierta: true,
      sesion,
      saldo: movimientos[movimientos.length - 1]?.balanceAfter ?? 0,
      movimientos,
    };
  });

  // ============================================================
  // 2.1 — Apertura
  // ============================================================

  app.post("/api/cash/open", cualquiera, async (req, reply) => {
    const { openingAmount } = cashOpenSchema.parse(req.body);
    const stationId = req.user.stationId;

    try {
      const sesion = await db.$transaction(async (tx) => {
        const creada = await tx.cashSession.create({
          data: {
            stationId,
            userId: req.user.sub,
            openingAmount,
            // El marcador ES la señal de "abierta". El `@unique` sobre esta
            // columna es lo que impide la segunda apertura.
            openStationId: stationId,
          },
        });
        await tx.cashMovement.create({
          data: {
            sessionId: creada.id,
            type: "OPENING" satisfies CashMovementType,
            amount: openingAmount,
            balanceBefore: 0,
            balanceAfter: openingAmount,
            userId: req.user.sub,
            description: "Apertura de caja",
          },
        });
        return creada;
      });

      await audit({
        userId: req.user.sub,
        action: "CASH_SESSION_OPENED",
        entity: "CashSession",
        entityId: sesion.id,
        payload: { openingAmount, stationId },
      });

      return reply.code(201).send({ sesion, mensaje: `Caja abierta con ${formatCLP(openingAmount)}.` });
    } catch (e) {
      /**
       * P2002 = violación de índice único. Es la base diciendo "esa caja ya
       * está abierta", y llega acá porque NO se preguntó antes: preguntar
       * primero deja una ventana por la que caben dos aperturas simultáneas.
       */
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        const abierta = await sesionAbierta(stationId);
        const quien = abierta
          ? (await db.user.findUnique({ where: { id: abierta.userId } }))?.name
          : null;
        throw malaPeticion(
          quien
            ? `Esta caja ya está abierta: la abrió ${quien}. Hay que cerrarla antes de abrir otra.`
            : "Esta caja ya está abierta. Hay que cerrarla antes de abrir otra.",
        );
      }
      throw e;
    }
  });

  // ============================================================
  // 2.2 y 2.3 — Retiros e ingresos, con saldo antes y después
  // ============================================================

  app.post("/api/cash/movements", cualquiera, async (req, reply) => {
    /**
     * La caja se comprueba ANTES de validar el cuerpo, y el orden importa:
     * gana el error más de fondo. Al revés, alguien con la caja cerrada y el
     * motivo en blanco lee "escribe el motivo", lo escribe, y recién entonces
     * se entera de lo que pasaba de verdad. El brief pide errores que digan
     * qué hacer (§2.5), no el primero que la validación encuentre.
     */
    const sesion = await sesionAbierta(req.user.stationId);
    if (!sesion) throw malaPeticion("La caja está cerrada. Ábrela antes de registrar movimientos.");

    const datos = cashMovementSchema.parse(req.body);

    // El signo lo pone el servidor, nunca el cliente.
    const monto = datos.type === "WITHDRAWAL" ? -datos.amount : datos.amount;
    const antes = await saldoActual(sesion.id);
    const despues = antes + monto;

    /**
     * Un cajón no puede tener menos que cero. No es una preferencia: si el
     * saldo esperado queda negativo, el arqueo del cierre pasa a comparar
     * contra un número imposible y la diferencia deja de significar nada.
     */
    if (despues < 0) {
      /**
       * Al administrador se le dice cuánto hay; al vendedor no. Decirle el
       * saldo acá le daría un oráculo: probando retiros cada vez menores
       * averiguaría el esperado antes de contar, y el arqueo a ciegas dejaría
       * de serlo. El mensaje igual dice qué hacer, que es lo que pide el brief.
       */
      throw malaPeticion(
        req.user.role === "ADMIN"
          ? `No puedes retirar ${formatCLP(datos.amount)}: en la caja hay ${formatCLP(antes)}.`
          : `No alcanza el efectivo de la caja para retirar ${formatCLP(datos.amount)}.`,
      );
    }

    const movimiento = await db.cashMovement.create({
      data: {
        sessionId: sesion.id,
        type: datos.type,
        amount: monto,
        balanceBefore: antes,
        balanceAfter: despues,
        userId: req.user.sub,
        description: datos.description,
      },
    });

    await audit({
      userId: req.user.sub,
      action: "CASH_MOVEMENT",
      entity: "CashMovement",
      entityId: movimiento.id,
      payload: { type: datos.type, amount: monto, description: datos.description, saldo: despues },
    });

    // El saldo resultante tampoco viaja hacia un vendedor: es el número que el
    // cierre a ciegas no le puede adelantar.
    const esAdmin = req.user.role === "ADMIN";
    return reply.code(201).send({
      movimiento: esAdmin ? movimiento : { ...movimiento, balanceBefore: undefined, balanceAfter: undefined },
      saldo: esAdmin ? despues : null,
      mensaje: esAdmin
        ? datos.type === "WITHDRAWAL"
          ? `Retirados ${formatCLP(datos.amount)}. Quedan ${formatCLP(despues)} en la caja.`
          : `Ingresados ${formatCLP(datos.amount)}. Hay ${formatCLP(despues)} en la caja.`
        : datos.type === "WITHDRAWAL"
          ? `Retiro de ${formatCLP(datos.amount)} registrado.`
          : `Ingreso de ${formatCLP(datos.amount)} registrado.`,
    });
  });

  // ============================================================
  // 2.4 — Cierre con arqueo
  // ============================================================

  /**
   * Lo que el sistema dice que debería haber. **Solo el administrador**
   * (decidido el 2026-07-30: el arqueo es a ciegas).
   *
   * No es una restricción de pantalla, y por eso vive acá: si el vendedor
   * pudiera pedir este número antes de contar, el conteo ciego sería
   * decorativo —bastaría abrir la pestaña de red—. Es el mismo razonamiento de
   * la decisión sellada 17 con los costos: lo que no se puede ver no sale del
   * servidor.
   *
   * El vendedor recibe el esperado y la diferencia en la RESPUESTA de
   * `/api/cash/close`, o sea después de haber comprometido su conteo.
   */
  app.get("/api/cash/expected", soloAdmin, async (req) => {
    const sesion = await sesionAbierta(req.user.stationId);
    if (!sesion) throw malaPeticion("La caja está cerrada.");
    return { esperado: await saldoActual(sesion.id), sesionId: sesion.id };
  });

  app.post("/api/cash/close", cualquiera, async (req) => {
    const { countedAmount, notes } = cashCloseSchema.parse(req.body);
    const sesion = await sesionAbierta(req.user.stationId);
    if (!sesion) throw malaPeticion("La caja ya está cerrada.");

    const esperado = await saldoActual(sesion.id);
    const diferencia = countedAmount - esperado;
    const limite = await getSetting("alert.cashDiffLimit");
    const estado = estadoArqueo(diferencia, limite);

    const cerrada = await db.$transaction(async (tx) => {
      /**
       * El movimiento de cierre lleva la diferencia como monto, de modo que el
       * saldo final del libro sea LO QUE HAY DE VERDAD en el cajón y no lo que
       * el sistema creía. Si cuadra, el monto es cero y no cambia nada.
       */
      await tx.cashMovement.create({
        data: {
          sessionId: sesion.id,
          type: "CLOSING" satisfies CashMovementType,
          amount: diferencia,
          balanceBefore: esperado,
          balanceAfter: countedAmount,
          userId: req.user.sub,
          description: diferencia === 0 ? "Cierre, sin diferencia" : `Cierre, ajuste por arqueo`,
        },
      });

      /**
       * `openStationId = null` y `closedAt` EN LA MISMA SENTENCIA. Separarlas
       * dejaría un instante en que la sesión está medio cerrada, y ese estado
       * los `CHECK` de la base lo rechazan — con razón: sería representable el
       * drift que el modelo entero existe para impedir.
       */
      return tx.cashSession.update({
        where: { id: sesion.id },
        data: {
          openStationId: null,
          closedAt: new Date(),
          expectedAmount: esperado,
          countedAmount,
          differenceAmount: diferencia,
          notes: notes ?? null,
        },
      });
    });

    // --- 2.6: la alerta, solo si se pasa del límite configurado ---
    let alerta = null;
    if (estado.tono === "error") {
      alerta = await db.alert.create({
        data: {
          type: "CASH_DIFFERENCE",
          severity: "CRITICAL",
          message:
            `Caja ${(await db.station.findUnique({ where: { id: sesion.stationId } }))?.name ?? "?"}: ` +
            `${estado.mensaje} Esperado ${formatCLP(esperado)}, contado ${formatCLP(countedAmount)}.`,
        },
      });
    }

    await audit({
      userId: req.user.sub,
      action: "CASH_SESSION_CLOSED",
      entity: "CashSession",
      entityId: sesion.id,
      payload: { esperado, contado: countedAmount, diferencia, alerta: alerta?.id ?? null },
    });

    return { sesion: cerrada, esperado, contado: countedAmount, diferencia, estado, alerta };
  });

  // ============================================================
  // 2.5 — Reporte de cierre imprimible
  // ============================================================

  app.post("/api/cash/sessions/:id/report", cualquiera, async (req, reply) => {
    const { id } = z.object({ id: z.coerce.number().int().positive() }).parse(req.params);

    const sesion = await db.cashSession.findUnique({
      where: { id },
      include: {
        station: true,
        user: { select: { name: true } },
        movements: { orderBy: { id: "asc" }, include: { user: { select: { name: true } } } },
      },
    });
    if (!sesion) throw malaPeticion("Esa sesión de caja no existe");
    if (!sesion.closedAt) throw malaPeticion("Esa caja todavía está abierta: el reporte se imprime al cerrar.");
    if (!sesion.station.printerTarget) {
      throw malaPeticion(`${sesion.station.name} no tiene impresora configurada`);
    }

    const limite = await getSetting("alert.cashDiffLimit");
    const trabajo = await db.printJob.create({
      data: {
        stationId: sesion.stationId,
        type: "CASH_REPORT",
        payload: reporteCierreEscPos(sesion, limite).toString("base64"),
      },
      select: { id: true, stationId: true, type: true, status: true, createdAt: true },
    });

    return reply.code(201).send({
      trabajo,
      mensaje: `Reporte de cierre en la cola de ${sesion.station.name}.`,
    });
  });

  // ============================================================
  // Historial (lo mira el admin)
  // ============================================================

  app.get("/api/cash/sessions", soloAdmin, async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
    const limite = await getSetting("alert.cashDiffLimit");
    const sesiones = await db.cashSession.findMany({
      orderBy: { openedAt: "desc" },
      take: limit,
      include: { station: { select: { name: true } }, user: { select: { name: true } } },
    });
    return {
      sesiones: sesiones.map((s) => ({
        ...s,
        // El estado se deriva UNA vez, en el servidor, con el mismo código que
        // usa la pantalla de cierre y el papel.
        estado: s.differenceAmount === null ? null : estadoArqueo(s.differenceAmount, limite),
      })),
    };
  });
}
