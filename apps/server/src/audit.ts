/**
 * Bitácora de auditoría (tarea 0.7). Transversal desde el día uno: agregarla
 * después significa que los primeros meses de operación no tienen historia.
 *
 * `entityId` es TEXTO a propósito: `PrintJob` y `WhatsAppJob` tienen id uuid,
 * el resto entero. Un Int no serviría para todas las entidades.
 *
 * Escribir en la bitácora NUNCA hace fallar la operación que la origina: si el
 * log revienta, se avisa por consola y la venta sigue.
 */
import { db } from "./db.js";
import type { Prisma } from "@prisma/client";

export type AuditAction =
  | "LOGIN"
  | "LOGIN_FAILED"
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_DEACTIVATED"
  | "PIN_CHANGED"
  | "PRODUCT_CREATED"
  | "PRODUCT_UPDATED"
  | "PRODUCT_DISCONTINUED"
  | "PRODUCTS_IMPORTED"
  | "SETTING_CHANGED"
  | "SALE_REVERSED"
  | "SALE_RETURNED"
  | "DISCOUNT_OVERRIDE"
  | "STOCK_OVERRIDE"
  | "STOCK_ADJUSTED"
  | "STOCK_SHRINKAGE"
  | "STOCK_RECONCILED"
  | "ALERT_RESOLVED"
  | "WHATSAPP_OPT_OUT"
  | "WHATSAPP_TEMPLATE_CHANGED"
  | "CASH_MOVEMENT"
  | "CASH_SESSION_OPENED"
  | "CASH_SESSION_CLOSED"
  | "STATION_CREATED"
  | "STATION_UPDATED"
  | "BACKUP_CREATED"
  | "BACKUP_COPY_SET";

export async function audit(
  entrada: {
    userId: number;
    action: AuditAction;
    entity: string;
    entityId?: string | number | null;
    payload?: unknown;
  },
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const cliente = tx ?? db;
  try {
    await cliente.auditLog.create({
      data: {
        userId: entrada.userId,
        action: entrada.action,
        entity: entrada.entity,
        entityId: entrada.entityId == null ? null : String(entrada.entityId),
        payload: entrada.payload === undefined ? null : JSON.stringify(entrada.payload),
      },
    });
  } catch (e) {
    console.error("[audit] no se pudo registrar", entrada.action, e);
  }
}
