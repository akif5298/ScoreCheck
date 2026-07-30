/**
 * The analytics page — two charts and a team-totals grid off one dashboard response.
 *
 * The chart inputs are derived, not passed through, so the transforms are what these tests
 * pin: the score trend is reversed into chronological order (the API returns newest first,
 * and a trend line drawn backwards tells the opposite story), and the leaders bar chart is
 * capped and rounded.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Card: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
  Metric: ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
    <div data-testid={`metric-${label}`}>
      <span data-testid="value">{value}</span>
      <span data-testid="hint">{hint}</span>
    </div>
  ),
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

// recharts needs a measured container, which jsdom never provides. The stubs expose the data
// each chart was handed, which is the part this page actually computes.
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  LineChart: ({ data, children }: { data: unknown[]; children: ReactNode }) => (
    <div data-testid="line-chart" data-series={JSON.stringify(data)}>
      {children}
    </div>
  ),
  BarChart: ({ data, children }: { data: unknown[]; children: ReactNode }) => (
    <div data-testid="bar-chart" data-series={JSON.stringify(data)}>
      {children}
    </div>
  ),
  Line: ({ dataKey }: { dataKey: string }) => <div data-testid={`line-${dataKey}`} />,
  Bar: ({ children }: { children: ReactNode }) => <div data-testid="bar">{children}</div>,
  Cell: ({ fill }: { fill: string }) => <div data-testid="cell" data-fill={fill} />,
  CartesianGrid: () => <div />,
  Tooltip: () => <div />,
  XAxis: ({ dataKey }: { dataKey: string }) => <div data-testid={`x-${dataKey}`} />,
  YAxis: () => <div />,
}));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

import { Route } from "@/routes/analytics";
import { api } from "@/lib/api";

const Analytics = (Route as unknown as { component: () => ReactNode }).component;
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

function playerStat(over: Record<string, unknown> = {}) {
  return {
    playerName: "Akif",
    avgPoints: 24.44,
    avgRebounds: 6.2,
    avgAssists: 5.1,
    avgFgPercentage: 52.3,
    avgThreePercentage: 38.91,
    gamesPlayed: 12,
    team: "Akif (PG)",
    ...over,
  };
}

function teamStat(over: Record<string, unknown> = {}) {
  return {
    name: "Akif (PG) + AI (SG)",
    gamesPlayed: 10,
    wins: 7,
    losses: 3,
    totalPoints: 1024,
    totalRebounds: 412,
    totalAssists: 268,
    avgPoints: 102.4,
    ...over,
  };
}

function dashboard(over: Record<string, unknown> = {}) {
  return {
    totalGames: 38,
    totalPlayers: 12,
    totalTeams: 76,
    avgPointsTeamAAndB: 101.27,
    recentGames: [game()],
    topPerformers: { points: [{ playerName: "Akif", avgPoints: 24.44, team: "Akif (PG)" }] },
    playerStats: [playerStat()],
    teamStats: [teamStat()],
    ...over,
  };
}

function resolves(data: unknown = dashboard(), success = true) {
  get.mockResolvedValue({ success, data });
}

async function renderLoaded() {
  const result = render(<Analytics />);
  await waitFor(() => expect(result.container.querySelector(".animate-spin")).toBeNull());
  return result;
}

function metric(label: string) {
  const el = screen.getByTestId(`metric-${label}`);
  return {
    value: within(el).getByTestId("value").textContent,
    hint: within(el).getByTestId("hint").textContent,
  };
}

/** The data array a chart stub was handed. */
function series(testId: string): Record<string, unknown>[] {
  return JSON.parse(screen.getByTestId(testId).getAttribute("data-series") ?? "[]");
}

beforeEach(() => {
  get.mockReset();
  resolves();
});

describe("the route definition", () => {
  it("sets a title and description", () => {
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();

    expect(head.meta[0]).toEqual({ title: "Analytics — ScoreCheck" });
  });
});

