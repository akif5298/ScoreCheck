/**
 * The invite landing page — the only route in the app a logged-out visitor can use, and the
 * only one that must not sit inside AppShell (which would bounce them to /login before they
 * ever saw the squad name).
 *
 * The flow is preview → auth → join → identify, and each step has a failure mode that
 * matters: an unusable invite must say so rather than show an empty card, the invite token
 * doubles as the signup gate so it has to reach signup verbatim, and joining must set the
 * active squad before anything else renders or the next request is scoped to the old squad.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const { navigate, login, signup, toastError, toastSuccess } = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  signup: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

let token = "invite-token";
let authState: { user: unknown; loading: boolean } = { user: null, loading: false };

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useParams: () => ({ token }),
  }),
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => navigate,
}));

vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ ...authState, login, signup }),
}));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

import { Route } from "@/routes/join.$token";
import { api } from "@/lib/api";

const JoinPage = (Route as unknown as { component: () => ReactNode }).component;
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);

const USER = { id: "u1", email: "akif@test.local", role: "USER" };

const PREVIEW = {
  squadId: "squad-a",
  squadName: "Tuesday Run",
  invitedByName: "Nillan",
  memberCount: 3,
  gameCount: 12,
};

const ROSTER = [
  { id: "m1", gamertag: "xxakifxx", displayName: "Akif", linkedUserId: null, isYou: false },
  { id: "m2", gamertag: "nilly", displayName: "Nillan", linkedUserId: "u9", isYou: false },
  { id: "m3", gamertag: "dyl", displayName: "Dylan", linkedUserId: null, isYou: false },
];

/** Routes api.get by path — the page fetches both the preview and, later, the roster. */
function routeGet(handlers: { preview?: () => unknown; roster?: () => unknown } = {}): void {
  get.mockImplementation((path: string) => {
    if (path.includes("/invites/")) {
      return (handlers.preview?.() ?? Promise.resolve({ success: true, data: PREVIEW })) as never;
    }
    if (path.includes("/roster")) {
      return (handlers.roster?.() ?? Promise.resolve({ success: true, data: ROSTER })) as never;
    }
    return Promise.resolve({ success: true, data: null }) as never;
  });
}

function notFound(message = "Not found") {
  return Promise.reject(Object.assign(new Error(message), { status: 404 }));
}

/** Renders and waits for the preview fetch to settle. */
async function renderJoin() {
  const result = render(<JoinPage />);
  await waitFor(() => expect(get).toHaveBeenCalled());
  return result;
}

/** Signed in, preview loaded, Join clicked — leaves the identify step on screen. */
async function joinAndIdentify() {
  authState = { user: USER, loading: false };
  await renderJoin();
  await userEvent.click(await screen.findByRole("button", { name: "Join Tuesday Run" }));
  return screen.findByRole("heading", { name: "Which player are you?" });
}

beforeEach(() => {
  token = "invite-token";
  navigate.mockReset();
  login.mockReset().mockResolvedValue(undefined);
  signup.mockReset().mockResolvedValue(undefined);
  toastError.mockReset();
  toastSuccess.mockReset();
  get.mockReset();
  post.mockReset().mockResolvedValue({ success: true, data: { squadId: "squad-a", joined: true } });
  authState = { user: null, loading: false };
  routeGet();
});

describe("the route definition", () => {
  it("sets a page title", () => {
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();

    expect(head.meta[0]).toEqual({ title: "Join a squad — ScoreCheck" });
  });
});

