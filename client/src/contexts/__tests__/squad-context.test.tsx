/**
 * Active-squad state.
 *
 * This is the scope every request is filtered by, so the failure mode is not a crash — it
 * is one group quietly seeing another group's games, or an upload landing in the wrong
 * squad. The localStorage key is read directly by buildHeaders on every request, which is
 * why the seeding rules below matter more than they look.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { SquadProvider, useSquads, type Squad } from "@/contexts/squad-context";
import { api, ACTIVE_SQUAD_KEY } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

vi.mock("@/contexts/auth-context", () => ({ useAuth: vi.fn() }));

const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const mockedUseAuth = vi.mocked(useAuth);

function squad(over: Partial<Squad> = {}): Squad {
  return {
    id: "squad-a",
    name: "Squad A",
    isPersonal: false,
    role: "OWNER",
    memberCount: 3,
    gameCount: 12,
    isActive: false,
    ...over,
  };
}

/** Signed in unless told otherwise — the provider does nothing without a user. */
function signedIn(loading = false) {
  mockedUseAuth.mockReturnValue({
    user: { id: "u1", email: "a@b.c", role: "USER", createdAt: "" },
    loading,
  } as unknown as ReturnType<typeof useAuth>);
}

function signedOut() {
  mockedUseAuth.mockReturnValue({ user: null, loading: false } as unknown as ReturnType<
    typeof useAuth
  >);
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <SquadProvider>{children}</SquadProvider>
);

function renderSquads() {
  return renderHook(() => useSquads(), { wrapper });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  mockedUseAuth.mockReset();
  signedIn();
});

describe("useSquads outside a provider", () => {
  it("throws rather than handing back undefined", () => {
    expect(() => renderHook(() => useSquads())).toThrow(/must be used within SquadProvider/);
  });
});

describe("loading the squad list", () => {
  it("fetches once the user is known", async () => {
    get.mockResolvedValue({ success: true, data: [squad()] });

    const { result } = renderSquads();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(get).toHaveBeenCalledWith("/api/squads");
    expect(result.current.squads).toHaveLength(1);
  });

  it("waits while auth is still resolving", async () => {
    signedIn(true);

    renderSquads();

    // Fetching before the token is confirmed sends an unauthenticated request that 401s
    // and, through the api client, redirects to /login mid-boot.
    await waitFor(() => expect(get).not.toHaveBeenCalled());
  });

  it("holds no squads for a signed-out visitor", async () => {
    signedOut();

    const { result } = renderSquads();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.squads).toEqual([]);
    expect(get).not.toHaveBeenCalled();
  });

  it("degrades to an empty list when the request fails", async () => {
    get.mockRejectedValue(new Error("db down"));

    const { result } = renderSquads();

    // A failed squad fetch must not wedge the app in a permanent loading state.
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.squads).toEqual([]);
  });

  it("tolerates a response with no data array", async () => {
    get.mockResolvedValue({ success: true });

    const { result } = renderSquads();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.squads).toEqual([]);
  });
});

describe("seeding the stored scope", () => {
  it("writes the server's active squad on a fresh session", async () => {
    get.mockResolvedValue({
      success: true,
      data: [squad({ id: "squad-a" }), squad({ id: "squad-b", isActive: true })],
    });

    const { result } = renderSquads();

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Without this, a new device sends no X-Squad-Id until the user touches the switcher.
    expect(localStorage.getItem(ACTIVE_SQUAD_KEY)).toBe("squad-b");
  });

  it("falls back to the first squad when the server marks none active", async () => {
    get.mockResolvedValue({ success: true, data: [squad({ id: "squad-a" })] });

    const { result } = renderSquads();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(localStorage.getItem(ACTIVE_SQUAD_KEY)).toBe("squad-a");
  });

  it("keeps a stored squad the user is still a member of", async () => {
    localStorage.setItem(ACTIVE_SQUAD_KEY, "squad-a");
    get.mockResolvedValue({
      success: true,
      data: [squad({ id: "squad-a" }), squad({ id: "squad-b", isActive: true })],
    });

    const { result } = renderSquads();

    await waitFor(() => expect(result.current.loading).toBe(false));
    // The local choice wins over the server's, so switching in one tab is not undone by a
    // reload in another.
    expect(localStorage.getItem(ACTIVE_SQUAD_KEY)).toBe("squad-a");
  });

  it("replaces a stored squad the user is no longer in", async () => {
    localStorage.setItem(ACTIVE_SQUAD_KEY, "squad-gone");
    get.mockResolvedValue({ success: true, data: [squad({ id: "squad-a", isActive: true })] });

    const { result } = renderSquads();

    await waitFor(() => expect(result.current.loading).toBe(false));
    // A removed member would otherwise send a squad id the server 404s on, with every page
    // failing until they cleared site data.
    expect(localStorage.getItem(ACTIVE_SQUAD_KEY)).toBe("squad-a");
  });

  it("writes nothing when the user belongs to no squads", async () => {
    get.mockResolvedValue({ success: true, data: [] });

    const { result } = renderSquads();

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(localStorage.getItem(ACTIVE_SQUAD_KEY)).toBeNull();
  });
});

describe("activeSquad", () => {
  it("resolves the stored id against the list", async () => {
    localStorage.setItem(ACTIVE_SQUAD_KEY, "squad-b");
    get.mockResolvedValue({
      success: true,
      data: [squad({ id: "squad-a" }), squad({ id: "squad-b", name: "Squad B" })],
    });

    const { result } = renderSquads();

    await waitFor(() => expect(result.current.activeSquad?.name).toBe("Squad B"));
  });

  it("is null before anything has loaded", () => {
    get.mockReturnValue(new Promise(() => {}));

    const { result } = renderSquads();

    expect(result.current.activeSquad).toBeNull();
  });
});

describe("switchSquad", () => {
  it("persists server-side, stores the id, then reloads", async () => {
    const assign = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...window.location, pathname: "/games", assign },
    });
    get.mockResolvedValue({ success: true, data: [squad({ id: "squad-a" })] });
    post.mockResolvedValue({ success: true });
    const { result } = renderSquads();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.switchSquad("squad-b");
    });

    // The order matters: persisting server-side first means a new device starts in the
    // right scope, and the reload is what re-scopes pages that fetch in useEffect rather
    // than through React Query.
    expect(post).toHaveBeenCalledWith("/api/squads/squad-b/activate");
    expect(localStorage.getItem(ACTIVE_SQUAD_KEY)).toBe("squad-b");
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("leaves the stored scope alone when the server refuses", async () => {
    localStorage.setItem(ACTIVE_SQUAD_KEY, "squad-a");
    get.mockResolvedValue({ success: true, data: [squad({ id: "squad-a" })] });
    post.mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }));
    const { result } = renderSquads();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.switchSquad("squad-not-mine")).rejects.toThrow();

    // Writing the id before the server agreed would leave every later request scoped to a
    // squad the user cannot read, with no way back but clearing storage.
    expect(localStorage.getItem(ACTIVE_SQUAD_KEY)).toBe("squad-a");
  });
});

describe("refresh", () => {
  it("re-reads the list without a reload", async () => {
    get.mockResolvedValue({ success: true, data: [squad({ id: "squad-a" })] });
    const { result } = renderSquads();
    await waitFor(() => expect(result.current.loading).toBe(false));

    get.mockResolvedValue({
      success: true,
      data: [squad({ id: "squad-a" }), squad({ id: "squad-b" })],
    });
    await act(async () => {
      await result.current.refresh();
    });

    // Creating a squad or joining one has to show up in the switcher immediately.
    expect(result.current.squads).toHaveLength(2);
  });
});
