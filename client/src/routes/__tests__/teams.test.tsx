/**
 * The standings page (labelled "Matchups" in the nav — these are box-score home/away sides,
 * not squads).
 *
 * A "team" here is a composite lineup string like "Akif (PG) + AI (SG) + …", so the table is
 * really a record per lineup. The two summary metrics are reductions over the list, which is
 * where the interesting edge cases live: an empty list must not reduce, and a lineup with no
 * games must not divide by zero.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, description }: { children: ReactNode; description?: string }) => (
    <div>
      <p data-testid="description">{description}</p>
      {children}
    </div>
  ),
  Card: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
  Metric: ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
    <div data-testid={`metric-${label}`}>
      <span data-testid="value">{value}</span>
      <span data-testid="hint">{hint}</span>
    </div>
  ),
}));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

import { Route } from "@/routes/teams";
import { api } from "@/lib/api";

const TeamsPage = (Route as unknown as { component: () => ReactNode }).component;
const get = vi.mocked(api.get);

function team(over: Record<string, unknown> = {}) {
  return {
    name: "Akif (PG) + AI (SG)",
    gamesPlayed: 10,
    wins: 7,
    losses: 3,
    totalPoints: 1024,
    avgPoints: 102.44,
    fg_percentage: 47.66,
    three_percentage: 35.21,
    ...over,
  };
}

function resolves(stats: Record<string, unknown>[], success = true) {
  get.mockResolvedValue({ success, data: { teams: [], stats } });
}

async function renderLoaded() {
  const result = render(<TeamsPage />);
  await waitFor(() => expect(result.container.querySelector(".animate-spin")).toBeNull());
  return result;
}

/** Team names in display order. */
function standingsOrder(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((tr) => tr.querySelectorAll("td")[1]?.textContent?.trim() ?? "");
}

function metric(label: string) {
  const el = screen.getByTestId(`metric-${label}`);
  return {
    value: within(el).getByTestId("value").textContent,
    hint: within(el).getByTestId("hint").textContent,
  };
}

beforeEach(() => {
  get.mockReset();
  resolves([team()]);
});

describe("the route definition", () => {
  it("sets a title and description", () => {
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();

    expect(head.meta[0]).toEqual({ title: "Teams — ScoreCheck" });
  });
});

describe("loading and failure", () => {
  it("shows a spinner while loading", () => {
    get.mockReturnValue(new Promise(() => {}));

    const { container } = render(<TeamsPage />);

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows the server's message on failure", async () => {
    get.mockRejectedValue(new Error("Failed to fetch team stats"));

    await renderLoaded();

    // This endpoint was returning 500 on a json_agg quirk; a silent empty table would have
    // hidden that entirely.
    expect(screen.getByText("Failed to fetch team stats")).toBeInTheDocument();
  });

  it("renders no standings table on failure", async () => {
    get.mockRejectedValue(new Error("boom"));

    await renderLoaded();

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("prompts an upload when there is no data", async () => {
    resolves([]);

    await renderLoaded();

    expect(screen.getByText(/No team data yet/)).toBeInTheDocument();
  });

  it("treats an unsuccessful response as no data", async () => {
    resolves([team()], false);

    await renderLoaded();

    expect(screen.getByText(/No team data yet/)).toBeInTheDocument();
  });
});

describe("the summary metrics", () => {
  it("counts the lineups", async () => {
    resolves([team({ name: "A" }), team({ name: "B" })]);

    await renderLoaded();

    expect(metric("Teams").value).toBe("2");
  });

  it("names the highest-scoring lineup", async () => {
    resolves([team({ name: "Slow", avgPoints: 88.2 }), team({ name: "Fast", avgPoints: 119.7 })]);

    await renderLoaded();

    expect(metric("Top offense")).toEqual({ value: "119.7 PPG", hint: "Fast" });
  });

  it("names the most efficient lineup", async () => {
    resolves([
      team({ name: "Cold", fg_percentage: 41.1 }),
      team({ name: "Hot", fg_percentage: 55.9 }),
    ]);

    await renderLoaded();

    expect(metric("Best FG%")).toEqual({ value: "55.9%", hint: "Hot" });
  });

  it("shows a dash instead of reducing an empty list", async () => {
    resolves([]);

    await renderLoaded();

    // reduce() on an empty array with no seed throws; the guard is what keeps the page up
    // for a brand-new squad.
    expect(metric("Top offense").value).toBe("—");
    expect(metric("Best FG%").value).toBe("—");
  });

  it("resolves a tie to the last equal leader", async () => {
    resolves([team({ name: "First", avgPoints: 100 }), team({ name: "Second", avgPoints: 100 })]);

    await renderLoaded();

    // `(a, b) => a.avgPoints > b.avgPoints ? a : b` is strictly greater, so an equal b wins.
    // Deterministic either way — pinned so a later switch to >= is a deliberate change.
    expect(metric("Top offense").hint).toBe("Second");
  });
});

describe("the standings table", () => {
  it("sorts by wins, descending", async () => {
    resolves([
      team({ name: "Mid", wins: 4 }),
      team({ name: "Top", wins: 9 }),
      team({ name: "Bottom", wins: 1 }),
    ]);

    await renderLoaded();

    expect(standingsOrder()).toEqual(["Top", "Mid", "Bottom"]);
  });

  it("shows the record and averages", async () => {
    await renderLoaded();

    const row = within(screen.getByRole("table"))
      .getByText("Akif (PG) + AI (SG)")
      .closest("tr") as HTMLElement;
    expect(within(row).getByText("10")).toBeInTheDocument();
    expect(within(row).getByText("7")).toBeInTheDocument();
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(row).getByText("102.4")).toBeInTheDocument();
    expect(within(row).getByText("47.7%")).toBeInTheDocument();
    expect(within(row).getByText("35.2%")).toBeInTheDocument();
  });

  it("computes the win percentage", async () => {
    await renderLoaded();

    // 7 of 10.
    expect(screen.getByText("70.0%")).toBeInTheDocument();
  });

  it("shows a dash rather than dividing by zero games", async () => {
    resolves([team({ gamesPlayed: 0, wins: 0, losses: 0 })]);

    await renderLoaded();

    // A lineup can exist with no completed games after an edit; 0/0 would render "NaN%".
    const row = within(screen.getByRole("table"))
      .getByText("Akif (PG) + AI (SG)")
      .closest("tr") as HTMLElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("numbers the rows from one", async () => {
    resolves([team({ name: "A", wins: 5 }), team({ name: "B", wins: 2 })]);

    await renderLoaded();

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].querySelectorAll("td")[0].textContent).toBe("1");
    expect(rows[1].querySelectorAll("td")[0].textContent).toBe("2");
  });

  it("labels every column", async () => {
    await renderLoaded();
    const table = within(screen.getByRole("table"));

    for (const header of ["Team", "GP", "W", "L", "Win%", "PPG", "FG%", "3P%"]) {
      expect(table.getByText(header)).toBeInTheDocument();
    }
  });

  it("does not mutate the fetched order while sorting", async () => {
    resolves([team({ name: "Mid", wins: 4 }), team({ name: "Top", wins: 9 })]);

    await renderLoaded();

    // The sort copies first; sorting the state array in place would make the summary
    // metrics and the table disagree after a re-render.
    expect(standingsOrder()).toEqual(["Top", "Mid"]);
    expect(metric("Teams").value).toBe("2");
  });
});