describe("the invite preview", () => {
  it("fetches the preview for the token in the URL", async () => {
    token = "abc123";

    await renderJoin();

    expect(get).toHaveBeenCalledWith("/api/squads/invites/abc123");
  });

  it("shows a spinner while it loads", () => {
    routeGet({ preview: () => new Promise(() => {}) });

    const { container } = render(<JoinPage />);

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("names the squad and who invited you", async () => {
    await renderJoin();

    expect(await screen.findByRole("heading", { name: "Tuesday Run" })).toBeInTheDocument();
    expect(screen.getByText(/Nillan invited you/)).toBeInTheDocument();
  });

  it("shows what you would be joining", async () => {
    await renderJoin();

    // The counts are the whole reason to show a preview before asking for a password.
    expect(await screen.findByText(/3 members · 12 games shared\./)).toBeInTheDocument();
  });

  it("omits the inviter line when the server does not know who invited you", async () => {
    routeGet({
      preview: () => Promise.resolve({ success: true, data: { ...PREVIEW, invitedByName: null } }),
    });

    await renderJoin();

    expect(await screen.findByRole("heading", { name: "Tuesday Run" })).toBeInTheDocument();
    expect(screen.queryByText(/invited you/)).not.toBeInTheDocument();
  });

  it.each([
    [1, 1, "1 member · 1 game shared."],
    [2, 0, "2 members · 0 games shared."],
  ])("pluralises %i members and %i games", async (memberCount, gameCount, expected) => {
    routeGet({
      preview: () =>
        Promise.resolve({ success: true, data: { ...PREVIEW, memberCount, gameCount } }),
    });

    await renderJoin();

    expect(await screen.findByText(new RegExp(expected.replace(/\./g, "\\.")))).toBeInTheDocument();
  });
});

describe("an unusable invite", () => {
  it("explains a 404 without saying which reason applies", async () => {
    routeGet({ preview: () => notFound() });

    await renderJoin();

    // The server answers 404 for unknown, revoked, expired and exhausted alike, so the
    // response cannot be used to probe for valid tokens — the copy has to match that.
    expect(
      await screen.findByText("This invite link is invalid, expired, or fully used."),
    ).toBeInTheDocument();
  });

  it("shows a way out", async () => {
    routeGet({ preview: () => notFound() });

    await renderJoin();

    expect(await screen.findByText("Go home")).toHaveAttribute("href", "/");
  });

  it("passes through a non-404 message", async () => {
    routeGet({ preview: () => Promise.reject(new Error("Too many requests")) });

    await renderJoin();

    // Rate limiting is a "try again shortly", not a dead link.
    expect(await screen.findByText("Too many requests")).toBeInTheDocument();
  });

  it("offers no way to join", async () => {
    routeGet({ preview: () => notFound() });

    await renderJoin();

    await screen.findByText(/Can't use this link/);
    expect(screen.queryByRole("button", { name: /Join/ })).not.toBeInTheDocument();
  });
});

describe("a logged-out visitor", () => {
  it("is offered inline signup, defaulting to creating an account", async () => {
    await renderJoin();

    expect(
      await screen.findByText(/Create an account to join — no separate invite code needed\./),
    ).toBeInTheDocument();
  });

  it("is never asked for a separate invite code", async () => {
    await renderJoin();

    await screen.findByPlaceholderText("you@example.com");
    // The link is the authorization; asking for a second secret would defeat it.
    expect(screen.queryByPlaceholderText(/invite/i)).not.toBeInTheDocument();
  });

  it("signs up with the invite token as the gate", async () => {
    await renderJoin();

    await userEvent.type(await screen.findByPlaceholderText("Name (optional)"), "Akif");
    await userEvent.type(screen.getByPlaceholderText("you@example.com"), "akif@test.local");
    await userEvent.type(screen.getByPlaceholderText("Password (min 8 chars)"), "hunter2000");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(signup).toHaveBeenCalledWith({
      email: "akif@test.local",
      password: "hunter2000",
      name: "Akif",
      inviteCode: "invite-token",
    });
  });

  it("rejects a short password before calling the server", async () => {
    await renderJoin();

    await userEvent.type(await screen.findByPlaceholderText("you@example.com"), "a@b.c");
    await userEvent.type(screen.getByPlaceholderText("Password (min 8 chars)"), "short");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(toastError).toHaveBeenCalledWith("Password must be at least 8 characters");
    expect(signup).not.toHaveBeenCalled();
  });

  it("can switch to signing in instead", async () => {
    await renderJoin();

    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    expect(screen.getByText("Sign in to join this squad.")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Name (optional)")).not.toBeInTheDocument();
  });

  it("signs in with the existing account", async () => {
    await renderJoin();
    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));

    await userEvent.type(screen.getByPlaceholderText("you@example.com"), "akif@test.local");
    await userEvent.type(screen.getByPlaceholderText("Password"), "hunter2000");
    // In login mode the toggle reads "Create an account", so "Sign in" is unambiguous.
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(login).toHaveBeenCalledWith("akif@test.local", "hunter2000");
  });

  it("surfaces a failed signup", async () => {
    signup.mockRejectedValue(new Error("Email already registered"));
    await renderJoin();

    await userEvent.type(await screen.findByPlaceholderText("you@example.com"), "a@b.c");
    await userEvent.type(screen.getByPlaceholderText("Password (min 8 chars)"), "hunter2000");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Email already registered"));
  });

  it("falls back to a generic message for a non-Error rejection", async () => {
    signup.mockRejectedValue("just a string");
    await renderJoin();

    await userEvent.type(await screen.findByPlaceholderText("you@example.com"), "a@b.c");
    await userEvent.type(screen.getByPlaceholderText("Password (min 8 chars)"), "hunter2000");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Something went wrong"));
  });

  it("can switch back to creating an account", async () => {
    await renderJoin();

    await userEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await userEvent.click(screen.getByRole("button", { name: "Create an account" }));

    expect(screen.getByPlaceholderText("Name (optional)")).toBeInTheDocument();
  });

  it("ignores a programmatic re-submit while one is in flight", async () => {
    let release!: () => void;
    signup.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    await renderJoin();
    await userEvent.type(await screen.findByPlaceholderText("you@example.com"), "a@b.c");
    await userEvent.type(screen.getByPlaceholderText("Password (min 8 chars)"), "hunter2000");
    const form = screen.getByPlaceholderText("you@example.com").closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    await screen.findByRole("button", { name: "Please wait…" });

    fireEvent.submit(form);

    expect(signup).toHaveBeenCalledTimes(1);
    release();
  });

  it("waits for auth to resolve before choosing which panel to show", async () => {
    authState = { user: null, loading: true };

    const { container } = await renderJoin();

    await screen.findByRole("heading", { name: "Tuesday Run" });
    // Showing the signup form and then swapping it for a Join button would be a visible flash.
    expect(screen.queryByPlaceholderText("you@example.com")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".animate-spin").length).toBeGreaterThan(0);
  });
});

describe("joining", () => {
  beforeEach(() => {
    authState = { user: USER, loading: false };
  });

  it("offers a join button naming the squad", async () => {
    await renderJoin();

    expect(await screen.findByRole("button", { name: "Join Tuesday Run" })).toBeInTheDocument();
  });

  it("posts the token and stores the joined squad as the active scope", async () => {
    await renderJoin();

    await userEvent.click(await screen.findByRole("button", { name: "Join Tuesday Run" }));

    expect(post).toHaveBeenCalledWith("/api/squads/join/invite-token");
    // Every later request reads this key; leaving it unset would scope the identify step's
    // roster fetch to whatever squad was active before.
    await waitFor(() => expect(localStorage.getItem("activeSquadId")).toBe("squad-a"));
  });

  it("confirms a fresh join", async () => {
    await renderJoin();

    await userEvent.click(await screen.findByRole("button", { name: "Join Tuesday Run" }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Joined Tuesday Run"));
  });

  it("says so when you were already a member", async () => {
    post.mockResolvedValue({ success: true, data: { squadId: "squad-a", joined: false } });
    await renderJoin();

    await userEvent.click(await screen.findByRole("button", { name: "Join Tuesday Run" }));

    // Re-using a link you already accepted is not an error; it just needs honest wording.
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("You're already in Tuesday Run"));
  });

  it("moves on to the identify step", async () => {
    await joinAndIdentify();

    expect(screen.getByText(/You're in · Tuesday Run/)).toBeInTheDocument();
  });

  it("reports a failed join and allows a retry", async () => {
    post.mockRejectedValue(new Error("Invite already used"));
    await renderJoin();

    await userEvent.click(await screen.findByRole("button", { name: "Join Tuesday Run" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Invite already used"));
    expect(screen.getByRole("button", { name: "Join Tuesday Run" })).toBeEnabled();
  });

  it("falls back to a generic message when the error has none", async () => {
    post.mockRejectedValue(new Error(""));
    await renderJoin();

    await userEvent.click(await screen.findByRole("button", { name: "Join Tuesday Run" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not join"));
  });

  it("blocks a second click while joining", async () => {
    post.mockReturnValue(new Promise(() => {}));
    await renderJoin();

    await userEvent.click(await screen.findByRole("button", { name: "Join Tuesday Run" }));

    expect(await screen.findByRole("button", { name: "Joining…" })).toBeDisabled();
  });
});

describe("the identify step", () => {
  it("lists only unclaimed roster entries", async () => {
    await joinAndIdentify();

    expect(await screen.findByRole("button", { name: "Akif" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dylan" })).toBeInTheDocument();
    // Nillan is already linked to another user; offering them would guarantee a 409.
    expect(screen.queryByRole("button", { name: "Nillan" })).not.toBeInTheDocument();
  });

  it("claims the chosen entry and continues into the app", async () => {
    await joinAndIdentify();

    await userEvent.click(await screen.findByRole("button", { name: "Akif" }));

    expect(post).toHaveBeenCalledWith("/api/squads/squad-a/roster/claim", { mappingId: "m1" });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Identity claimed"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/" }));
  });

  it("reports a failed claim and re-enables the choices", async () => {
    await joinAndIdentify();
    post.mockRejectedValue(new Error("Already claimed by another member"));

    await userEvent.click(await screen.findByRole("button", { name: "Akif" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Already claimed by another member"),
    );
    expect(screen.getByRole("button", { name: "Akif" })).toBeEnabled();
  });

  it("falls back to a generic message when the claim error has none", async () => {
    await joinAndIdentify();
    post.mockRejectedValue(new Error(""));

    await userEvent.click(await screen.findByRole("button", { name: "Akif" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Could not claim"));
  });

  it("says nothing is claimable when the roster is fully linked", async () => {
    routeGet({
      roster: () => Promise.resolve({ success: true, data: [{ ...ROSTER[1] }] }),
    });

    await joinAndIdentify();

    expect(await screen.findByText(/No unclaimed roster entries yet/)).toBeInTheDocument();
  });

  it('offers "Continue" rather than "Skip" when there is nothing to claim', async () => {
    routeGet({ roster: () => Promise.resolve({ success: true, data: [] }) });

    await joinAndIdentify();

    // "Skip for now" implies you are declining something that exists.
    expect(await screen.findByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it('offers "Skip for now" when entries are available', async () => {
    await joinAndIdentify();

    expect(await screen.findByRole("button", { name: "Skip for now" })).toBeInTheDocument();
  });

  it("lets you skip straight into the app", async () => {
    await joinAndIdentify();

    await userEvent.click(await screen.findByRole("button", { name: "Skip for now" }));

    // Identifying is encouraged but never required — joining must not be gated on it.
    expect(navigate).toHaveBeenCalledWith({ to: "/" });
  });

  it("degrades to no entries when the roster fetch fails", async () => {
    routeGet({ roster: () => Promise.reject(new Error("db down")) });

    await joinAndIdentify();

    expect(await screen.findByText(/No unclaimed roster entries yet/)).toBeInTheDocument();
  });

  it("points at the games page for contributing existing games", async () => {
    await joinAndIdentify();

    // Contribute was folded into the games-list move action rather than built as its own
    // screen, so this link is the only signpost to it.
    expect(await screen.findByText("Games page")).toHaveAttribute("href", "/games");
  });
});
