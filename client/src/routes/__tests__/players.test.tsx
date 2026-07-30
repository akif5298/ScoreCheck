/**
 * The players table — season averages, client-sorted.
 *
 * A failed fetch used to be swallowed outright, making a broken analytics endpoint look like
 * an empty league — the page told the user to upload a box score. It now reports the failure,
 * matching what the standings page next to it already did.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => (
    <div>
      <div data-testid="actions">{actions}</div>
      {children}
    </div>
  ),
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Badge: ({ children }: { children: ReactNode }) => <span data-testid="badge">{children}</span>,
}));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

import { Route } from "@/routes/players";
import { api } from "@/lib/api";

const PlayersPage = (Route as unknown as { component: () => ReactNode }).component;
const get = vi.mocked(api.get);

function stat(over: Record<string, unknown> = {}) {
  return {
    playerName: "Akif",
    team: "Akif (PG) + AI (SG)",
    gamesPlayed: 12,
    avgPoints: 24.44,
    avgRebounds: 6.25,
    avgAssists: 5.19,
    avgFgPercentage: 52.36,
    avgThreePercentage: 38.91,
    ...over,
  };
}

function resolves(stats: Record<string, unknown>[], success = true) {
  get.mockResolvedValue({ success, data: { stats } });
}

async function renderLoaded() {
  const result = render(<PlayersPage />);
  await waitFor(() => expect(result.container.querySelector(".animate-spin")).toBeNull());
  return result;
}

/**
 * The player names in display order. Read from the name span rather than the cell, because
 * the cell also contains the initials avatar and textContent would return "HHigh".
 */
function playerOrder(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((tr) => tr.querySelectorAll("td")[1]?.querySelector("span")?.textContent?.trim() ?? "");
}

beforeEach(() => {
  get.mockReset();
  resolves([stat()]);
});

describe("the route definition", () => {
  it("sets a title and description", () => {
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();

    expect(head.meta[0]).toEqual({ title: "Players — ScoreCheck" });
  });
});

