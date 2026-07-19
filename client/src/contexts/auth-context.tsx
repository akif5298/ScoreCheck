import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { api } from "@/lib/api";
import { type AuthUser, getToken, getStoredUser, setSession, clearSession } from "@/lib/auth";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: {
    email: string;
    password: string;
    name?: string;
    inviteCode: string;
  }) => Promise<void>;
  logout: () => void;
}

interface AuthResponse {
  success: boolean;
  data: { user: AuthUser; token: string };
  error?: string;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Hydrate optimistically from localStorage, then confirm the token with the
  // server; a stale/invalid token logs the session out.
  useEffect(() => {
    const token = getToken();
    if (!token) {
      clearSession();
      setLoading(false);
      return;
    }
    const stored = getStoredUser();
    if (stored) setUser(stored);

    api
      .post<{ success: boolean; data: { user: AuthUser } }>("/api/auth/verify", { token })
      .then((res) => {
        setSession(token, res.data.user);
        setUser(res.data.user);
      })
      .catch(() => {
        clearSession();
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const res = await api.post<AuthResponse>("/api/auth/login", { email, password });
    setSession(res.data.token, res.data.user);
    setUser(res.data.user);
  };

  const signup = async (input: {
    email: string;
    password: string;
    name?: string;
    inviteCode: string;
  }) => {
    const res = await api.post<AuthResponse>("/api/auth/signup", input);
    setSession(res.data.token, res.data.user);
    setUser(res.data.user);
  };

  const logout = () => {
    clearSession();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
