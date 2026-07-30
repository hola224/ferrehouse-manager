import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";

export type Usuario = {
  sub: number;
  name: string;
  role: "ADMIN" | "SELLER";
  stationId: number;
  locationId: number;
};

type Ctx = {
  usuario: Usuario | null;
  cargando: boolean;
  entrar: (t: string, u: Usuario) => void;
  salir: () => void;
};

const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!getToken()) return setCargando(false);
    api<{ usuario: Usuario }>("/me")
      .then((r) => setUsuario(r.usuario))
      .catch(() => setToken(null))
      .finally(() => setCargando(false));
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        usuario,
        cargando,
        entrar: (t, u) => {
          setToken(t);
          setUsuario(u);
        },
        salir: () => {
          setToken(null);
          setUsuario(null);
        },
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth(): Ctx {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("useAuth fuera de AuthProvider");
  return c;
}
