/**
 * Bajar un archivo que exige sesión.
 *
 * **Por qué no basta un `<a href>`.** Las rutas que sirven archivos piden rol
 * de administrador, y una descarga del navegador no manda la cabecera
 * `authorization`: el servidor responde 401 y el usuario se queda con un
 * archivo roto y ninguna explicación. Hay que pedirlo con `fetch`, que sí
 * lleva el token, y guardar el blob a mano.
 *
 * **Y por qué se comprueba `r.ok`.** Sin eso, un 403 se guarda igual: el
 * navegador escribe el JSON del error en un archivo llamado `catalogo.xlsx`,
 * y Excel lo abre con un mensaje de archivo corrupto. El síntoma manda a
 * revisar la planilla cuando el problema era el permiso. Acá se lee el error
 * del servidor y se devuelve el mensaje en español que la pantalla ya sabe
 * mostrar.
 */
import { getToken, ApiError } from "./api";

export async function descargarArchivo(ruta: string, nombre: string): Promise<void> {
  const r = await fetch(ruta, { headers: { authorization: `Bearer ${getToken() ?? ""}` } });

  if (!r.ok) {
    const cuerpo = await r.json().catch(() => ({}));
    throw new ApiError(cuerpo.error ?? "No se pudo bajar el archivo", r.status);
  }

  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(url);
}
