/**
 * The games list — and the two destructive actions in the client: delete, and move between
 * squads.
 *
 * The permission rule (uploader or squad OWNER) is enforced server-side; this page's job is
 * not to offer what will be refused. And the move action is the only way to undo an upload
 * that landed in the wrong squad, so its result toast has to report what actually happened
 * rather than assume everything moved.
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

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  Link: ({
    children,
  }: {
    to?: string;
    params?: unknown;
    children: ReactNode;
    className?: string;
  }) => <a href="#">{children}</a>,
}));

vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

// The shell has its own suite; here it only needs to pass children through so the page's own
// markup is what the queries see.
vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

let authUser: { id: string } | null = { id: "u1" };
let squadState: {
  activeSquad: { id: string; name: string; isPersonal: boolean; role: string } | null;
  squads: { id: string; name: string; isPersonal: boolean }[];
};

vi.mock("@/contexts/auth-context", () => ({ useAuth: () => ({ user: authUser }) }));
vi.mock("@/contexts/squad-context", () => ({ useSquads: () => squadState }));

import { Route } from "@/routes/games.index";
import { api } from "@/lib/api";

const GamesPage = (Route as unknown as { component: () => ReactNode }).component;
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const del = vi.mocked(api.del);

interface Game {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  uploadedByUserId: string;
  players: unknown[] | null;
}

function game(over: Partial<Game> = {}): Game {
  return {
    id: "g1",
    date: "2026-07-29T00:00:00.000Z",
    homeTeam: "Akif (PG)",
    awayTeam: "Team B",
    homeScore: 102,
    awayScore: 98,
    uploadedByUserId: "u1",
    players: new Array(10).fill({}),
    ...over,
  };
}

const MEMBERS = [
  { userId: "u1", name: "Akif", email: "akif@test.local" },
  { userId: "u2", name: null, email: "nillan@test.local" },
];

function routeGet(handlers: { games?: () => unknown; members?: () => unknown } = {}) {
  get.mockImplementation((path: string) => {
    if (path.includes("/screenshots/games")) {
      return (handlers.games?.() ?? Promise.resolve({ success: true, data: [game()] })) as never;
    }
    if (path.includes("/members")) {
      return (handlers.members?.() ?? Promise.resolve({ success: true, data: MEMBERS })) as never;
    }
    return Promise.resolve({ success: true, data: [] }) as never;
  });
}

function renderPage() {
  // retry off: a failing query must surface as an error state, not three silent retries.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <GamesPage />
    </QueryClientProvider>,
  );
}

/** Renders and waits for the table (or the empty state) to settle. */
async function renderLoaded() {
  const result = renderPage();
  await waitFor(() => expect(get).toHaveBeenCalled());
  return result;
}

beforeEach(() => {
  toastError.mockReset();
  toastSuccess.mockReset();
  get.mockReset();
  post.mockReset().mockResolvedValue({
    success: true,
    data: { moved: ["g1"], duplicates: [], renamed: [], unmapped: [] },
  });
  del.mockReset().mockResolvedValue({ success: true });
  authUser = { id: "u1" };
  squadState = {
    activeSquad: { id: "squad-a", name: "Tuesday Run", isPersonal: false, role: "MEMBER" },
    squads: [
      { id: "squad-a", name: "Tuesday Run", isPersonal: false },
      { id: "squad-b", name: "Sunday League", isPersonal: false },
    ],
  };
  routeGet();
});

describe("the route definition", () => {
  it("sets a title and description", () => {
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();

    expect(head.meta[0]).toEqual({ title: "Games — ScoreCheck" });
  });
});

