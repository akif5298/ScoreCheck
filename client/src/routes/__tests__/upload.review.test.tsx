/**
 * The review workspace — the last screen before a box score becomes permanent data.
 *
 * Everything the OCR got wrong is corrected here, and the team names and scores shown are
 * the ones that get written, so what is on screen has to be exactly what is saved. This page
 * also renders OUTSIDE AppShell (it has its own chrome), which means it carries its own auth
 * guard — miss that and the whole review flow is reachable logged out.
 *
 * computeReviewTeams is deliberately NOT mocked: the live team naming and scoring is the
 * behaviour under test here, not an incidental dependency.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ExtractedPlayer, ItemStatus, UploadItem } from "@/contexts/upload-session";

const { navigate, logout, session } = vi.hoisted(() => ({
  navigate: vi.fn(),
  logout: vi.fn(),
  session: {
    select: vi.fn(),
    addFiles: vi.fn(),
    updatePlayerName: vi.fn(),
    updateGrade: vi.fn(),
    updateStat: vi.fn(),
    retryItem: vi.fn(),
    removeItem: vi.fn(),
    startOver: vi.fn(),
    save: vi.fn(),
  },
}));

let authState: { user: { id: string; role: string } | null; loading: boolean };
let sessionState: Record<string, unknown>;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}));

vi.mock("@/components/app-shell", () => ({
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  nav: [
    { to: "/", label: "Overview", code: "01" },
    { to: "/games", label: "Games", code: "03" },
    { to: "/admin", label: "Admin", code: "09" },
  ],
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ ...authState, logout }),
}));

// Only the hook is replaced — computeReviewTeams stays real.
vi.mock("@/contexts/upload-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/upload-session")>();
  return { ...actual, useUploadSession: () => sessionState };
});

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

import { Route } from "@/routes/upload.review";
import { api } from "@/lib/api";

const ReviewWorkspace = (Route as unknown as { component: () => ReactNode }).component;
const get = vi.mocked(api.get);

function player(over: Partial<ExtractedPlayer> = {}): ExtractedPlayer {
  return {
    name: "Akif",
    team: "Team A",
    teammateGrade: "B",
    position: "PG",
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

function item(over: Partial<UploadItem> = {}): UploadItem {
  return {
    id: "i1",
    file: new File(["x"], "IMG_0001.png", { type: "image/png" }),
    filename: "IMG_0001.png",
    previewUrl: "blob:preview-1",
    status: "ready" as ItemStatus,
    players: [player(), player({ name: "Opp", team: "Team B", points: 30, position: "PG" })],
    gameData: { homeTeam: "", awayTeam: "", homeScore: 0, awayScore: 0 },
    ...over,
  } as UploadItem;
}

/** Builds the session value, deriving the bits the page computes from `items`. */
function setSession(items: UploadItem[], selectedId: string | null = items[0]?.id ?? null) {
  const selectedItem = items.find((i) => i.id === selectedId) ?? null;
  sessionState = {
    ...session,
    items,
    selectedId,
    selectedItem,
    counts: {
      pending: items.filter((i) => i.status === "queued" || i.status === "extracting").length,
      ready: items.filter((i) => i.status === "ready").length,
      saved: items.filter((i) => i.status === "saved").length,
      error: items.filter((i) => i.status === "error").length,
    },
    allSaved: items.length > 0 && items.every((i) => i.status === "saved"),
  };
}

const MAPPINGS = [
  { id: "m1", gamertag: "GRIM_AR15", displayName: "Akif" },
  { id: "m2", gamertag: "nilly", displayName: "Nillan" },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReviewWorkspace />
    </QueryClientProvider>,
  );
}

/** Renders and waits for the roster mappings query to land. */
async function renderLoaded() {
  const result = renderPage();
  await waitFor(() => expect(get).toHaveBeenCalled());
  return result;
}

beforeEach(() => {
  navigate.mockReset();
  logout.mockReset();
  for (const fn of Object.values(session)) fn.mockReset();
  get.mockReset().mockResolvedValue({ success: true, data: MAPPINGS });
  authState = { user: { id: "u1", role: "USER" }, loading: false };
  setSession([item()]);
});

describe("the route definition", () => {
  it("sets a title and description", () => {
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();

    expect(head.meta[0]).toEqual({ title: "Review box scores — ScoreCheck" });
  });
});

