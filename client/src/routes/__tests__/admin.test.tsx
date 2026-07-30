/**
 * The admin page — instance-wide user and game management.
 *
 * Two safeguards matter here. The role gate keeps a non-admin out of the view (the server
 * enforces it too, but rendering the table to someone who cannot act on it is misleading),
 * and the self-row guard prevents an admin from deleting or demoting their own account —
 * which, on a single-admin instance, would lock everyone out of user management permanently.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

let authState: { user: { id: string; role: string } | null; loading: boolean };

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
}));

vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Card: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section aria-label={title}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  ),
  Metric: ({ label, value }: { label: string; value: string | number }) => (
    <div data-testid={`metric-${label}`}>{value}</div>
  ),
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/contexts/auth-context", () => ({ useAuth: () => authState }));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

import { Route } from "@/routes/admin";
import { api } from "@/lib/api";

const Admin = (Route as unknown as { component: () => ReactNode }).component;
const get = vi.mocked(api.get);
const patch = vi.mocked(api.patch);
const del = vi.mocked(api.del);

function adminUser(over: Record<string, unknown> = {}) {
  return {
    id: "u2",
    email: "nillan@test.local",
    name: "Nillan",
    role: "USER",
    createdAt: "2026-02-20T00:00:00.000Z",
    _count: { uploadedGames: 3 },
    ...over,
  };
}

function recentGame(over: Record<string, unknown> = {}) {
  return {
    id: "g1",
    homeTeam: "Akif (PG)",
    awayTeam: "Team B",
    homeScore: 102,
    awayScore: 98,
    createdAt: "2026-07-29T00:00:00.000Z",
    uploadedBy: { id: "u1", email: "akif@test.local", name: "Akif" },
    ...over,
  };
}

function dashboard(over: Record<string, unknown> = {}) {
  return {
    totalUsers: 4,
    totalGames: 38,
    totalPlayers: 380,
    recentGames: [recentGame()],
    topUsers: [],
    ...over,
  };
}

function routeGet(handlers: { dashboard?: () => unknown; users?: () => unknown } = {}) {
  get.mockImplementation((path: string) => {
    if (path.endsWith("/dashboard")) {
      return (handlers.dashboard?.() ??
        Promise.resolve({ success: true, data: dashboard() })) as never;
    }
    if (path.endsWith("/users")) {
      return (handlers.users?.() ??
        Promise.resolve({ success: true, data: [adminUser()] })) as never;
    }
    return Promise.resolve({ success: true, data: [] }) as never;
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Admin />
    </QueryClientProvider>,
  );
}

async function renderLoaded() {
  const result = renderPage();
  await waitFor(() => expect(screen.queryByText("Loading…")).not.toBeInTheDocument());
  return result;
}

/** The users-table row for a given display name. */
function userRow(name: string): HTMLElement {
  return within(screen.getByRole("region", { name: "Users" }))
    .getByText(name)
    .closest("tr") as HTMLElement;
}

beforeEach(() => {
  toastError.mockReset();
  toastSuccess.mockReset();
  get.mockReset();
  patch.mockReset().mockResolvedValue({
    success: true,
    data: { ...adminUser(), role: "ADMIN" },
  });
  del.mockReset().mockResolvedValue({ success: true });
  authState = { user: { id: "u1", role: "ADMIN" }, loading: false };
  routeGet();
});

describe("the route definition", () => {
  it("sets a title and description", () => {
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();

    expect(head.meta[0]).toEqual({ title: "Admin — ScoreCheck" });
  });
});

