/**
 * Auth state for the whole app.
 *
 * The part worth testing hardest is the mount effect: it hydrates optimistically from
 * localStorage so the shell renders instantly, then confirms the token with the server. Get
 * the confirmation branch wrong and a revoked or expired token keeps rendering a logged-in
 * app until the first API call happens to fail — JWTs here are 7-day with no revocation, so
 * this verify call is the only thing that notices.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { AuthProvider, useAuth } from "@/contexts/auth-context";
import { api } from "@/lib/api";
import type { AuthUser } from "@/lib/auth";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

const post = vi.mocked(api.post);

const USER: AuthUser = {
  id: "u1",
  email: "akif@test.local",
  name: "Akif",
  role: "USER",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const wrapper = ({ children }: { children: ReactNode }) => <AuthProvider>{children}</AuthProvider>;

function renderAuth() {
  return renderHook(() => useAuth(), { wrapper });
}

function storeSession(user: AuthUser = USER, token = "jwt-value") {
  localStorage.setItem("token", token);
  localStorage.setItem("user", JSON.stringify(user));
}

beforeEach(() => {
  post.mockReset();
});

describe("useAuth outside a provider", () => {
  it("throws rather than handing back undefined", () => {
    // Without this guard the caller destructures undefined and the failure surfaces as
    // "cannot read property user of undefined" somewhere far from the missing provider.
    expect(() => renderHook(() => useAuth())).toThrow(/must be used within AuthProvider/);
  });
});

describe("mounting with no token", () => {
  it("finishes loading with no user", async () => {
    const { result } = renderAuth();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it("does not call verify", async () => {
    const { result } = renderAuth();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(post).not.toHaveBeenCalled();
  });

  it("clears any half-written session", async () => {
    // A user entry with no token is a broken session; leaving it makes isAuthenticated
    // disagree with the context.
    localStorage.setItem("user", JSON.stringify(USER));

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(localStorage.getItem("user")).toBeNull();
  });
});

describe("mounting with a stored token", () => {
  it("hydrates from localStorage before the server answers", async () => {
    storeSession();
    let resolve!: (value: unknown) => void;
    post.mockReturnValue(new Promise((r) => (resolve = r)));

    const { result } = renderAuth();

    // The point of the optimistic read: the shell renders the signed-in user immediately
    // rather than flashing the login screen on every page load.
    await waitFor(() => expect(result.current.user).toEqual(USER));
    expect(result.current.loading).toBe(true);

    await act(async () => {
      resolve({ success: true, data: { user: USER } });
    });
  });

  it("verifies the token with the server", async () => {
    storeSession();
    post.mockResolvedValue({ success: true, data: { user: USER } });

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(post).toHaveBeenCalledWith("/api/auth/verify", { token: "jwt-value" });
  });

  it("refreshes the stored user from the server's copy", async () => {
    storeSession({ ...USER, name: "Old Name" });
    post.mockResolvedValue({ success: true, data: { user: { ...USER, name: "New Name" } } });

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.user?.name).toBe("New Name"));
    // A role change made by an admin has to land somewhere; this is where.
    expect(JSON.parse(localStorage.getItem("user") as string).name).toBe("New Name");
  });

  it("logs out when the token no longer verifies", async () => {
    storeSession();
    post.mockRejectedValue(Object.assign(new Error("Authentication failed"), { status: 401 }));

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem("token")).toBeNull();
  });

  it("clears the active squad when the session is rejected", async () => {
    storeSession();
    localStorage.setItem("activeSquadId", "squad-a");
    post.mockRejectedValue(new Error("Authentication failed"));

    const { result } = renderAuth();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(localStorage.getItem("activeSquadId")).toBeNull();
  });

  it("still verifies when the stored user is corrupt", async () => {
    localStorage.setItem("token", "jwt-value");
    localStorage.setItem("user", "{not json");
    post.mockResolvedValue({ success: true, data: { user: USER } });

    const { result } = renderAuth();

    // The optimistic read fails, but the token is what authenticates — the server's answer
    // repairs the stored user rather than forcing a re-login.
    await waitFor(() => expect(result.current.user).toEqual(USER));
  });
});

describe("login", () => {
  it("stores the session and exposes the user", async () => {
    post.mockResolvedValue({ success: true, data: { user: USER, token: "fresh-jwt" } });
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.login("akif@test.local", "hunter2");
    });

    expect(post).toHaveBeenCalledWith("/api/auth/login", {
      email: "akif@test.local",
      password: "hunter2",
    });
    expect(localStorage.getItem("token")).toBe("fresh-jwt");
    expect(result.current.user).toEqual(USER);
  });

  it("propagates a rejection so the form can show it", async () => {
    post.mockRejectedValue(new Error("Invalid credentials"));
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.login("akif@test.local", "wrong")).rejects.toThrow(
      "Invalid credentials",
    );
    expect(result.current.user).toBeNull();
  });
});

describe("signup", () => {
  it("passes the invite code through and stores the session", async () => {
    post.mockResolvedValue({ success: true, data: { user: USER, token: "fresh-jwt" } });
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.signup({
        email: "akif@test.local",
        password: "hunter2",
        name: "Akif",
        inviteCode: "squad-invite-token",
      });
    });

    // The invite token doubles as the signup gate, so it must reach the server verbatim.
    expect(post).toHaveBeenCalledWith("/api/auth/signup", {
      email: "akif@test.local",
      password: "hunter2",
      name: "Akif",
      inviteCode: "squad-invite-token",
    });
    expect(result.current.user).toEqual(USER);
  });

  it("propagates a rejected invite", async () => {
    post.mockRejectedValue(new Error("Invalid invite code"));
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      result.current.signup({ email: "a@b.c", password: "p", inviteCode: "bad" }),
    ).rejects.toThrow("Invalid invite code");
  });
});

describe("logout", () => {
  it("drops the user and every stored key", async () => {
    storeSession();
    localStorage.setItem("activeSquadId", "squad-a");
    post.mockResolvedValue({ success: true, data: { user: USER } });
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.logout());

    expect(result.current.user).toBeNull();
    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
    // Otherwise the next user on this browser sends the previous user's squad id.
    expect(localStorage.getItem("activeSquadId")).toBeNull();
  });

  it("does not call the server", async () => {
    storeSession();
    post.mockResolvedValue({ success: true, data: { user: USER } });
    const { result } = renderAuth();
    await waitFor(() => expect(result.current.loading).toBe(false));
    post.mockClear();

    act(() => result.current.logout());

    // The JWT is stateless with no revocation endpoint, so logout is purely local.
    expect(post).not.toHaveBeenCalled();
  });
});
