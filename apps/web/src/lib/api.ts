const TOKEN_KEY = "fh.token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null): void {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(ruta: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const r = await fetch(`/api${ruta}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => ({}));
    // Los errores dicen qué hacer, no "Error de validación" (UI-BRIEF §2.5).
    throw new ApiError(cuerpo.error ?? "No se pudo conectar con el servidor", r.status);
  }
  return r.json() as Promise<T>;
}

/**
 * Como `api`, pero devuelve el cuerpo como texto. Existe por las respuestas que
 * no son JSON —el SVG del QR de WhatsApp— y que igual necesitan el token: una
 * etiqueta `<img>` no manda el encabezado de autorización, así que lo que es
 * solo-admin no se puede pedir por `src`.
 */
export async function apiTexto(ruta: string): Promise<string> {
  const token = getToken();
  const r = await fetch(`/api${ruta}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) {
    const cuerpo = await r.json().catch(() => ({}));
    throw new ApiError(cuerpo.error ?? "No se pudo conectar con el servidor", r.status);
  }
  return r.text();
}