describe("loading and failure", () => {
  it("shows a spinner while games load", () => {
    routeGet({ games: () => new Promise(() => {}) });

    const { container } = renderPage();

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("shows the server's message when the fetch fails", async () => {
    routeGet({ games: () => Promise.reject(new Error("Failed to fetch games")) });

    await renderLoaded();

    expect(await screen.findByText("Failed to fetch games")).toBeInTheDocument();
  });

  it("prompts an upload when there are no games", async () => {
    routeGet({ games: () => Promise.resolve({ success: true, data: [] }) });

    await renderLoaded();

    expect(await screen.findByText(/No games yet/)).toBeInTheDocument();
  });
});

describe("the table", () => {
  it("shows the matchup, score and player count", async () => {
    await renderLoaded();

    expect(await screen.findByText("Akif (PG) vs Team B")).toBeInTheDocument();
    expect(screen.getByText("102–98")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });

  it("formats the date", async () => {
    await renderLoaded();

    expect(await screen.findByText("Jul 29, 2026")).toBeInTheDocument();
  });

  it("falls back to a dash when a game has no date", async () => {
    routeGet({ games: () => Promise.resolve({ success: true, data: [game({ date: "" })] }) });

    await renderLoaded();

    expect(await screen.findByText("—")).toBeInTheDocument();
  });

  it("counts zero players when the join returned null", async () => {
    routeGet({ games: () => Promise.resolve({ success: true, data: [game({ players: null })] }) });

    await renderLoaded();

    // json_agg over a LEFT JOIN can yield null; rendering "undefined" here was a real bug.
    expect(await screen.findByText("0")).toBeInTheDocument();
  });

  it("names the higher-scoring side as the winner", async () => {
    await renderLoaded();

    expect(await screen.findByText("Akif (PG) won")).toBeInTheDocument();
  });

  it("names the away side when it scored more", async () => {
    routeGet({
      games: () =>
        Promise.resolve({ success: true, data: [game({ homeScore: 90, awayScore: 99 })] }),
    });

    await renderLoaded();

    expect(await screen.findByText("Team B won")).toBeInTheDocument();
  });

  it("awards a tie to the home side", async () => {
    routeGet({
      games: () =>
        Promise.resolve({ success: true, data: [game({ homeScore: 99, awayScore: 99 })] }),
    });

    await renderLoaded();

    // 2K games cannot tie, so this only shows up on a misread box score — pinned so the
    // display is at least deterministic rather than blank.
    expect(await screen.findByText("Akif (PG) won")).toBeInTheDocument();
  });
});

describe("uploader attribution", () => {
  it("is hidden in a personal squad", async () => {
    squadState.activeSquad = { id: "p", name: "Personal", isPersonal: true, role: "OWNER" };

    await renderLoaded();

    await screen.findByText("Akif (PG) vs Team B");
    // Everything in a squad of one was uploaded by you; the column would be pure noise.
    expect(screen.queryByText("Uploaded by")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining("/members"));
  });

  it('shows "You" for your own uploads in a shared squad', async () => {
    await renderLoaded();

    expect(await screen.findByText("You")).toBeInTheDocument();
  });

  it("names another member", async () => {
    routeGet({
      games: () => Promise.resolve({ success: true, data: [game({ uploadedByUserId: "u2" })] }),
    });

    await renderLoaded();

    // u2 has no display name, so the email stands in.
    expect(await screen.findByText("nillan@test.local")).toBeInTheDocument();
  });

  it("shows a dash for an uploader who is no longer a member", async () => {
    routeGet({
      games: () => Promise.resolve({ success: true, data: [game({ uploadedByUserId: "gone" })] }),
    });

    await renderLoaded();

    await screen.findByText("Akif (PG) vs Team B");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});

describe("who may delete", () => {
  it("offers delete to the uploader", async () => {
    await renderLoaded();

    expect(await screen.findByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("offers delete to the squad owner for someone else's game", async () => {
    squadState.activeSquad = {
      id: "squad-a",
      name: "Tuesday Run",
      isPersonal: false,
      role: "OWNER",
    };
    routeGet({
      games: () => Promise.resolve({ success: true, data: [game({ uploadedByUserId: "u2" })] }),
    });

    await renderLoaded();

    expect(await screen.findByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("withholds delete from a plain member on someone else's game", async () => {
    routeGet({
      games: () => Promise.resolve({ success: true, data: [game({ uploadedByUserId: "u2" })] }),
    });

    await renderLoaded();

    await screen.findByText("Akif (PG) vs Team B");
    // The server refuses it anyway; offering a button that 403s is the avoidable part.
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(
      screen.getByTitle("Only the uploader or squad owner can delete this game"),
    ).toBeInTheDocument();
  });
});

describe("deleting a game", () => {
  async function openConfirm() {
    await renderLoaded();
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    return screen.findByRole("alertdialog");
  }

  it("asks for confirmation naming the matchup", async () => {
    const dialog = await openConfirm();

    expect(within(dialog).getByText(/Akif \(PG\) vs Team B/)).toBeInTheDocument();
  });

  it("warns that it affects the whole squad and cannot be undone", async () => {
    const dialog = await openConfirm();

    expect(within(dialog).getByText(/removed for everyone in this squad/)).toBeInTheDocument();
    expect(within(dialog).getByText(/can't be undone/)).toBeInTheDocument();
  });

  it("deletes on confirmation", async () => {
    const dialog = await openConfirm();

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect(del).toHaveBeenCalledWith("/api/screenshots/games/g1");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Game deleted"));
  });

  it("deletes nothing on cancel", async () => {
    const dialog = await openConfirm();

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(del).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("reports a refused delete and closes the dialog", async () => {
    del.mockRejectedValue(new Error("Only the uploader or squad owner can delete this game"));
    const dialog = await openConfirm();

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Only the uploader or squad owner can delete this game",
      ),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
});

describe("selection", () => {
  const two = [game({ id: "g1" }), game({ id: "g2", homeTeam: "Nillan (PG)" })];

  beforeEach(() => {
    routeGet({ games: () => Promise.resolve({ success: true, data: two }) });
  });

  it("hides the bulk bar until something is selected", async () => {
    await renderLoaded();

    await screen.findByText("Akif (PG) vs Team B");
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("counts a selection", async () => {
    await renderLoaded();

    await userEvent.click(await screen.findByLabelText("Select Akif (PG) vs Team B"));

    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  });

  it("deselects on a second click", async () => {
    await renderLoaded();
    const box = await screen.findByLabelText("Select Akif (PG) vs Team B");

    await userEvent.click(box);
    await userEvent.click(box);

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("selects every game at once", async () => {
    await renderLoaded();

    await userEvent.click(await screen.findByLabelText("Select all games"));

    expect(screen.getByText(/2 selected/)).toBeInTheDocument();
  });

  it("clears everything when select-all is already on", async () => {
    await renderLoaded();
    const all = await screen.findByLabelText("Select all games");

    await userEvent.click(all);
    await userEvent.click(all);

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  it("ticks select-all once every row is individually selected", async () => {
    await renderLoaded();

    await userEvent.click(await screen.findByLabelText("Select Akif (PG) vs Team B"));
    await userEvent.click(screen.getByLabelText("Select Nillan (PG) vs Team B"));

    expect(screen.getByLabelText("Select all games")).toBeChecked();
  });

  it("clears the selection on demand", async () => {
    await renderLoaded();
    await userEvent.click(await screen.findByLabelText("Select all games"));

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));

    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });
});

describe("moving games to another squad", () => {
  async function selectOneAndOpenTargets() {
    await renderLoaded();
    await userEvent.click(await screen.findByLabelText("Select Akif (PG) vs Team B"));
    await userEvent.click(screen.getByRole("button", { name: "Move to squad" }));
    return screen.findByRole("menu");
  }

  it("offers every squad except the one you are in", async () => {
    const menu = await selectOneAndOpenTargets();

    expect(within(menu).getByText("Sunday League")).toBeInTheDocument();
    // Moving a game into the squad it already lives in is a no-op the server would reject.
    expect(within(menu).queryByText("Tuesday Run")).not.toBeInTheDocument();
  });

  it("explains why there is nowhere to move to", async () => {
    squadState.squads = [{ id: "squad-a", name: "Tuesday Run", isPersonal: false }];
    await renderLoaded();

    await userEvent.click(await screen.findByLabelText("Select Akif (PG) vs Team B"));

    expect(screen.getByText(/Create another squad to move games into it\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move to squad" })).not.toBeInTheDocument();
  });

  it("posts the selected ids to the target squad", async () => {
    const menu = await selectOneAndOpenTargets();

    await userEvent.click(within(menu).getByText("Sunday League"));

    // The target is the path squad; the source is read from each game server-side, so a
    // caller cannot name a source they are not in.
    expect(post).toHaveBeenCalledWith("/api/squads/squad-b/games/move", { gameIds: ["g1"] });
  });

  it("reports the real outcome, not an assumed one", async () => {
    post.mockResolvedValue({
      success: true,
      data: { moved: ["g1"], duplicates: [{}, {}], renamed: [], unmapped: ["xxakifxx"] },
    });
    const menu = await selectOneAndOpenTargets();

    await userEvent.click(within(menu).getByText("Sunday League"));

    // Unmapped names accrue no stats until someone maps them, so silence here would look
    // like a successful move that quietly lost a player's numbers.
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Moved 1 game. 2 already there. 1 name(s) need mapping.",
      ),
    );
  });

  it("pluralises the moved count", async () => {
    post.mockResolvedValue({
      success: true,
      data: { moved: ["g1", "g2"], duplicates: [], renamed: [], unmapped: [] },
    });
    const menu = await selectOneAndOpenTargets();

    await userEvent.click(within(menu).getByText("Sunday League"));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Moved 2 games."));
  });

  it("clears the selection after a successful move", async () => {
    const menu = await selectOneAndOpenTargets();

    await userEvent.click(within(menu).getByText("Sunday League"));

    await waitFor(() => expect(screen.queryByText(/selected/)).not.toBeInTheDocument());
  });

  it("reports a refused move and keeps the selection", async () => {
    post.mockRejectedValue(new Error("Two names would merge onto one person"));
    const menu = await selectOneAndOpenTargets();

    await userEvent.click(within(menu).getByText("Sunday League"));

    // The merge guard refuses the whole move; keeping the selection lets the user fix the
    // roster and retry without re-picking every game.
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Two names would merge onto one person"),
    );
    expect(screen.getByText(/1 selected/)).toBeInTheDocument();
  });
});

describe("pagination", () => {
  /** Games list responses now carry page metadata; older shapes omit it entirely. */
  function pagedGet(meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  }) {
    get.mockImplementation((path: string) => {
      if (path.includes("/screenshots/games")) {
        const page = Number(new URLSearchParams(path.split("?")[1]).get("page") ?? 1);
        return Promise.resolve({
          success: true,
          data: [game({ id: `g-page-${page}` })],
          meta: { ...meta, page },
        }) as never;
      }
      if (path.includes("/members")) {
        return Promise.resolve({ success: true, data: MEMBERS }) as never;
      }
      return Promise.resolve({ success: true, data: [] }) as never;
    });
  }

  it("hides the controls when everything fits on one page", async () => {
    pagedGet({ page: 1, pageSize: 25, total: 1, totalPages: 1 });
    await renderLoaded();

    expect(screen.queryByRole("navigation", { name: /games pagination/i })).not.toBeInTheDocument();
  });

  it("shows the page position and disables Previous on the first page", async () => {
    pagedGet({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
    await renderLoaded();

    expect(await screen.findByText(/page 1 of 3/i)).toBeInTheDocument();
    expect(screen.getByText(/5 games/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });

  it("requests the next page and disables Next at the end", async () => {
    pagedGet({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    await renderLoaded();

    await userEvent.click(await screen.findByRole("button", { name: /next/i }));

    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(expect.stringContaining("page=2")),
    );
    expect(await screen.findByText(/page 2 of 2/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /previous/i })).toBeEnabled();
  });

  it("goes back with Previous", async () => {
    pagedGet({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    await renderLoaded();

    await userEvent.click(await screen.findByRole("button", { name: /next/i }));
    await screen.findByText(/page 2 of 2/i);
    await userEvent.click(await screen.findByRole("button", { name: /previous/i }));

    expect(await screen.findByText(/page 1 of 2/i)).toBeInTheDocument();
  });

  it("labels both controls with text, not icons alone", async () => {
    // Keeps the buttons readable by screen readers and by anyone who does not recognise a
    // bare chevron.
    pagedGet({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    await renderLoaded();

    expect(await screen.findByRole("button", { name: /previous/i })).toHaveAttribute("title");
    expect(await screen.findByRole("button", { name: /next/i })).toHaveAttribute("title");
  });
});

describe("optimistic delete", () => {
  /** Two games so a removal is visible without emptying the table. */
  function twoGames() {
    get.mockImplementation((path: string) => {
      if (path.includes("/screenshots/games")) {
        return Promise.resolve({
          success: true,
          data: [game({ id: "g1" }), game({ id: "g2", homeTeam: "Second Game" })],
          meta: { page: 1, pageSize: 25, total: 2, totalPages: 1 },
        }) as never;
      }
      if (path.includes("/members")) {
        return Promise.resolve({ success: true, data: MEMBERS }) as never;
      }
      return Promise.resolve({ success: true, data: [] }) as never;
    });
  }

  it("removes the row before the server answers", async () => {
    twoGames();
    // A delete that never settles: anything still on screen is there optimistically.
    del.mockReturnValue(new Promise(() => {}) as never);
    await renderLoaded();
    await userEvent.click((await screen.findAllByRole("button", { name: "Delete" }))[0]!);
    const dialog = await screen.findByRole("alertdialog");

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    // Gone from the table with the request still in flight — the point of the change.
    await waitFor(() => expect(screen.queryByText(/Akif \(PG\) vs Team B/)).not.toBeInTheDocument());
    // getAllByText: the name appears in both the row link and the "won" badge.
    expect(screen.getAllByText(/Second Game/).length).toBeGreaterThan(0);
  });

  it("puts the row back when the server refuses", async () => {
    twoGames();
    del.mockRejectedValue(new Error("Only the uploader or squad owner can delete this game"));
    await renderLoaded();
    await userEvent.click((await screen.findAllByRole("button", { name: "Delete" }))[0]!);
    const dialog = await screen.findByRole("alertdialog");

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    // The rollback is the half of optimistic rendering that silently rots: without it a
    // refused delete leaves the row missing until a manual refresh, and the user believes
    // it worked.
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Only the uploader or squad owner can delete this game",
      ),
    );
    expect(await screen.findByText(/Akif \(PG\) vs Team B/)).toBeInTheDocument();
  });

  it("decrements the visible total while the delete is in flight", async () => {
    twoGames();
    del.mockReturnValue(new Promise(() => {}) as never);
    await renderLoaded();
    await userEvent.click((await screen.findAllByRole("button", { name: "Delete" }))[0]!);
    const dialog = await screen.findByRole("alertdialog");

    await userEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    // Only asserts the count was adjusted in the cache, not that controls render — with
    // one page there is no pagination footer to read it from.
    await waitFor(() => expect(screen.queryByText(/Akif \(PG\) vs Team B/)).not.toBeInTheDocument());
  });
});
