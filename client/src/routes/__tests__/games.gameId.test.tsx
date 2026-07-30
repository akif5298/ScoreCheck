/**
 * The game detail page.
 *
 * Its box-score tables are built by filtering players on `p.team === game.homeTeam` — the
 * same exact-string-equality invariant lineupEfficiency joins on server-side. When those
 * strings drift apart the page renders a score banner with no tables underneath and no
 * error, which is the quietest possible symptom of a real data problem.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useParams: () => ({ gameId }),
  }),
  Link: ({ to, children }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({
    children,
    title,
    eyebrow,
    description,
    actions,
  }: {
    children: ReactNode;
    title: string;
    eyebrow?: string;
    description?: string;
    actions?: ReactNode;
  }) => (
    <div>
      <p data-testid="eyebrow">{eyebrow}</p>
      <h1>{title}</h1>
      <p data-testid="description">{description}</p>
      <div>{actions}</div>
      {children}
    </div>
  ),
  Card: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section aria-label={title}>
      {title && <h2>{title}</h2>}
      {children}
    </section>
  ),
}));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

let gameId = "g1";

import { Route } from "@/routes/games.$gameId";
import { api } from "@/lib/api";

const GameDetailPage = (Route as unknown as { component: () => ReactNode }).component;
const get = vi.mocked(api.get);

const HOME = "Akif (PG) + AI (SG)";
const AWAY = "Team B";

function playerRow(over: Record<string, unknown> = {}) {
  return {
    name: "Akif",
    team: HOME,
    points: 24,
    rebounds: 6,
    assists: 5,
    steals: 2,
    blocks: 1,
    turnovers: 3,
    fouls: 2,
    fgMade: 9,
    fgAttempted: 17,
    threeMade: 3,
    threeAttempted: 7,
    ftMade: 3,
    ftAttempted: 4,
    ...over,
  };
}

function detail(over: Record<string, unknown> = {}) {
  return {
    id: "g1",
    date: "2026-07-29T00:00:00.000Z",
    homeTeam: HOME,
    awayTeam: AWAY,
    homeScore: 102,
    awayScore: 98,
    players: [
      playerRow(),
      playerRow({ name: "AI", points: 12, fgMade: 5, fgAttempted: 11, rebounds: 4, assists: 1 }),
      playerRow({
        name: "Opp",
        team: AWAY,
        points: 30,
        fgMade: 10,
        fgAttempted: 20,
        rebounds: 8,
        assists: 3,
      }),
    ],
    ...over,
  };
}

function resolves(data: Record<string, unknown> = detail(), success = true) {
  get.mockResolvedValue({ success, data });
}

async function renderLoaded() {
  const result = render(<GameDetailPage />);
  await waitFor(() => expect(get).toHaveBeenCalled());
  return result;
}

beforeEach(() => {
  gameId = "g1";
  get.mockReset();
  resolves();
});

describe("the route definition", () => {
  it("sets a page title", () => {
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();

    expect(head.meta[0]).toEqual({ title: "Game detail — ScoreCheck" });
  });
});

describe("fetching", () => {
  it("requests the game in the URL", async () => {
    gameId = "abc123";

    await renderLoaded();

    expect(get).toHaveBeenCalledWith("/api/screenshots/games/abc123");
  });

  it("shows a spinner while it loads", () => {
    get.mockReturnValue(new Promise(() => {}));

    const { container } = render(<GameDetailPage />);

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows the server's message on failure", async () => {
    get.mockRejectedValue(new Error("Game not found"));

    await renderLoaded();

    expect(await screen.findByText("Game not found")).toBeInTheDocument();
  });

  it("treats an unsuccessful response as not found", async () => {
    resolves(detail(), false);

    await renderLoaded();

    // A 200 with success:false is how a foreign-squad game is reported, so it must not
    // render an empty page.
    expect(await screen.findByText("Game not found.")).toBeInTheDocument();
  });

  it("offers a way back to the list on failure", async () => {
    get.mockRejectedValue(new Error("boom"));

    await renderLoaded();

    expect(await screen.findByText("← Games")).toHaveAttribute("href", "/games");
  });
});

describe("the header", () => {
  it("titles the page with the matchup", async () => {
    await renderLoaded();

    expect(
      await screen.findByRole("heading", { level: 1, name: `${HOME} vs ${AWAY}` }),
    ).toBeInTheDocument();
  });

  it("uses the game date as the eyebrow", async () => {
    await renderLoaded();

    await waitFor(() => expect(screen.getByTestId("eyebrow")).toHaveTextContent("Jul 29, 2026"));
  });

  it("falls back to a generic eyebrow when the game has no date", async () => {
    resolves(detail({ date: "" }));

    await renderLoaded();

    await waitFor(() => expect(screen.getByTestId("eyebrow")).toHaveTextContent("Game detail"));
  });

  it("summarises the final score", async () => {
    await renderLoaded();

    await waitFor(() =>
      expect(screen.getByTestId("description")).toHaveTextContent(
        `Final · ${HOME} 102 — ${AWAY} 98`,
      ),
    );
  });

  it("links back to the list", async () => {
    await renderLoaded();

    expect(await screen.findByText("← Games")).toHaveAttribute("href", "/games");
  });
});

describe("the score banner", () => {
  it("names the higher-scoring side as the winner", async () => {
    await renderLoaded();

    await screen.findByText("Winner");
    expect(screen.getAllByText(HOME).length).toBeGreaterThan(0);
  });

  it("names the away side when it scored more", async () => {
    resolves(detail({ homeScore: 90, awayScore: 110 }));

    await renderLoaded();

    await screen.findByText("Winner");
    // Two occurrences: the away panel heading and the winner panel.
    expect(screen.getAllByText(AWAY).length).toBeGreaterThan(1);
  });

  it("computes each side's field-goal percentage", async () => {
    await renderLoaded();

    // Home: (9+5)/(17+11) = 50.0%; away: 10/20 = 50.0%.
    expect((await screen.findAllByText(/FG 50\.0%/)).length).toBe(2);
  });

  it("shows a dash rather than NaN when a side took no shots", async () => {
    resolves(
      detail({
        players: [
          playerRow({ fgMade: 0, fgAttempted: 0 }),
          playerRow({ team: AWAY, fgMade: 0, fgAttempted: 0 }),
        ],
      }),
    );

    await renderLoaded();

    // 0/0 is NaN%, which would render as "NaN%" on a real game with a blank box score.
    expect((await screen.findAllByText(/FG —/)).length).toBe(2);
  });

  it("sums rebounds and assists per side", async () => {
    await renderLoaded();

    // Home: 6+4 REB, 5+1 AST.
    expect(await screen.findByText(/10 REB · 6 AST/)).toBeInTheDocument();
    expect(screen.getByText(/8 REB · 3 AST/)).toBeInTheDocument();
  });

  it("treats missing rebound and assist values as zero", async () => {
    resolves(
      detail({
        players: [
          playerRow({ rebounds: null, assists: null }),
          playerRow({ team: AWAY, rebounds: null, assists: null }),
        ],
      }),
    );

    await renderLoaded();

    expect((await screen.findAllByText(/0 REB · 0 AST/)).length).toBe(2);
  });
});

describe("the box score tables", () => {
  it("renders one table per side", async () => {
    await renderLoaded();

    expect(await screen.findByRole("heading", { level: 2, name: HOME })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: AWAY })).toBeInTheDocument();
  });

  it("puts each player under the side their team string matches", async () => {
    await renderLoaded();

    const homeTable = await screen.findByRole("region", { name: HOME });
    expect(within(homeTable).getByText("Akif")).toBeInTheDocument();
    expect(within(homeTable).queryByText("Opp")).not.toBeInTheDocument();
  });

  it("drops a player whose team string matches neither side", async () => {
    resolves(
      detail({
        players: [playerRow(), playerRow({ name: "Orphan", team: "Akif (PG) + AI (SG) " })],
      }),
    );

    await renderLoaded();

    // One trailing space is enough. The same equality drives lineupEfficiency's join
    // server-side, so a mismatch here is a preview of stats silently going missing.
    await screen.findByRole("heading", { level: 2, name: HOME });
    expect(screen.queryByText("Orphan")).not.toBeInTheDocument();
  });

  it("omits a side's table entirely when it has no players", async () => {
    resolves(detail({ players: [playerRow()] }));

    await renderLoaded();

    await screen.findByRole("heading", { level: 2, name: HOME });
    // An empty table with headers and no rows reads as a rendering bug.
    expect(screen.queryByRole("heading", { level: 2, name: AWAY })).not.toBeInTheDocument();
  });

  it("survives a game with no players array at all", async () => {
    resolves(detail({ players: null }));

    await renderLoaded();

    expect(
      await screen.findByRole("heading", { level: 1, name: `${HOME} vs ${AWAY}` }),
    ).toBeInTheDocument();
  });

  it("shows every counting stat in column order", async () => {
    await renderLoaded();

    const homeTable = await screen.findByRole("region", { name: HOME });
    const row = within(homeTable).getByText("Akif").closest("tr") as HTMLElement;
    const cells = Array.from(row.querySelectorAll("td")).map((td) => td.textContent);

    // Asserted as an ordered sequence rather than cell by cell: steals and fouls are both
    // 2 here, and more importantly a reordered column would mislabel every stat on the page
    // without changing which values appear.
    expect(cells).toEqual(["Akif", "24", "6", "5", "2", "1", "3", "2", "9/17", "3/7", "3/4"]);
  });

  it("renders shooting as made over attempted", async () => {
    await renderLoaded();

    const homeTable = await screen.findByRole("region", { name: HOME });
    const row = within(homeTable).getByText("Akif").closest("tr") as HTMLElement;

    expect(within(row).getByText("9/17")).toBeInTheDocument();
    expect(within(row).getByText("3/7")).toBeInTheDocument();
    expect(within(row).getByText("3/4")).toBeInTheDocument();
  });

  it("shows zero rather than blank for a missing counting stat", async () => {
    resolves(detail({ players: [playerRow({ points: null, rebounds: null })] }));

    await renderLoaded();

    const homeTable = await screen.findByRole("region", { name: HOME });
    const row = within(homeTable).getByText("Akif").closest("tr") as HTMLElement;

    // A blank cell in a stats table is indistinguishable from a layout bug.
    expect(within(row).getAllByText("0").length).toBeGreaterThanOrEqual(2);
  });

  it("labels the stat columns", async () => {
    await renderLoaded();

    const homeTable = await screen.findByRole("region", { name: HOME });
    for (const header of ["PTS", "REB", "AST", "STL", "BLK", "TO", "PF", "FG", "3P", "FT"]) {
      expect(within(homeTable).getByText(header)).toBeInTheDocument();
    }
  });
});
