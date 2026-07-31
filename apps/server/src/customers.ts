/**
 * El cliente que se captura en el mesón (tarea 6.1) — WA-01.
 *
 * Es lo más liviano que puede ser un cliente: teléfono, quizá nombre, y si
 * aceptó que le escriban. No hay ficha, ni historial, ni fidelización — eso
 * está descartado del alcance a propósito.
 *
 * **El teléfono es la llave**, y por eso pasa por `normalizarTelefono` antes de
 * tocar la base: `Customer.phone` es único y dos formas de escribir el mismo
 * número serían dos clientes, con el opt-out de uno protegiendo a uno solo.
 */
import { db } from "./db.js";
import { normalizarTelefono } from "@ferrehouse/shared";

export type EntradaCliente = {
  nombre?: string | null;
  telefono: string;
  consentimiento: boolean;
};

export type ResultadoCaptura =
  | { ok: true; customerId: number; aviso: string | null }
  | { ok: false; error: string };

/**
 * Busca o crea el cliente. **Nunca lanza por un teléfono malo**: devuelve el
 * error para que la venta siga sin cliente (invariante del sprint: un número
 * inválido no bloquea la venta).
 */
export async function capturarCliente(entrada: EntradaCliente): Promise<ResultadoCaptura> {
  const tel = normalizarTelefono(entrada.telefono);
  if (!tel.ok) return { ok: false, error: tel.error };

  const nombre = entrada.nombre?.trim() || null;
  const ahora = new Date();

  const existente = await db.customer.findUnique({ where: { phone: tel.e164 } });

  if (!existente) {
    const creado = await db.customer.create({
      data: {
        phone: tel.e164,
        name: nombre,
        whatsappConsent: entrada.consentimiento,
        consentAt: entrada.consentimiento ? ahora : null,
      },
      select: { id: true },
    });
    return { ok: true, customerId: creado.id, aviso: null };
  }

  /**
   * LA BAJA NO SE DESHACE DESDE EL MESÓN.
   *
   * Si este cliente pidió que no le escriban, el checkbox del vendedor no lo
   * vuelve a suscribir. El vendedor puede marcarlo por costumbre, o porque el
   * campo venía marcado de la venta anterior; y "alguien marcó una casilla"
   * no es el consentimiento que la baja exige revertir. La venta se registra
   * igual —el cliente queda atribuido— y la pantalla lo dice, porque callarlo
   * haría creer que el mensaje va a salir.
   */
  if (existente.optOutAt) {
    return {
      ok: true,
      customerId: existente.id,
      aviso: "Este cliente pidió no recibir mensajes. La venta se registró, pero no se le va a escribir.",
    };
  }

  await db.customer.update({
    where: { id: existente.id },
    data: {
      // El nombre solo se completa, no se pisa: si en el mesón esta vez no lo
      // dictaron, el que ya estaba vale más que un vacío.
      name: nombre ?? existente.name,
      whatsappConsent: entrada.consentimiento || existente.whatsappConsent,
      // La fecha marca la PRIMERA vez que aceptó, que es la que hay que poder
      // mostrar si alguna vez pregunta desde cuándo se le escribe.
      consentAt: existente.consentAt ?? (entrada.consentimiento ? ahora : null),
    },
  });

  return { ok: true, customerId: existente.id, aviso: null };
}
