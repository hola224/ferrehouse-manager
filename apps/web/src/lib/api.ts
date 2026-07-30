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
