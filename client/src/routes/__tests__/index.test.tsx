/**
 * The overview dashboard.
 *
 * Everything here is optional-chained off one response, so the interesting cases are the
 * degraded ones: a missing field must render a zero rather than "undefined", and a failed
 * request must be distinguishable from a league with no games.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  Link: ({ to, children }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => (
    <div>
      <div data-testid="actions">{actions}</div>
      {children}
    </div>
  ),
  Card: ({
    title,
    action,
    children,
  }: {
    title?: string;
    action?: ReactNode;
    children: ReactNode;
  }) => (
    <section aria-label={title}>
      {action}
      {children}
    </section>
  ),
  Metric: ({ label, value }: { label: string; value: string | number }) => (
    <div data-testid={`metric-${label}`}>{value}</div>
  ),
  Badge: ({ children }: { children: ReactNode }) => <span data-testid="badge">{children}</span>,
}));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

import { Route } from "@/routes/index";
import { api } from "@/lib/api";

const Dashboard = (Route as unknown as { component: () => ReactNode }).component;
const get = vi.mocked(api.get);

function game(over: Record<string, unknown> = {}) {
  return {
    id: "g1",
    homeTeam: "Akif (PG)",
    awayTeam: "Team B",
    homeScore: 102,
    awayScore: 98,
    createdAt: "2026-07-29T00:00:00.000Z",
    ...over,
  };
}

function leader(over: Record<string, unknown> = {}) {
  return { playerName: "Akif", avgPoints: 24.44, team: "Akif (PG)", ...over };
}

function dashboard(over: Record<string, unknown> = {}) {
  return {
    totalGames: 38,
    totalPlayers: 12,
    totalTeams: 76,
    avgPointsTeamAAndB: 101.27,
    recentGames: [game()],
    topPerformers: { points: [leader()], rebounds: [], assists: [] },
    ...over,
  };
}

function resolves(data: unknown = dashboard(), success = true) {
  get.mockResolvedValue({ success, data });
}

async function renderLoaded() {
  const result = render(<Dashboard />);
  await waitFor(() => expect(result.container.querySelector(".animate-spin")).toBeNull());
  return result;
}

function metric(label: string) {
  return screen.getByTestId(`metric-${label}`).textContent;
}

beforeEach(() => {
  get.mockReset();
  resolves();
});

describe("the route definition", () => {
  it("sets a title, description and link preview", () => {
    const head = (
      Route as unknown as {
        head: () => { meta: Record<string, string>[] };
      }
    ).head();

    expect(head.meta[0]).toEqual({ title: "Overview — ScoreCheck" });
    expect(head.meta.find((m) => m.property === "og:title")?.content).toBe("Overview — ScoreCheck");
  });
});

describe("loading", () => {
  it("shows a spinner", () => {
    get.mockReturnValue(new Promise(() => {}));

    const { container } = render(<Dashboard />);

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("fetches the dashboard summary", async () => {
    await renderLoaded();

    expect(get).toHaveBeenCalledWith("/api/analytics/dashboard");
  });
});

describe("the headline metrics", () => {
  it("shows the totals", async () => {
    await renderLoaded();

    expect(metric("Games tracked")).toBe("38");
    expect(metric("Distinct players")).toBe("12");
    expect(metric("Teams")).toBe("76");
  });

  it("rounds the combined average to one decimal", async () => {
    await renderLoaded();

    expect(metric("Avg combined PPG")).toBe("101.3");
  });

  it("shows a dash when the average is absent", async () => {
    resolves(dashboard({ avgPointsTeamAAndB: null }));

    await renderLoaded();

    // toFixed on null would throw; a fresh squad has no games to average.
    expect(metric("Avg combined PPG")).toBe("—");
  });

  it("shows zeros rather than blanks for a partial response", async () => {
    resolves({});

    await renderLoaded();

    expect(metric("Games tracked")).toBe("0");
    expect(metric("Distinct players")).toBe("0");
  });

  it("reports a failed request instead of an all-zero dashboard", async () => {
    get.mockRejectedValue(new Error("Failed to fetch dashboard"));

    await renderLoaded();

    // A dashboard reading 0 games / 0 players looks like a brand-new league, not an outage.
    expect(screen.getByText("Failed to fetch dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("metric-Games tracked")).not.toBeInTheDocument();
  });
});

describe("recent games", () => {
  it("prompts an upload when there are none", async () => {
    resolves(dashboard({ recentGames: [] }));

    await renderLoaded();

    expect(screen.getByText(/No games yet — upload a screenshot/)).toBeInTheDocument();
  });

  it("shows the matchup, scores and date", async () => {
    await renderLoaded();
    const card = within(screen.getByRole("region", { name: "Recent games" }));

    expect(card.getByText("Akif (PG)")).toBeInTheDocument();
    expect(card.getByText("102")).toBeInTheDocument();
    expect(card.getByText("98")).toBeInTheDocument();
    expect(card.getByText("Jul 29, 2026")).toBeInTheDocument();
  });

  it("caps the list at five", async () => {
    resolves(
      dashboard({
        recentGames: Array.from({ length: 8 }, (_, i) => game({ id: `g${i}` })),
      }),
    );

    await renderLoaded();
    const card = within(screen.getByRole("region", { name: "Recent games" }));

    // The card's hint says "Last five box scores", so the server returning more must not
    // make it disagree with itself.
    expect(card.getAllByRole("listitem")).toHaveLength(5);
  });

  it("names the home side as winner when it scored more", async () => {
    await renderLoaded();

    expect(screen.getByTestId("badge")).toHaveTextContent("Akif (PG) won");
  });

  it("names the away side as winner when it scored more", async () => {
    resolves(dashboard({ recentGames: [game({ homeScore: 90, awayScore: 110 })] }));

    await renderLoaded();

    expect(screen.getByTestId("badge")).toHaveTextContent("Team B won");
  });

  it("awards a tie to the home side, matching the games list and detail page", async () => {
    resolves(dashboard({ recentGames: [game({ homeScore: 99, awayScore: 99 })] }));

    await renderLoaded();

    // Was `>` here and `>=` on the other two screens, so one tied game was credited to
    // opposite sides depending on which page you looked at.
    expect(screen.getByTestId("badge")).toHaveTextContent("Akif (PG) won");
  });

  it("links through to the full list", async () => {
    await renderLoaded();
    const card = within(screen.getByRole("region", { name: "Recent games" }));

    expect(card.getByText("All games →")).toHaveAttribute("href", "/games");
  });
});

describe("scoring leaders", () => {
  it("says so when there is no data", async () => {
    resolves(dashboard({ topPerformers: { points: [], rebounds: [], assists: [] } }));

    await renderLoaded();

    expect(screen.getByText("No data yet.")).toBeInTheDocument();
  });

  it("survives topPerformers being absent entirely", async () => {
    resolves(dashboard({ topPerformers: undefined }));

    await renderLoaded();

    expect(screen.getByText("No data yet.")).toBeInTheDocument();
  });

  it("ranks each leader with their average", async () => {
    await renderLoaded();
    const card = within(screen.getByRole("region", { name: "Scoring leaders" }));

    expect(card.getByText("01")).toBeInTheDocument();
    expect(card.getByText("Akif")).toBeInTheDocument();
    expect(card.getByText("24.4")).toBeInTheDocument();
  });

  it("caps the leaderboard at five", async () => {
    resolves(
      dashboard({
        topPerformers: {
          points: Array.from({ length: 9 }, (_, i) => leader({ playerName: `P${i}` })),
          rebounds: [],
          assists: [],
        },
      }),
    );

    await renderLoaded();
    const card = within(screen.getByRole("region", { name: "Scoring leaders" }));

    expect(card.getAllByRole("listitem")).toHaveLength(5);
  });
});

describe("the page actions", () => {
  it("offers analytics and upload", async () => {
    await renderLoaded();
    const actions = within(screen.getByTestId("actions"));

    expect(actions.getByText("Analytics")).toHaveAttribute("href", "/analytics");
    expect(actions.getByText("Upload box score")).toHaveAttribute("href", "/upload");
  });
});

describe("the pipeline explainer", () => {
  it("walks through all five steps", async () => {
    await renderLoaded();
    const card = within(screen.getByRole("region", { name: "Upload pipeline" }));

    expect(card.getAllByRole("listitem")).toHaveLength(5);
    for (const step of ["Screenshot", "Junk filter", "Review & edit", "Save"]) {
      expect(card.getByText(step)).toBeInTheDocument();
    }
  });

  it("describes the pipeline the app actually runs", async () => {
    await renderLoaded();
    const card = within(screen.getByRole("region", { name: "Upload pipeline" }));

    // Extraction is a fine-tuned vision model that team-splits the screenshot; the card used
    // to advertise "GCV extract · 4-pass · 120 regions", which has not been true for a while.
    expect(card.getByText("Fine-tuned extract")).toBeInTheDocument();
    expect(card.queryByText("GCV extract")).not.toBeInTheDocument();
  });
});