describe("the role gate", () => {
  it("refuses a non-admin", () => {
    authState = { user: { id: "u2", role: "USER" }, loading: false };

    renderPage();

    expect(screen.getByText("Not authorized")).toBeInTheDocument();
    expect(screen.getByText(/doesn't have admin access/)).toBeInTheDocument();
  });

  it("fetches nothing for a non-admin", () => {
    authState = { user: { id: "u2", role: "USER" }, loading: false };

    renderPage();

    // The server would refuse anyway; not asking avoids two guaranteed 403s per visit.
    expect(get).not.toHaveBeenCalled();
  });

  it("does not refuse while auth is still resolving", () => {
    authState = { user: null, loading: true };

    renderPage();

    // Flashing "Not authorized" at an admin mid-verify would be alarming and wrong.
    expect(screen.queryByText("Not authorized")).not.toBeInTheDocument();
  });

  it("admits an admin", async () => {
    await renderLoaded();

    expect(screen.getByRole("region", { name: "Users" })).toBeInTheDocument();
  });
});

describe("the instance metrics", () => {
  it("shows placeholders while loading", () => {
    routeGet({ dashboard: () => new Promise(() => {}) });

    renderPage();

    expect(screen.getByTestId("metric-Users")).toHaveTextContent("…");
  });

  it("shows the totals", async () => {
    await renderLoaded();

    await waitFor(() => expect(screen.getByTestId("metric-Users")).toHaveTextContent("4"));
    expect(screen.getByTestId("metric-Games")).toHaveTextContent("38");
    expect(screen.getByTestId("metric-Player rows")).toHaveTextContent("380");
  });

  it("falls back to zero when a total is missing", async () => {
    routeGet({
      dashboard: () =>
        Promise.resolve({
          success: true,
          data: dashboard({ totalUsers: undefined, totalGames: undefined }),
        }),
    });

    await renderLoaded();

    await waitFor(() => expect(screen.getByTestId("metric-Users")).toHaveTextContent("0"));
    expect(screen.getByTestId("metric-Games")).toHaveTextContent("0");
  });

  it("survives a dashboard response with no recentGames array", async () => {
    routeGet({ dashboard: () => Promise.resolve({ success: true, data: { totalUsers: 4 } }) });

    await renderLoaded();

    // `!dashboard || dashboard.recentGames.length === 0` guarded a null dashboard but not a
    // present-yet-partial one, so `.length` threw and took the whole page down — including the
    // users table, which had loaded fine.
    await waitFor(() => expect(screen.getByTestId("metric-Users")).toHaveTextContent("4"));
    expect(screen.getByRole("region", { name: "Users" })).toBeInTheDocument();
    expect(screen.getByText("No games yet.")).toBeInTheDocument();
  });
});

describe("the users table", () => {
  it("shows each account with its role and upload count", async () => {
    await renderLoaded();
    const row = userRow("Nillan");

    expect(within(row).getByText("nillan@test.local")).toBeInTheDocument();
    expect(within(row).getByText("Member")).toBeInTheDocument();
    expect(within(row).getByText("3")).toBeInTheDocument();
  });

  it("labels an admin as such", async () => {
    routeGet({
      users: () => Promise.resolve({ success: true, data: [adminUser({ role: "ADMIN" })] }),
    });

    await renderLoaded();

    expect(within(userRow("Nillan")).getByText("Admin")).toBeInTheDocument();
  });

  it("shows a dash for an account with no name", async () => {
    routeGet({
      users: () => Promise.resolve({ success: true, data: [adminUser({ name: null })] }),
    });

    await renderLoaded();

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows a loading note while users load", () => {
    routeGet({ users: () => new Promise(() => {}) });

    renderPage();

    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  });
});

describe("protecting your own account", () => {
  beforeEach(() => {
    routeGet({
      users: () =>
        Promise.resolve({
          success: true,
          data: [adminUser({ id: "u1", name: "You", role: "ADMIN" }), adminUser()],
        }),
    });
  });

  it("marks your own row and offers no actions on it", async () => {
    await renderLoaded();
    const row = userRow("You");

    // Demoting or deleting yourself on a single-admin instance locks user management shut
    // for good — there is no other admin left to undo it.
    expect(within(row).getByText("you")).toBeInTheDocument();
    expect(within(row).queryByRole("button")).not.toBeInTheDocument();
  });

  it("still offers actions on other accounts", async () => {
    await renderLoaded();
    const row = userRow("Nillan");

    expect(within(row).getByRole("button", { name: "Make admin" })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});

describe("changing a role", () => {
  it("promotes a member", async () => {
    await renderLoaded();

    await userEvent.click(within(userRow("Nillan")).getByRole("button", { name: "Make admin" }));

    expect(patch).toHaveBeenCalledWith("/api/admin/users/u2/role", { role: "ADMIN" });
  });

  it("demotes an admin", async () => {
    routeGet({
      users: () => Promise.resolve({ success: true, data: [adminUser({ role: "ADMIN" })] }),
    });
    patch.mockResolvedValue({ success: true, data: { ...adminUser(), role: "USER" } });
    await renderLoaded();

    await userEvent.click(within(userRow("Nillan")).getByRole("button", { name: "Demote" }));

    expect(patch).toHaveBeenCalledWith("/api/admin/users/u2/role", { role: "USER" });
  });

  it("confirms the new role in the server's words", async () => {
    await renderLoaded();

    await userEvent.click(within(userRow("Nillan")).getByRole("button", { name: "Make admin" }));

    // Reported from the response, not the request — so a server that refused part of it
    // cannot be misreported as success.
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("nillan@test.local is now an admin"),
    );
  });

  it("words a demotion differently", async () => {
    patch.mockResolvedValue({ success: true, data: { ...adminUser(), role: "USER" } });
    await renderLoaded();

    await userEvent.click(within(userRow("Nillan")).getByRole("button", { name: "Make admin" }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("nillan@test.local is now a member"),
    );
  });

  it("surfaces a refused change", async () => {
    patch.mockRejectedValue(new Error("Cannot change your own role"));
    await renderLoaded();

    await userEvent.click(within(userRow("Nillan")).getByRole("button", { name: "Make admin" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Cannot change your own role"));
  });
});

describe("deleting a user", () => {
  it("asks before deleting", async () => {
    await renderLoaded();

    await userEvent.click(within(userRow("Nillan")).getByRole("button", { name: "Delete" }));

    expect(within(userRow("Nillan")).getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes on confirmation", async () => {
    await renderLoaded();
    await userEvent.click(within(userRow("Nillan")).getByRole("button", { name: "Delete" }));

    await userEvent.click(within(userRow("Nillan")).getByRole("button", { name: "Confirm" }));

    expect(del).toHaveBeenCalledWith("/api/admin/users/u2");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("User deleted"));
  });

  it("backs out on cancel", async () => {
    await renderLoaded();
    await userEvent.click(within(userRow("Nillan")).getByRole("button", { name: "Delete" }));

    await userEvent.click(within(userRow("Nillan")).getByRole("button", { name: "Cancel" }));

    expect(del).not.toHaveBeenCalled();
    expect(within(userRow("Nillan")).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("surfaces a refused delete", async () => {
    del.mockRejectedValue(new Error("User still owns a squad"));
    await renderLoaded();
    await userEvent.click(within(userRow("Nillan")).getByRole("button", { name: "Delete" }));

    await userEvent.click(within(userRow("Nillan")).getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("User still owns a squad"));
  });
});

describe("recent games across the instance", () => {
  function gamesCard() {
    return within(screen.getByRole("region", { name: "Recent games" }));
  }

  it("shows the matchup away-at-home, with the uploader", async () => {
    await renderLoaded();

    expect(gamesCard().getByText("Team B 98 @ Akif (PG) 102")).toBeInTheDocument();
    expect(gamesCard().getByText(/Akif ·/)).toBeInTheDocument();
  });

  it("falls back to the uploader's email when they have no name", async () => {
    routeGet({
      dashboard: () =>
        Promise.resolve({
          success: true,
          data: dashboard({
            recentGames: [
              recentGame({ uploadedBy: { id: "u9", email: "ghost@test.local", name: null } }),
            ],
          }),
        }),
    });

    await renderLoaded();

    expect(gamesCard().getByText(/ghost@test\.local ·/)).toBeInTheDocument();
  });

  it("says so when there are no games", async () => {
    routeGet({
      dashboard: () => Promise.resolve({ success: true, data: dashboard({ recentGames: [] }) }),
    });

    await renderLoaded();

    expect(gamesCard().getByText("No games yet.")).toBeInTheDocument();
  });

  it("says so when the dashboard is missing entirely", async () => {
    routeGet({ dashboard: () => Promise.resolve({ success: true, data: null }) });

    await renderLoaded();

    expect(gamesCard().getByText("No games yet.")).toBeInTheDocument();
  });

  it("asks before deleting a game", async () => {
    await renderLoaded();

    await userEvent.click(gamesCard().getByRole("button", { name: "Delete" }));

    expect(gamesCard().getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes on confirmation", async () => {
    await renderLoaded();
    await userEvent.click(gamesCard().getByRole("button", { name: "Delete" }));

    await userEvent.click(gamesCard().getByRole("button", { name: "Confirm" }));

    // The admin route deletes any game instance-wide, bypassing the squad permission rules.
    expect(del).toHaveBeenCalledWith("/api/admin/games/g1");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Game deleted"));
  });

  it("backs out on cancel", async () => {
    await renderLoaded();
    await userEvent.click(gamesCard().getByRole("button", { name: "Delete" }));

    await userEvent.click(gamesCard().getByRole("button", { name: "Cancel" }));

    expect(del).not.toHaveBeenCalled();
  });

  it("surfaces a refused delete", async () => {
    del.mockRejectedValue(new Error("Game not found"));
    await renderLoaded();
    await userEvent.click(gamesCard().getByRole("button", { name: "Delete" }));

    await userEvent.click(gamesCard().getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Game not found"));
  });

  it("shows a loading note while the dashboard loads", () => {
    routeGet({ dashboard: () => new Promise(() => {}) });

    renderPage();

    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  });
});
