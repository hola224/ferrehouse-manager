/**
 * Copiar al portapapeles, también en los terminales de la tienda.
 *
 * `navigator.clipboard` SOLO existe en contexto seguro: https o localhost. Los
 * terminales entran por `http://192.168.1.10:3000` —así lo dice el manual de
 * instalación— y ahí la API sencillamente no está. Una función que solo use
 * `navigator.clipboard` andaría perfecto en el PC del mostrador, que es
 * localhost, y no haría nada en los otros dos: el peor reparto posible,
 * porque se probaría justo donde funciona.
 *
 * El plan B es `document.execCommand("copy")`, obsoleto pero es lo único que
 * copia sin HTTPS. Y si tampoco resulta, se devuelve `false` y quien llama
 * muestra el número para teclearlo a mano; nunca se dice "copiado" sin haber
 * copiado.
 */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(texto);
      return true;
    } catch {
      // Puede fallar por permisos aunque la API exista: sigue el plan B.
    }
  }

  try {
    const caja = document.createElement("textarea");
    caja.value = texto;
    caja.setAttribute("readonly", "");
    // Fuera de la vista pero dentro del documento: `select()` no funciona
    // sobre un elemento con `display:none`.
    caja.style.position = "fixed";
    caja.style.top = "-1000px";
    caja.style.opacity = "0";
    document.body.appendChild(caja);
    caja.select();
    const copiado = document.execCommand("copy");
    document.body.removeChild(caja);
    return copiado;
  } catch {
    return false;
  }
}
