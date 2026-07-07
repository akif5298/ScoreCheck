import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { api } from "@/lib/api";
import { type AuthUser, getStoredUser, setSession, clearSession } from "@/lib/auth";

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  demoLogin: () => Promise<void>;
  logout: () => void;
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

  useEffect(() => {
    const stored = getStoredUser();
    if (stored) setUser(stored);
    setLoading(false);
  }, []);

  const demoLogin = async () => {
    setLoading(true);
    try {
      // Use the backend's dev bypass — identityToken 'mock_identity_token' is
      // whitelisted in NODE_ENV=development to skip Apple verification.
      const res = await api.post<{ success: boolean; data: { user: AuthUser; token: string } }>(
        "/api/auth/apple",
        {
          identityToken: "mock_identity_token",
          authorizationCode: "dev_auth_code",
          user: {
            name: { firstName: "Demo", lastName: "User" },
            email: "demo@scorecheck.com",
          },
        },
      );
      if (res.success) {
        setSession(res.data.token, res.data.user);
        setUser(res.data.user);
      }
    } catch {
      // Backend unreachable — mirror the old frontend's fallback: store a fake
      // token so localStorage key names ('token', 'demoUser') stay identical.
      const mockUser: AuthUser = {
        id: "demo-user-id",
        email: "demo@scorecheck.com",
        name: "Demo User",
        role: "USER",
        createdAt: new Date().toISOString(),
      };
      const mockToken = "demo-token-" + Date.now();
      setSession(mockToken, mockUser);
      setUser(mockUser);
    } finally {
      setLoading(false);
    }
  };

  const logout = () => {
    clearSession();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, demoLogin, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