describe("the auth guard", () => {
  it("redirects a logged-out visitor", () => {
    authState = { user: null, loading: false };

    renderPage();

    // This page is outside AppShell, so nothing else would stop an unauthenticated visitor.
    expect(navigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("renders nothing while redirecting", () => {
    authState = { user: null, loading: false };

    const { container } = renderPage();

    expect(container).toBeEmptyDOMElement();
  });

  it("waits while auth resolves", () => {
    authState = { user: null, loading: true };

    renderPage();

    expect(navigate).not.toHaveBeenCalledWith({ to: "/login" });
  });
});

describe("an empty batch", () => {
  it("returns to the dropzone", async () => {
    setSession([]);

    renderPage();

    // A direct hit on /upload/review, or a batch cleared by Start over. `replace` keeps the
    // dead URL out of history so Back does not bounce straight here again.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/upload", replace: true }));
  });

  it("renders nothing rather than an empty workspace", () => {
    setSession([]);

    const { container } = renderPage();

    expect(container).toBeEmptyDOMElement();
  });
});

describe("the top bar", () => {
  it("offers the other areas of the app", async () => {
    await renderLoaded();

    await userEvent.click(screen.getByLabelText("Open navigation"));
    const menu = await screen.findByRole("menu");

    expect(within(menu).getByText("Overview")).toBeInTheDocument();
    expect(within(menu).getByText("Games")).toBeInTheDocument();
  });

  it("hides Admin from a non-admin", async () => {
    await renderLoaded();

    await userEvent.click(screen.getByLabelText("Open navigation"));
    const menu = await screen.findByRole("menu");

    expect(within(menu).queryByText("Admin")).not.toBeInTheDocument();
  });

  it("shows Admin to an admin", async () => {
    authState = { user: { id: "u1", role: "ADMIN" }, loading: false };
    await renderLoaded();

    await userEvent.click(screen.getByLabelText("Open navigation"));
    const menu = await screen.findByRole("menu");

    expect(within(menu).getByText("Admin")).toBeInTheDocument();
  });

  it("signs out and returns to login", async () => {
    await renderLoaded();

    await userEvent.click(screen.getByLabelText("Open navigation"));
    const menu = await screen.findByRole("menu");
    await userEvent.click(within(menu).getByText("Sign out"));

    expect(logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("links out to games and analytics", async () => {
    await renderLoaded();

    await userEvent.click(screen.getByRole("button", { name: "View games" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/games" });

    await userEvent.click(screen.getByRole("button", { name: "Go to analytics" }));
    expect(navigate).toHaveBeenCalledWith({ to: "/analytics" });
  });

  it("promotes the analytics button once everything is saved", async () => {
    setSession([item({ status: "saved" })]);

    await renderLoaded();

    // The batch is finished; this is the only "you're done" signal the page gives.
    expect(screen.getByRole("button", { name: "Done · analytics ▸" })).toBeInTheDocument();
  });
});

describe("the file rail", () => {
  it("counts the batch", async () => {
    setSession([item({ id: "i1" }), item({ id: "i2", filename: "IMG_0002.png" })]);

    await renderLoaded();

    expect(screen.getByText("Uploads · 2")).toBeInTheDocument();
  });

  it("shows how many are still extracting", async () => {
    setSession([item({ id: "i1", status: "extracting" }), item({ id: "i2", status: "queued" })]);

    await renderLoaded();

    expect(screen.getByText("2⋯")).toBeInTheDocument();
  });

  it("shows no pending indicator once everything has extracted", async () => {
    await renderLoaded();

    expect(screen.queryByText(/⋯/)).not.toBeInTheDocument();
  });

  it("shows a thumbnail and filename per file", async () => {
    await renderLoaded();

    const thumb = screen.getByTitle("IMG_0001.png");
    expect(within(thumb).getByRole("presentation")).toHaveAttribute("src", "blob:preview-1");
  });

  it("selects a file when its thumbnail is clicked", async () => {
    setSession([item({ id: "i1" }), item({ id: "i2", filename: "IMG_0002.png" })]);
    await renderLoaded();

    await userEvent.click(screen.getByTitle("IMG_0002.png"));

    expect(session.select).toHaveBeenCalledWith("i2");
  });

  it.each([
    ["queued", "Queued"],
    ["extracting", "Extracting"],
    ["ready", "Ready"],
    ["saving", "Saving"],
    ["saved", "Saved"],
    ["error", "Error"],
  ])("marks a %s file with a %s dot", async (status, label) => {
    setSession([item({ status: status as ItemStatus, errorMsg: "boom" })]);

    await renderLoaded();

    // The rail is too narrow for text, so the dot's title is the only affordance.
    expect(screen.getByTitle(label)).toBeInTheDocument();
  });

  it("clears the batch on Start over", async () => {
    await renderLoaded();

    await userEvent.click(screen.getByRole("button", { name: "Start over" }));

    expect(session.startOver).toHaveBeenCalled();
  });

  it("accepts more files", async () => {
    const { container } = await renderLoaded();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    await userEvent.upload(input, new File(["x"], "IMG_0003.png", { type: "image/png" }));

    expect(session.addFiles).toHaveBeenCalled();
  });

  it("opens the file picker from the visible button", async () => {
    const { container } = await renderLoaded();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");

    await userEvent.click(screen.getByRole("button", { name: "+ Add more" }));

    // The real input is hidden for styling, so the button is the only way a user reaches it.
    expect(click).toHaveBeenCalled();
  });

  it("only accepts the image types the server allows", async () => {
    const { container } = await renderLoaded();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toHaveAttribute("accept", "image/png,image/jpeg");
    expect(input).toHaveAttribute("multiple");
  });
});

describe("the selected file's panel", () => {
  it("prompts a selection when nothing is selected", async () => {
    setSession([item()], null);

    await renderLoaded();

    expect(screen.getByText("Select a file on the left to review it.")).toBeInTheDocument();
  });

  it("shows the screenshot even before extraction finishes", async () => {
    setSession([item({ status: "extracting" })]);

    await renderLoaded();

    // The whole point of the local preview: the user sees what they picked immediately.
    expect(screen.getByAltText("IMG_0001.png")).toHaveAttribute("src", "blob:preview-1");
  });

  it.each([
    ["queued", "Waiting in queue…", "Pending"],
    ["extracting", "Extracting stats…", "Working…"],
  ])("explains the %s state", async (status, heading, stepState) => {
    setSession([item({ status: status as ItemStatus })]);

    await renderLoaded();

    expect(screen.getByText(heading)).toBeInTheDocument();
    expect(screen.getAllByText(stepState)).toHaveLength(3);
  });

  it("names the pipeline stages while extracting", async () => {
    setSession([item({ status: "extracting" })]);

    await renderLoaded();

    expect(screen.getByText("Junk filter")).toBeInTheDocument();
    expect(screen.getByText("Fine-tuned VLM extraction")).toBeInTheDocument();
    expect(screen.getByText("Basketball-specific validation")).toBeInTheDocument();
  });

  it("reassures that the screenshot is already stored", async () => {
    setSession([item({ status: "extracting" })]);

    await renderLoaded();

    // Extraction takes ~22s on a warm host; without this the user may think it was lost.
    expect(screen.getByText(/The screenshot above is already saved/)).toBeInTheDocument();
  });
});

describe("a failed file", () => {
  beforeEach(() => {
    setSession([item({ status: "error", errorMsg: "visually similar screenshot already saved" })]);
  });

  it("shows the reason", async () => {
    await renderLoaded();

    expect(screen.getByText("visually similar screenshot already saved")).toBeInTheDocument();
  });

  it("offers a retry", async () => {
    await renderLoaded();

    await userEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(session.retryItem).toHaveBeenCalledWith("i1");
  });

  it("offers to drop the file", async () => {
    await renderLoaded();

    await userEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(session.removeItem).toHaveBeenCalledWith("i1");
  });
});

describe("a saved file", () => {
  it("confirms what was saved by name", async () => {
    setSession([
      item({
        status: "saved",
        gameData: { homeTeam: "Akif (PG)", awayTeam: "Team B", homeScore: 24, awayScore: 30 },
      }),
    ]);

    await renderLoaded();

    expect(screen.getByRole("heading", { name: "Akif (PG) vs Team B saved" })).toBeInTheDocument();
  });

  it("falls back to generic side names when the game has none", async () => {
    setSession([item({ status: "saved" })]);

    await renderLoaded();

    expect(screen.getByRole("heading", { name: "Home vs Away saved" })).toBeInTheDocument();
  });

  it("offers no stat editing", async () => {
    setSession([item({ status: "saved" })]);

    await renderLoaded();

    // The game is in the database; editing here would silently do nothing.
    expect(screen.queryByRole("button", { name: "Save game" })).not.toBeInTheDocument();
  });
});

describe("the review pane", () => {
  it("derives each side's name from the roster as players are assigned", async () => {
    await renderLoaded();

    // "Akif" is a mapped name, so the home side names itself as its lineup; the opponent
    // side has nobody mapped and keeps its raw label. Each name appears twice — once on the
    // score pill, once on its stats table — and both must show the same string, since that
    // is what gets written to games.homeTeam and every players.team row.
    expect(await screen.findAllByTitle("Akif (PG)")).toHaveLength(2);
    expect(screen.getAllByTitle("Team B")).toHaveLength(2);
  });

  it("totals each side's points live from the rows", async () => {
    await renderLoaded();

    await screen.findAllByTitle("Akif (PG)");
    expect(screen.getAllByText("24").length).toBeGreaterThan(0);
    expect(screen.getAllByText("30").length).toBeGreaterThan(0);
  });

  it("shows how many players are on each side", async () => {
    await renderLoaded();

    expect((await screen.findAllByText("1 players")).length).toBe(2);
  });

  it("falls back to placeholder pills when a side has no players at all", async () => {
    setSession([
      item({
        players: [player({ name: "Akif", points: 24 }), player({ name: "Nillan", points: 18 })],
      }),
    ]);

    await renderLoaded();

    // Both rows on one side happens when OCR misreads the table split. The away pill has no
    // team object to read, so it must still render a name and a zero rather than "undefined".
    const pills = await screen.findAllByTitle("Team B");
    expect(pills.length).toBeGreaterThan(0);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("saves with the current roster names", async () => {
    await renderLoaded();

    await userEvent.click(await screen.findByRole("button", { name: "Save game" }));

    // The names decide what gets written to games.homeTeam and every players.team row.
    expect(session.save).toHaveBeenCalledWith(["Akif", "Nillan"]);
  });

  it("blocks a second save while one is in flight", async () => {
    setSession([item({ status: "saving" })]);

    await renderLoaded();

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
  });

  it("warns when no roster mappings exist yet", async () => {
    get.mockResolvedValue({ success: true, data: [] });

    await renderLoaded();

    // Unmapped names accrue no totals at all, so saving now produces a game with no stats.
    expect(await screen.findByText(/No mapped players yet/)).toBeInTheDocument();
    expect(screen.getByText("roster mappings")).toHaveAttribute("href", "/roster");
  });

  it("drops the warning once mappings exist", async () => {
    await renderLoaded();

    await screen.findAllByTitle("Akif (PG)");
    expect(screen.queryByText(/No mapped players yet/)).not.toBeInTheDocument();
  });

  it("de-duplicates and sorts the assignable names", async () => {
    get.mockResolvedValue({
      success: true,
      data: [
        { id: "m1", gamertag: "a", displayName: "Nillan" },
        { id: "m2", gamertag: "b", displayName: "Akif" },
        { id: "m3", gamertag: "c", displayName: "Akif" },
      ],
    });

    await renderLoaded();

    await userEvent.click(await screen.findByRole("button", { name: "Save game" }));
    // Two gamertags can map to one person; offering that name twice in the dropdown looks
    // like a bug, and the sort keeps the list stable between renders.
    expect(session.save).toHaveBeenCalledWith(["Akif", "Nillan"]);
  });
});

describe("editing a row", () => {
  /**
   * The stats table for the side whose displayed name matches.
   *
   * The name carries a `title` in two places — the score pill and the table header — so
   * matching on the title alone is ambiguous; pick the section that actually has a table.
   */
  async function tableFor(name: string): Promise<HTMLElement> {
    await screen.findAllByTitle(name);
    const section = screen
      .getAllByTitle(name)
      .map((el) => el.closest("section"))
      .find((el): el is HTMLElement => !!el?.querySelector("table"));
    if (!section) throw new Error(`no stats table found for "${name}"`);
    return section;
  }

  it("offers every mapped name plus an unassign option", async () => {
    await renderLoaded();
    const table = await tableFor("Akif (PG)");

    const options = Array.from(within(table).getByRole("combobox").querySelectorAll("option")).map(
      (o) => o.textContent,
    );

    expect(options).toEqual(["— assign —", "Akif", "Nillan"]);
  });

  it("keeps an extracted name that is not on the roster as an option", async () => {
    await renderLoaded();
    const table = await tableFor("Team B");

    const options = Array.from(within(table).getByRole("combobox").querySelectorAll("option")).map(
      (o) => o.textContent,
    );

    // Otherwise the select would show blank and the user would lose what OCR read.
    expect(options).toContain("Opp");
  });

  it("reassigns a player by index", async () => {
    await renderLoaded();
    const table = await tableFor("Akif (PG)");

    await userEvent.selectOptions(within(table).getByRole("combobox"), "Nillan");

    expect(session.updatePlayerName).toHaveBeenCalledWith(0, "Nillan");
  });

  it("corrects a teammate grade", async () => {
    await renderLoaded();
    const table = await tableFor("Akif (PG)");
    const grade = within(table).getByDisplayValue("B");

    await userEvent.type(grade, "+");

    expect(session.updateGrade).toHaveBeenCalledWith(0, "B+");
  });

  it("caps the grade at three characters", async () => {
    await renderLoaded();
    const table = await tableFor("Akif (PG)");

    expect(within(table).getByDisplayValue("B")).toHaveAttribute("maxlength", "3");
  });

  it("corrects a counting stat as a number, not a string", async () => {
    await renderLoaded();
    const table = await tableFor("Akif (PG)");
    const points = within(table).getByDisplayValue("24");

    await userEvent.type(points, "5");

    // Number(), not the raw value — a string would break every downstream sum.
    expect(session.updateStat).toHaveBeenCalledWith(0, "points", 245);
  });

  it("labels the two halves of a made/attempted pair", async () => {
    await renderLoaded();
    const table = await tableFor("Akif (PG)");

    // Three pairs (FG, 3P, FT), each with a made and an attempted box.
    expect(within(table).getAllByLabelText("Made")).toHaveLength(3);
    expect(within(table).getAllByLabelText("Attempted")).toHaveLength(3);
  });

  it("corrects a made value", async () => {
    await renderLoaded();
    const table = await tableFor("Akif (PG)");

    await userEvent.clear(within(table).getAllByLabelText("Made")[0]);

    expect(session.updateStat).toHaveBeenCalledWith(0, "fgMade", 0);
  });

  it("corrects an attempted value", async () => {
    await renderLoaded();
    const table = await tableFor("Akif (PG)");

    await userEvent.clear(within(table).getAllByLabelText("Attempted")[0]);

    expect(session.updateStat).toHaveBeenCalledWith(0, "fgAttempted", 0);
  });

  it.each([
    [1, "threeMade", "threeAttempted"],
    [2, "ftMade", "ftAttempted"],
  ])("corrects the pair at position %i", async (position, madeKey, attemptedKey) => {
    await renderLoaded();
    const table = await tableFor("Akif (PG)");

    await userEvent.clear(within(table).getAllByLabelText("Made")[position]);
    await userEvent.clear(within(table).getAllByLabelText("Attempted")[position]);

    // All three pairs share one component, so a mis-wired prop would send the wrong stat
    // key — three-pointers landing in free throws, and no visible symptom until analytics.
    expect(session.updateStat).toHaveBeenCalledWith(0, madeKey, 0);
    expect(session.updateStat).toHaveBeenCalledWith(0, attemptedKey, 0);
  });

  it("edits the away side by its own index", async () => {
    await renderLoaded();
    const table = await tableFor("Team B");

    await userEvent.selectOptions(within(table).getByRole("combobox"), "Akif");

    // The away player is index 1 in the flat players array — grouping must not renumber.
    expect(session.updatePlayerName).toHaveBeenCalledWith(1, "Akif");
  });

  it("labels every stat column", async () => {
    await renderLoaded();
    const table = await tableFor("Akif (PG)");

    for (const header of ["PTS", "REB", "AST", "STL", "BLK", "FOULS", "TO"]) {
      expect(within(table).getByText(header)).toBeInTheDocument();
    }
    expect(within(table).getByText("FGM/FGA")).toBeInTheDocument();
    expect(within(table).getByText("3PM/3PA")).toBeInTheDocument();
    expect(within(table).getByText("FTM/FTA")).toBeInTheDocument();
  });
});