describe("loading", () => {
  it("shows a spinner", () => {
    get.mockReturnValue(new Promise(() => {}));

    const { container } = render(<Analytics />);

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("reads from the dashboard endpoint", async () => {
    await renderLoaded();

    expect(get).toHaveBeenCalledWith("/api/analytics/dashboard");
  });
});

describe("the headline metrics", () => {
  it("shows the games total and top scorer", async () => {
    await renderLoaded();

    expect(metric("Games tracked").value).toBe("38");
    expect(metric("Top scorer")).toEqual({ value: "24.4", hint: "Akif · ppg" });
  });

  it("picks out the best three-point percentage across players", async () => {
    resolves(
      dashboard({
        playerStats: [
          playerStat({ playerName: "A", avgThreePercentage: 31.2 }),
          playerStat({ playerName: "B", avgThreePercentage: 44.8 }),
        ],
      }),
    );

    await renderLoaded();

    expect(metric("Best 3P%").value).toBe("44.8%");
  });

  it("treats a null three-point percentage as zero rather than NaN", async () => {
    resolves(dashboard({ playerStats: [playerStat({ avgThreePercentage: null })] }));

    await renderLoaded();

    // Math.max over an array containing null would give NaN and render "NaN%".
    expect(metric("Best 3P%").value).toBe("0.0%");
  });

  it("shows dashes when there is nothing to summarise", async () => {
    resolves(
      dashboard({ playerStats: [], topPerformers: { points: [] }, avgPointsTeamAAndB: null }),
    );

    await renderLoaded();

    expect(metric("Top scorer").value).toBe("—");
    expect(metric("Best 3P%").value).toBe("—");
    expect(metric("Avg combined PPG").value).toBe("—");
  });

  it("reports a failed request instead of empty charts", async () => {
    get.mockRejectedValue(new Error("Failed to fetch analytics"));

    await renderLoaded();

    // Empty charts read as "no games played yet" — the opposite of "we could not load this".
    expect(screen.getByText("Failed to fetch analytics")).toBeInTheDocument();
    expect(screen.queryByTestId("metric-Games tracked")).not.toBeInTheDocument();
  });
});

describe("the score trend", () => {
  it("plots home and away as separate lines", async () => {
    await renderLoaded();

    expect(screen.getByTestId("line-home")).toBeInTheDocument();
    expect(screen.getByTestId("line-away")).toBeInTheDocument();
  });

  it("reverses the API order so time runs left to right", async () => {
    resolves(
      dashboard({
        recentGames: [
          game({ id: "newest", createdAt: "2026-07-29T00:00:00.000Z", homeScore: 3 }),
          game({ id: "oldest", createdAt: "2026-07-01T00:00:00.000Z", homeScore: 1 }),
        ],
      }),
    );

    await renderLoaded();

    // The endpoint returns newest first; drawing that straight would run the trend backwards.
    expect(series("line-chart").map((d) => d.home)).toEqual([1, 3]);
  });

  it("labels each point with a short date", async () => {
    await renderLoaded();

    // No year on the trend axis — it would not fit and every point shares it anyway.
    expect(series("line-chart")[0]).toMatchObject({ date: "Jul 29", home: 102, away: 98 });
  });

  it("says so when there are no games", async () => {
    resolves(dashboard({ recentGames: [] }));

    await renderLoaded();

    expect(screen.getByText("No games yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("line-chart")).not.toBeInTheDocument();
  });

  it("does not mutate the fetched games while reversing", async () => {
    resolves(
      dashboard({
        recentGames: [game({ id: "a", homeScore: 1 }), game({ id: "b", homeScore: 2 })],
      }),
    );

    await renderLoaded();

    // The reverse is preceded by slice(); reversing in place would flip the "Recent games"
    // ordering used elsewhere off the same object.
    expect(series("line-chart").map((d) => d.home)).toEqual([2, 1]);
  });
});

describe("the scoring-leaders chart", () => {
  it("rounds each average to one decimal", async () => {
    await renderLoaded();

    expect(series("bar-chart")).toEqual([{ player: "Akif", ppg: 24.4 }]);
  });

  it("caps the chart at eight players", async () => {
    resolves(
      dashboard({
        topPerformers: {
          points: Array.from({ length: 12 }, (_, i) => ({
            playerName: `P${i}`,
            avgPoints: 20 - i,
            team: "T",
          })),
        },
      }),
    );

    await renderLoaded();

    // Beyond eight the angled x-axis labels overlap into an unreadable smear.
    expect(series("bar-chart")).toHaveLength(8);
  });

  it("highlights the leading bar only", async () => {
    resolves(
      dashboard({
        topPerformers: {
          points: [
            { playerName: "A", avgPoints: 30, team: "T" },
            { playerName: "B", avgPoints: 20, team: "T" },
          ],
        },
      }),
    );

    await renderLoaded();
    const fills = screen.getAllByTestId("cell").map((c) => c.getAttribute("data-fill"));

    expect(fills[0]).toBe("var(--color-primary)");
    expect(fills[1]).toBe("var(--color-chart-2)");
  });

  it("says so when there is no data", async () => {
    resolves(dashboard({ topPerformers: { points: [] } }));

    await renderLoaded();

    expect(screen.getByText("No data yet.")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-chart")).not.toBeInTheDocument();
  });

  it("survives topPerformers being absent", async () => {
    resolves(dashboard({ topPerformers: undefined }));

    await renderLoaded();

    expect(screen.getByText("No data yet.")).toBeInTheDocument();
  });
});

describe("the team totals grid", () => {
  it("shows each lineup's record and cumulative stats", async () => {
    await renderLoaded();
    const card = within(screen.getByRole("region", { name: "Team totals" }));

    expect(card.getByText("Akif (PG) + AI (SG)")).toBeInTheDocument();
    expect(card.getByText("7W–3L")).toBeInTheDocument();
    expect(card.getByText("1024")).toBeInTheDocument();
    expect(card.getByText("412")).toBeInTheDocument();
    expect(card.getByText("268")).toBeInTheDocument();
  });

  it("labels the three stat columns", async () => {
    await renderLoaded();
    const card = within(screen.getByRole("region", { name: "Team totals" }));

    expect(card.getByText("PTS")).toBeInTheDocument();
    expect(card.getByText("REB")).toBeInTheDocument();
    expect(card.getByText("AST")).toBeInTheDocument();
  });

  it("shows zero for a missing total", async () => {
    resolves(dashboard({ teamStats: [teamStat({ totalRebounds: null })] }));

    await renderLoaded();
    const card = within(screen.getByRole("region", { name: "Team totals" }));

    expect(card.getByText("0")).toBeInTheDocument();
  });

  it("says so when there is no team data", async () => {
    resolves(dashboard({ teamStats: [] }));

    await renderLoaded();

    expect(screen.getByText("No team data yet.")).toBeInTheDocument();
  });
});