describe("loading and empty states", () => {
  it("shows a spinner while loading", () => {
    get.mockReturnValue(new Promise(() => {}));

    const { container } = render(<PlayersPage />);

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("prompts an upload when there is nothing to show", async () => {
    resolves([]);

    await renderLoaded();

    expect(screen.getByText(/No player data yet/)).toBeInTheDocument();
  });

  it("reports a failed request instead of showing the empty state", async () => {
    get.mockRejectedValue(new Error("Failed to fetch player stats"));

    await renderLoaded();

    // "Upload a box score to populate stats" is actively misleading when the endpoint is
    // down — the user has already uploaded, and doing it again will not help.
    expect(screen.getByText("Failed to fetch player stats")).toBeInTheDocument();
    expect(screen.queryByText(/No player data yet/)).not.toBeInTheDocument();
  });

  it("renders no table when the request failed", async () => {
    get.mockRejectedValue(new Error("boom"));

    await renderLoaded();

    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("still shows the empty state for a successful but empty response", async () => {
    resolves([]);

    await renderLoaded();

    // The two cases are now distinguishable, which is the whole point.
    expect(screen.getByText(/No player data yet/)).toBeInTheDocument();
  });

  it("shows the empty state for an unsuccessful response", async () => {
    resolves([stat()], false);

    await renderLoaded();

    expect(screen.getByText(/No player data yet/)).toBeInTheDocument();
  });
});

describe("the table", () => {
  it("shows each player's averages", async () => {
    await renderLoaded();

    const row = screen.getByText("Akif").closest("tr") as HTMLElement;
    expect(within(row).getByText("12")).toBeInTheDocument();
    expect(within(row).getByText("24.4")).toBeInTheDocument();
    expect(within(row).getByText("6.3")).toBeInTheDocument();
    expect(within(row).getByText("5.2")).toBeInTheDocument();
  });

  it("rounds averages to one decimal", async () => {
    await renderLoaded();

    // Raw values carry float noise from the aggregate query; 24.44 → 24.4, 6.25 → 6.3.
    expect(screen.getByText("24.4")).toBeInTheDocument();
    expect(screen.queryByText("24.44")).not.toBeInTheDocument();
  });

  it("treats a null average as zero", async () => {
    resolves([
      stat({
        avgPoints: null,
        avgRebounds: null,
        avgAssists: null,
        avgFgPercentage: null,
        avgThreePercentage: null,
      }),
    ]);

    await renderLoaded();

    // A player with no games yet comes back with nulls; toFixed on null would throw.
    const row = screen.getByText("Akif").closest("tr") as HTMLElement;
    expect(within(row).getAllByText("0").length).toBeGreaterThan(0);
  });

  it("shows the team a player is on", async () => {
    await renderLoaded();

    expect(screen.getByText("Akif (PG) + AI (SG)")).toBeInTheDocument();
  });

  it("numbers the rows with a leading zero", async () => {
    await renderLoaded();

    expect(screen.getByText("01")).toBeInTheDocument();
  });

  it("builds initials from the display name", async () => {
    resolves([stat({ playerName: "Akif Rahman" })]);

    await renderLoaded();

    expect(screen.getByText("AR")).toBeInTheDocument();
  });

  it("highlights a field-goal percentage at or above 50", async () => {
    await renderLoaded();

    expect(screen.getByTestId("badge")).toHaveTextContent("52.4%");
  });

  it("leaves a sub-50 percentage unhighlighted", async () => {
    resolves([stat({ avgFgPercentage: 49.9 })]);

    await renderLoaded();

    expect(screen.queryByTestId("badge")).not.toBeInTheDocument();
    expect(screen.getByText("49.9%")).toBeInTheDocument();
  });

  it("highlights exactly 50 as good", async () => {
    resolves([stat({ avgFgPercentage: 50 })]);

    await renderLoaded();

    // The boundary is inclusive; 50% is a respectable clip, not a miss.
    expect(screen.getByTestId("badge")).toHaveTextContent("50%");
  });

  it("labels every column", async () => {
    await renderLoaded();
    // Scoped to the table: "FG%" is also the label on one of the sort buttons.
    const head = within(screen.getByRole("table"));

    for (const header of ["Player", "Team", "GP", "PPG", "RPG", "APG", "FG%", "3P%"]) {
      expect(head.getByText(header)).toBeInTheDocument();
    }
  });
});

describe("sorting", () => {
  const three = [
    stat({ playerName: "Low", avgPoints: 8, avgRebounds: 12, avgAssists: 2, avgFgPercentage: 61 }),
    stat({ playerName: "High", avgPoints: 30, avgRebounds: 3, avgAssists: 4, avgFgPercentage: 44 }),
    stat({ playerName: "Mid", avgPoints: 19, avgRebounds: 7, avgAssists: 9, avgFgPercentage: 50 }),
  ];

  beforeEach(() => {
    resolves(three);
  });

  it("sorts by points per game out of the box", async () => {
    await renderLoaded();

    expect(playerOrder()).toEqual(["High", "Mid", "Low"]);
  });

  it.each([
    ["rpg", ["Low", "Mid", "High"]],
    ["apg", ["Mid", "High", "Low"]],
    ["FG%", ["Low", "Mid", "High"]],
  ])("re-sorts by %s", async (label, expected) => {
    await renderLoaded();

    await userEvent.click(
      within(screen.getByTestId("actions")).getByRole("button", { name: label }),
    );

    expect(playerOrder()).toEqual(expected);
  });

  it("marks the active sort", async () => {
    await renderLoaded();
    const actions = within(screen.getByTestId("actions"));

    expect(actions.getByRole("button", { name: "ppg" }).className).toContain("bg-primary");

    await userEvent.click(actions.getByRole("button", { name: "rpg" }));

    expect(actions.getByRole("button", { name: "rpg" }).className).toContain("bg-primary");
    expect(actions.getByRole("button", { name: "ppg" }).className).not.toContain("bg-primary");
  });

  it("does not mutate the fetched order", async () => {
    await renderLoaded();
    const actions = within(screen.getByTestId("actions"));

    await userEvent.click(actions.getByRole("button", { name: "rpg" }));
    await userEvent.click(actions.getByRole("button", { name: "ppg" }));

    // The sort copies before sorting; sorting in place would make the order depend on
    // whichever buttons had been pressed before.
    expect(playerOrder()).toEqual(["High", "Mid", "Low"]);
  });
});
