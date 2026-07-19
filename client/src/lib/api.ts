const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

function buildHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = typeof localStorage !== "undefined" ? localStorage.getItem("token") : null;
  const h: Record<string, string> = { ...extra };
  if (token) h["Authorization"] = `Bearer ${token}`;
  return h;
}

async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const isFormData = init.body instanceof FormData;
  const extraHeaders = (init.headers as Record<string, string> | undefined) ?? {};
  const headers = buildHeaders(
    isFormData ? extraHeaders : { "Content-Type": "application/json", ...extraHeaders },
  );
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    // Expired/invalid session on a non-auth route: clear it and send the user
    // to login. Auth routes handle their own 401s (wrong password etc.).
    if (
      res.status === 401 &&
      !path.startsWith("/api/auth/") &&
      typeof window !== "undefined" &&
      !window.location.pathname.startsWith("/login")
    ) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.assign("/login");
    }
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw Object.assign(new Error((body as Record<string, string>).error ?? "Request failed"), {
      status: res.status,
    });
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T = unknown>(path: string) => apiFetch<T>(path),
  post: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "POST",
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  put: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T = unknown>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};
