export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  role: "USER" | "ADMIN";
  createdAt: string;
}

export function getToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem("token");
}

export function getStoredUser(): AuthUser | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem("user");
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

export function setSession(token: string, user: AuthUser): void {
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
}

export function clearSession(): void {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  // legacy key from the demo-auth era
  localStorage.removeItem("demoUser");
}

export function isAuthenticated(): boolean {
  return !!getToken() && !!getStoredUser();
}
