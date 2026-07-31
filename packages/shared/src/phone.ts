/**
 * Teléfonos chilenos normalizados a E.164 (tarea 6.1).
 *
 * POR QUÉ ESTO ES UNA FUNCIÓN PURA CON TESTS Y NO TRES LÍNEAS EN LA RUTA:
 *
 * `Customer.phone` es `@unique` y es la ÚNICA llave del cliente. Si
 * `+56912345678` y `912345678` entran como dos filas distintas, entonces son
 * dos clientes distintos, y el día que uno pida la baja el opt-out protege a
 * uno solo: al otro se le sigue escribiendo. La baja es requisito legal
 * (WA-03), así que la normalización no es prolijidad, es lo que hace que la
 * baja funcione. Por eso el test que importa no es "reconoce un móvil" sino
 * "estas cinco formas de escribir el mismo número dan UN string".
 *
 * Chile tiene una simplificación afortunada: **todo número nacional tiene 9
 * dígitos**. Móvil = 9 + 8 dígitos. Fijo = código de área (1 o 2 dígitos) +
 * abonado, sumando siempre 9. Así que no hace falta una tabla de códigos de
 * área que envejezca: basta el largo y el primer dígito.
 */

/** Prefijo internacional de Chile. */
const CHILE = "56";

export type TipoDeTelefono = "MOVIL" | "FIJO";

export type TelefonoOk = {
  ok: true;
  /** Lo que se guarda: `+56` seguido de los 9 dígitos nacionales. */
  e164: string;
  tipo: TipoDeTelefono;
  /** Para pantalla: `+56 9 1234 5678`. Nunca se guarda esta forma. */
  legible: string;
};

export type TelefonoMalo = { ok: false; error: string };

export type ResultadoTelefono = TelefonoOk | TelefonoMalo;

/**
 * Deja solo dígitos y quita los prefijos de marcado que la gente escribe:
 * el `+` internacional, el `56` de país y el `0` de larga distancia nacional
 * (que ya no se usa desde 2002, pero se sigue escribiendo en las libretas).
 */
function soloNacionales(entrada: string): string {
  let d = entrada.replace(/\D/g, "");

  // `0056...` y `+56...` colapsan al mismo lugar.
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith(CHILE) && d.length > 9) d = d.slice(CHILE.length);
  // El 0 de tránsito: `09 1234 5678`, `0 41 2123456`.
  if (d.startsWith("0")) d = d.slice(1);
  // Alguien escribió `+56 0 9 ...`: el 56 quedó adelante y el 0 detrás.
  if (d.startsWith(CHILE) && d.length > 9) d = d.slice(CHILE.length);

  return d;
}

/**
 * Normaliza a E.164 o explica por qué no se pudo, **en palabras que sirvan en
 * el mesón**: "faltan dígitos" no le dice al vendedor qué corregir con el
 * cliente al frente; "un número chileno tiene 9 dígitos" sí.
 *
 * Nunca lanza: quien llama decide qué hacer con el error, y en la venta la
 * respuesta es siempre "se guarda la venta sin cliente y se avisa".
 */
export function normalizarTelefono(entrada: string | null | undefined): ResultadoTelefono {
  const texto = (entrada ?? "").trim();
  if (texto === "") return { ok: false, error: "Falta el teléfono." };

  // Una letra en medio no es un separador: es un tecleo que hay que mirar.
  if (/[a-zA-Z]/.test(texto)) return { ok: false, error: "El teléfono lleva solo números." };

  const d = soloNacionales(texto);

  if (d.length !== 9) {
    return {
      ok: false,
      error:
        d.length < 9
          ? `Un número chileno tiene 9 dígitos (9 y ocho más si es celular). Escribiste ${d.length}.`
          : `Ese número tiene ${d.length} dígitos y uno chileno tiene 9. ¿Se coló un dígito de más?`,
    };
  }

  const primero = d[0]!;

  if (primero === "9") {
    return {
      ok: true,
      e164: `+${CHILE}${d}`,
      tipo: "MOVIL",
      legible: `+56 9 ${d.slice(1, 5)} ${d.slice(5)}`,
    };
  }

  /**
   * Fijos: los códigos de área de Chile empiezan entre 2 y 7 (2 Santiago, 41
   * Concepción, 45 Temuco, 65 Puerto Montt...). Ni el 8 ni el 1 ni el 0 abren
   * un código de área, así que `812345678` es un tecleo, no un teléfono.
   *
   * Se valida por rango y no con la lista de códigos: la lista cambia cuando
   * Subtel abre uno nuevo, y un archivo desactualizado rechazaría un número
   * bueno. El rango no envejece.
   */
  if (primero >= "2" && primero <= "7") {
    return {
      ok: true,
      e164: `+${CHILE}${d}`,
      tipo: "FIJO",
      legible: `+56 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}`,
    };
  }

  return {
    ok: false,
    error: "Un celular chileno parte con 9 y un fijo con su código de área. Ese número no parte con ninguno.",
  };
}

/**
 * Para pantalla, a partir de lo guardado. Un `+56941234567` en una tabla se
 * lee mal a 1,5 m; separado en grupos se lee de un vistazo.
 */
export function formatTelefono(e164: string): string {
  const r = normalizarTelefono(e164);
  return r.ok ? r.legible : e164;
}
