/**
 * Code128, subconjunto B (tarea 1.3).
 *
 * Por qué a mano y no con una librería: la tienda no tiene internet, el
 * algoritmo cabe en una página y es determinista —o sea, se puede probar de
 * verdad, no "se ve bien"—. Una dependencia más es una dependencia más que
 * mantener en un PC que nadie va a actualizar.
 *
 * Se usa SOLO para dibujar la etiqueta en pantalla y en el PDF de vista previa.
 * Cuando el trabajo va a la térmica, se manda el comando ESC/POS `GS k` y es la
 * impresora la que dibuja el código: sale más nítido que cualquier rasterizado
 * nuestro, y a 203 dpi la nitidez es la diferencia entre que el lector lea o
 * no. Las dos rutas codifican el mismo texto.
 *
 * Subconjunto B y no C: el SKU es "FH-00001", que tiene letras y un guion. El
 * C solo comprime pares de dígitos y no sirve acá.
 */

/**
 * Los 107 patrones de barras/espacios. Cada string son 6 dígitos: ancho de
 * barra, espacio, barra, espacio, barra, espacio, en módulos.
 */
const PATRONES = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "233111",
];

const INICIO_B = 104;
const PARADA = 106;

/** Code128B cubre ASCII 32 a 126. Ni tildes ni ñ: una etiqueta no lleva texto. */
export function esCodificableCode128B(texto: string): boolean {
  return texto.length > 0 && [...texto].every((c) => {
    const n = c.charCodeAt(0);
    return n >= 32 && n <= 126;
  });
}

/**
 * Devuelve los anchos de las barras y espacios, alternando: el primero es
 * barra, el segundo espacio, y así. En módulos, no en píxeles.
 */
export function code128Widths(texto: string): number[] {
  if (!esCodificableCode128B(texto)) {
    throw new Error(`No se puede codificar "${texto}" en Code128B: solo acepta caracteres ASCII imprimibles`);
  }

  const valores = [INICIO_B, ...[...texto].map((c) => c.charCodeAt(0) - 32)];

  // Dígito de control: suma ponderada por la posición, módulo 103. El inicio
  // pesa 1, el primer carácter 1, el segundo 2, y así.
  let suma = INICIO_B;
  for (let i = 1; i < valores.length; i++) suma += valores[i]! * i;
  valores.push(suma % 103);
  valores.push(PARADA);

  const anchos: number[] = [];
  for (const v of valores) {
    for (const d of PATRONES[v]!) anchos.push(Number(d));
  }
  // La parada lleva dos módulos de barra extra al final; están en el patrón
  // 106 salvo el último tramo, que se agrega acá.
  anchos.push(2);
  return anchos;
}

/**
 * SVG autocontenido de la etiqueta: código de barras, el texto del SKU debajo
 * y el nombre arriba. Sin colores: la etiqueta se imprime en blanco y negro y
 * el brief prohíbe colores fuera de los tokens.
 */
export function code128Svg(
  texto: string,
  opciones: { moduloPx?: number; altoPx?: number; titulo?: string; precio?: string } = {},
): string {
  const modulo = opciones.moduloPx ?? 2;
  const alto = opciones.altoPx ?? 60;
  const anchos = code128Widths(texto);
  const anchoTotal = anchos.reduce((a, b) => a + b, 0) * modulo;

  const margenTitulo = opciones.titulo ? 16 : 0;
  const margenPrecio = opciones.precio ? 22 : 0;
  const altoTotal = alto + 18 + margenTitulo + margenPrecio;

  let x = 0;
  const barras: string[] = [];
  anchos.forEach((ancho, i) => {
    // Los índices pares son barra, los impares espacio.
    if (i % 2 === 0) barras.push(`<rect x="${x}" y="${margenTitulo}" width="${ancho * modulo}" height="${alto}"/>`);
    x += ancho * modulo;
  });

  const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const centro = anchoTotal / 2;

  const titulo = opciones.titulo
    ? `<text x="${centro}" y="12" text-anchor="middle" font-family="sans-serif" font-size="11">${escapar(opciones.titulo)}</text>`
    : "";
  const precio = opciones.precio
    ? `<text x="${centro}" y="${altoTotal - 4}" text-anchor="middle" font-family="sans-serif" font-size="17" font-weight="700">${escapar(opciones.precio)}</text>`
    : "";

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${anchoTotal}" height="${altoTotal}" viewBox="0 0 ${anchoTotal} ${altoTotal}" fill="currentColor">`,
    titulo,
    ...barras,
    `<text x="${centro}" y="${margenTitulo + alto + 13}" text-anchor="middle" font-family="monospace" font-size="12" letter-spacing="1">${escapar(texto)}</text>`,
    precio,
    "</svg>",
  ].join("");
}
