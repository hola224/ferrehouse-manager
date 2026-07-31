/**
 * El ÚNICO lugar donde se escribe en el libro de stock (Sprint 4).
 *
 * Escribir un movimiento son cuatro pasos que van juntos o no van: leer el
 * saldo anterior, calcular el saldo y el costo promedio resultantes, insertar
 * la fila del libro con esas dos fotos, y actualizar el caché `StockLevel`.
 * Compra, venta, ajuste, merma, devolución e inventario inicial hacen lo
 * MISMO con distinto signo. Copiado seis veces, basta que una copia olvide
 * `balanceCostNetMilliPeso` para que el kardex mienta sobre el costo sin que
 * ninguna prueba lo note, porque el saldo —lo que sí se mira— seguiría bien.
 *
 * Recibe la transacción por parámetro: nunca abre la suya. El movimiento de
 * stock y lo que lo origina (la venta, la compra) tienen que ser atómicos
 * entre sí, y una transacción anidada en SQLite no es una transacción.
 */
import type { Prisma } from "@prisma/client";
import {
  conSigno,
  ingresa,
  exigeMotivo,
  recalcAverageCost,
  roundSym,
  type StockMovementType,
} from "@ferrehouse/shared";
import { evaluarStockDeProducto } from "./alerts.js";

export type MovimientoPedido = {
  productId: number;
  locationId: number;
  type: StockMovementType;
  /**
   * En milésimas de UNIDAD BASE. El signo lo pone el tipo (`conSigno`), salvo
   * en `ADJUSTMENT`, donde el signo que venga acá es el que manda.
   */
  qtyBaseMilli: number;
  /**
   * Plata neta EXACTA del movimiento, en pesos y en valor absoluto: el signo
   * lo pone el libro. Si se omite, se valoriza al costo promedio vigente, que
   * es lo correcto para un ajuste o una merma: nadie está digitando una
   * factura, la mercadería ya estaba valorizada.
   */
  totalCostNet?: number;
  userId: number;
  reason?: string | null;
  refType?: "SALE" | "PURCHASE" | null;
  refId?: number | null;
  /** Fecha del HECHO. En una compra es `Purchase.receivedAt`, no el tecleo. */
  createdAt?: Date;
};

export type MovimientoEscrito = {
  id: number;
  qtyBaseMilli: number;
  balanceBaseMilli: number;
  balanceCostNetMilliPeso: number;
  saldoAntes: number;
  costoAntes: number;
};

function malaPeticion(mensaje: string): Error & { statusCode: number } {
  const e = new Error(mensaje) as Error & { statusCode: number };
  e.statusCode = 400;
  return e;
}

export async function registrarMovimiento(
  tx: Prisma.TransactionClient,
  pedido: MovimientoPedido,
): Promise<MovimientoEscrito> {
  const qty = conSigno(pedido.type, pedido.qtyBaseMilli);
  if (qty === 0) throw malaPeticion("Un movimiento de cero no dice nada: no se registra.");
  if (exigeMotivo(pedido.type) && !pedido.reason?.trim()) {
    throw malaPeticion("Escribe el motivo: un ajuste sin motivo es un descuadre sin explicación.");
  }

  const producto = await tx.product.findUniqueOrThrow({
    where: { id: pedido.productId },
    select: { id: true, costNetMilliPeso: true },
  });
  const nivel = await tx.stockLevel.findUnique({
    where: { productId_locationId: { productId: pedido.productId, locationId: pedido.locationId } },
  });

  const saldoAntes = nivel?.qtyBaseMilli ?? 0;
  const costoAntes = producto.costNetMilliPeso;
  const saldoDespues = saldoAntes + qty;

  // Valor absoluto acá; el signo se aplica al guardar. Sin `totalCostNet` el
  // movimiento vale lo que vale el promedio vigente.
  const montoAbsoluto =
    pedido.totalCostNet !== undefined
      ? Math.abs(pedido.totalCostNet)
      : Math.abs(roundSym((qty * costoAntes) / 1_000_000));

  const costoDespues = ingresa(pedido.type, qty)
    ? recalcAverageCost({
        prevBalanceBaseMilli: saldoAntes,
        prevCostNetMilliPeso: costoAntes,
        incomingBaseMilli: qty,
        incomingTotalCostNet: montoAbsoluto,
      })
    : costoAntes;

  const movimiento = await tx.stockMovement.create({
    data: {
      productId: pedido.productId,
      locationId: pedido.locationId,
      type: pedido.type,
      qtyBaseMilli: qty,
      // Mismo signo que la cantidad (convención del schema): así sumar la
      // columna da el valor neto que entró o salió, sin mirar el tipo.
      totalCostNet: Math.sign(qty) * montoAbsoluto,
      balanceBaseMilli: saldoDespues,
      balanceCostNetMilliPeso: costoDespues,
      userId: pedido.userId,
      reason: pedido.reason?.trim() || null,
      refType: pedido.refType ?? null,
      refId: pedido.refId ?? null,
      ...(pedido.createdAt ? { createdAt: pedido.createdAt } : {}),
    },
  });

  await tx.stockLevel.upsert({
    where: { productId_locationId: { productId: pedido.productId, locationId: pedido.locationId } },
    create: { productId: pedido.productId, locationId: pedido.locationId, qtyBaseMilli: saldoDespues },
    update: { qtyBaseMilli: saldoDespues },
  });

  /**
   * El costo del producto es un CACHÉ del último `balanceCostNetMilliPeso`
   * del libro (decisión sellada 18). Se actualiza solo cuando cambia, para no
   * escribir en `Product` en cada venta: una venta no toca el promedio.
   */
  if (costoDespues !== costoAntes) {
    await tx.product.update({ where: { id: pedido.productId }, data: { costNetMilliPeso: costoDespues } });
  }

  /**
   * Las alertas de stock (5.5) se evalúan acá y en ningún otro lado: este es
   * el único instante en que el saldo de un producto puede cambiar, así que
   * es el único en que la alerta puede nacer o dejar de ser cierta. Un
   * barrido periódico llegaría tarde y encima repetido.
   */
  await evaluarStockDeProducto(tx, {
    productId: pedido.productId,
    locationId: pedido.locationId,
    saldoDespues,
  });

  return {
    id: movimiento.id,
    qtyBaseMilli: qty,
    balanceBaseMilli: saldoDespues,
    balanceCostNetMilliPeso: costoDespues,
    saldoAntes,
    costoAntes,
  };
}
