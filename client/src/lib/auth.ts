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
  // Must clear the active-squad scope too: leaving it set would make the next user to log
  // in on this browser send the previous user's squad as X-Squad-Id, which the server
  // rejects as a non-member (404) until the squad list reloads and re-seeds it.
  localStorage.removeItem("activeSquadId");
  // legacy key from the demo-auth era
  localStorage.removeItem("demoUser");
}

export function isAuthenticated(): boolean {
  return !!getToken() && !!getStoredUser();
}
