/**
 * The squad management page — members, roster identity, and invite links.
 *
 * Invite tokens are credentials: anyone holding one can join the squad and read every shared
 * game, so the list of them is owner-only and revocation has to be immediate. The roster
 * claim is the other load-bearing bit — it sets PlayerMapping.linkedUserId, which is the only
 * thing that ties "Akif" in one squad to "AK" in another for the career view.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { toastError, toastSuccess, toastMessage } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  toastMessage: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
}));

vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess, message: toastMessage },
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({
    children,
    title,
    description,
  }: {
    children: ReactNode;
    title: string;
    description?: string;
  }) => (
    <div>
      <h1>{title}</h1>
      <p data-testid="description">{description}</p>
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
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...rest }: { children: ReactNode }) => <button {...rest}>{children}</button>,
}));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

let squadState: {
  activeSquad: { id: string; name: string; isPersonal: boolean; role: string } | null;
  loading: boolean;
};

vi.mock("@/contexts/squad-context", () => ({ useSquads: () => squadState }));

import { Route } from "@/routes/squad";
import { api } from "@/lib/api";

const SquadPage = (Route as unknown as { component: () => ReactNode }).component;
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const del = vi.mocked(api.del);

const MEMBERS = [
  {
    userId: "u1",
    // Deliberately different from the roster displayName below: the same string in both
    // places collides with the claim button and the "identified as" line.
    name: "Akif Rahman",
    email: "akif@test.local",
    role: "OWNER",
    joinedAt: "2026-01-15T00:00:00.000Z",
    displayName: "Akif",
    gamertag: "GRIM_AR15",
    uploadedGames: 24,
  },
  {
    userId: "u2",
    name: null,
    email: "nillan@test.local",
    role: "MEMBER",
    joinedAt: "2026-02-20T00:00:00.000Z",
    displayName: null,
    gamertag: null,
    uploadedGames: 3,
  },
];

const ROSTER = [
  { id: "m1", gamertag: "GRIM_AR15", displayName: "Akif", linkedUserId: "u1", isYou: true },
  { id: "m2", gamertag: "nilly", displayName: "Nillan", linkedUserId: "u9", isYou: false },
  { id: "m3", gamertag: "dyl", displayName: "Dylan", linkedUserId: null, isYou: false },
];

/** An invite that is live: not revoked, and expiring well in the future. */
function invite(over: Record<string, unknown> = {}) {
  return {
    id: "i1",
    token: "tok-abc",
    expiresAt: "2099-01-01T00:00:00.000Z",
    maxUses: 0,
    usedCount: 0,
    revokedAt: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over,
  };
}

function routeGet(
  handlers: { members?: () => unknown; roster?: () => unknown; invites?: () => unknown } = {},
) {
  get.mockImplementation((path: string) => {
    if (path.endsWith("/members")) {
      return (handlers.members?.() ?? Promise.resolve({ success: true, data: MEMBERS })) as never;
    }
    if (path.endsWith("/roster")) {
      return (handlers.roster?.() ?? Promise.resolve({ success: true, data: ROSTER })) as never;
    }
    if (path.endsWith("/invites")) {
      return (handlers.invites?.() ??
        Promise.resolve({ success: true, data: [invite()] })) as never;
    }
    return Promise.resolve({ success: true, data: [] }) as never;
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SquadPage />
    </QueryClientProvider>,
  );
}

async function renderLoaded() {
  const result = renderPage();
  await waitFor(() => expect(result.container.querySelector(".animate-spin")).toBeNull());
  return result;
}

const writeText = vi.fn();

beforeEach(() => {
  toastError.mockReset();
  toastSuccess.mockReset();
  toastMessage.mockReset();
  get.mockReset();
  post.mockReset().mockResolvedValue({ success: true, data: invite({ token: "tok-new" }) });
  del.mockReset().mockResolvedValue({ success: true });
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  squadState = {
    activeSquad: { id: "squad-a", name: "Tuesday Run", isPersonal: false, role: "OWNER" },
    loading: false,
  };
  routeGet();
});

describe("the route definition", () => {
  it("sets a title and description", () => {
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();

    expect(head.meta[0]).toEqual({ title: "Squad — ScoreCheck" });
  });
});

describe("before a squad resolves", () => {
  it("shows a spinner while squads load", () => {
    squadState = { activeSquad: null, loading: true };

    const { container } = renderPage();

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("says so when there is no active squad", async () => {
    squadState = { activeSquad: null, loading: false };

    await renderLoaded();

    expect(screen.getByText("No squad selected.")).toBeInTheDocument();
  });

  it("fetches nothing without a squad", async () => {
    squadState = { activeSquad: null, loading: false };

    await renderLoaded();

    expect(get).not.toHaveBeenCalled();
  });
});

describe("a personal squad", () => {
  beforeEach(() => {
    squadState = {
      activeSquad: { id: "p", name: "Personal", isPersonal: true, role: "OWNER" },
      loading: false,
    };
  });

  it("explains what a squad is instead of showing management UI", async () => {
    await renderLoaded();

    expect(screen.getByRole("heading", { level: 1, name: "Personal space" })).toBeInTheDocument();
    expect(screen.getByText(/Create a squad from the switcher/)).toBeInTheDocument();
  });

  it("offers no members, roster or invites", async () => {
    await renderLoaded();

    // There is nobody to manage and no invites to leak in a squad of one.
    expect(screen.queryByLabelText("Members")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Invite links")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });
});

describe("the members table", () => {
  it("counts members in the description", async () => {
    await renderLoaded();

    await waitFor(() =>
      expect(screen.getByTestId("description")).toHaveTextContent(
        "2 members sharing games and analytics.",
      ),
    );
  });

  it("names each member, falling back to the email", async () => {
    await renderLoaded();

    expect(await screen.findByText("Akif Rahman")).toBeInTheDocument();
    expect(screen.getByText("nillan@test.local")).toBeInTheDocument();
  });

  it("builds initials from a name", async () => {
    await renderLoaded();

    expect(await screen.findByText("AR")).toBeInTheDocument();
  });

  it("builds initials from an email when there is no name", async () => {
    await renderLoaded();

    // "nillan@test.local" splits on @ and . into nillan/test/local → "NT".
    expect(await screen.findByText("NT")).toBeInTheDocument();
  });

  it("shows when each member joined", async () => {
    await renderLoaded();

    expect(await screen.findByText("joined Jan 15, 2026")).toBeInTheDocument();
  });

  it("shows the roster identity, or a dash when unclaimed", async () => {
    await renderLoaded();

    const row = (await screen.findByText("nillan@test.local")).closest("tr") as HTMLElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
  });

  it("shows each member's upload count", async () => {
    await renderLoaded();

    // Attribution is what makes the delete permission legible to the group.
    expect(await screen.findByText("24")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("labels roles in lower case", async () => {
    await renderLoaded();

    expect(await screen.findByText("owner")).toBeInTheDocument();
    expect(screen.getByText("member")).toBeInTheDocument();
  });

  it("uses the singular for a one-member squad", async () => {
    routeGet({ members: () => Promise.resolve({ success: true, data: [MEMBERS[0]] }) });

    await renderLoaded();

    await waitFor(() =>
      expect(screen.getByTestId("description")).toHaveTextContent("1 member sharing"),
    );
  });
});

describe("claiming a roster identity", () => {
  it("says who you already are", async () => {
    await renderLoaded();

    expect(await screen.findByText(/You're identified as/)).toBeInTheDocument();
  });

  it("prompts when you have not claimed anything", async () => {
    routeGet({
      roster: () => Promise.resolve({ success: true, data: [{ ...ROSTER[2] }] }),
    });

    await renderLoaded();

    expect(await screen.findByText(/You haven't picked your player yet/)).toBeInTheDocument();
  });

  it("marks your own entry and disables re-claiming it", async () => {
    await renderLoaded();

    const yours = await screen.findByRole("button", { name: "Akif ✓" });
    expect(yours).toBeDisabled();
  });

  it("disables an entry another member has claimed", async () => {
    await renderLoaded();

    const taken = await screen.findByRole("button", { name: "Nillan" });
    expect(taken).toBeDisabled();
    // The [squadId, linkedUserId] unique constraint would reject it anyway.
    expect(taken).toHaveAttribute("title", "Already claimed by another member");
  });

  it("claims an unclaimed entry", async () => {
    await renderLoaded();

    await userEvent.click(await screen.findByRole("button", { name: "Dylan" }));

    expect(post).toHaveBeenCalledWith("/api/squads/squad-a/roster/claim", { mappingId: "m3" });
  });

  it("confirms the new identity by name", async () => {
    post.mockResolvedValue({ success: true, data: { ...ROSTER[2], displayName: "Dylan" } });
    await renderLoaded();

    await userEvent.click(await screen.findByRole("button", { name: "Dylan" }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("You're now Dylan on this roster"),
    );
  });

  it("surfaces a rejected claim", async () => {
    post.mockRejectedValue(new Error("Already claimed by another member"));
    await renderLoaded();

    await userEvent.click(await screen.findByRole("button", { name: "Dylan" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Already claimed by another member"),
    );
  });

  it("explains an empty roster rather than showing nothing", async () => {
    routeGet({ roster: () => Promise.resolve({ success: true, data: [] }) });

    await renderLoaded();

    expect(await screen.findByText(/No roster entries yet/)).toBeInTheDocument();
  });
});

describe("invite links", () => {
  it("are hidden from a plain member", async () => {
    squadState.activeSquad = {
      id: "squad-a",
      name: "Tuesday Run",
      isPersonal: false,
      role: "MEMBER",
    };

    await renderLoaded();

    await screen.findByText("Akif Rahman");
    // A token is a credential; listing them to every member hands out squad access.
    expect(screen.queryByLabelText("Invite links")).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining("/invites"));
  });

  it("are shown to the owner", async () => {
    await renderLoaded();

    expect(await screen.findByText(/\/join\/tok-abc$/)).toBeInTheDocument();
  });

  it("renders a full joinable URL, not just the token", async () => {
    await renderLoaded();

    expect(await screen.findByText(`${window.location.origin}/join/tok-abc`)).toBeInTheDocument();
  });

  it("hides a revoked link", async () => {
    routeGet({
      invites: () =>
        Promise.resolve({ success: true, data: [invite({ revokedAt: "2026-07-02T00:00:00Z" })] }),
    });

    await renderLoaded();

    // Revocation is immediate; still showing the link would invite someone to share a dead one.
    expect(await screen.findByText(/No active invite links/)).toBeInTheDocument();
  });

  it("hides an expired link", async () => {
    routeGet({
      invites: () =>
        Promise.resolve({ success: true, data: [invite({ expiresAt: "2020-01-01T00:00:00Z" })] }),
    });

    await renderLoaded();

    expect(await screen.findByText(/No active invite links/)).toBeInTheDocument();
  });

  it('describes an unlimited link as "unlimited"', async () => {
    await renderLoaded();

    expect(await screen.findByText(/unlimited · expires Jan 1, 2099/)).toBeInTheDocument();
  });

  it("shows usage against the cap for a limited link", async () => {
    routeGet({
      invites: () =>
        Promise.resolve({ success: true, data: [invite({ maxUses: 5, usedCount: 2 })] }),
    });

    await renderLoaded();

    expect(await screen.findByText(/2\/5 used · expires/)).toBeInTheDocument();
  });

  it("creates a link and copies it straight to the clipboard", async () => {
    await renderLoaded();

    await userEvent.click(await screen.findByRole("button", { name: "New invite link" }));

    expect(post).toHaveBeenCalledWith("/api/squads/squad-a/invites", {});
    // Copying on create is the whole flow — the link is useless until it is pasted somewhere.
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/tok-new`),
    );
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Invite link copied to clipboard"),
    );
  });

  it("shows the link in a toast when the clipboard is unavailable", async () => {
    writeText.mockRejectedValue(new Error("Permission denied"));
    await renderLoaded();

    await userEvent.click(await screen.findByRole("button", { name: "New invite link" }));

    // Insecure contexts and Firefox permission prompts both land here; losing the token
    // entirely would mean creating another one.
    await waitFor(() =>
      expect(toastMessage).toHaveBeenCalledWith("Invite link", {
        description: `${window.location.origin}/join/tok-new`,
      }),
    );
  });

  it("surfaces a failed create", async () => {
    post.mockRejectedValue(new Error("Only the owner can create invites"));
    await renderLoaded();

    await userEvent.click(await screen.findByRole("button", { name: "New invite link" }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Only the owner can create invites"),
    );
  });

  it("copies an existing link on demand", async () => {
    await renderLoaded();

    await userEvent.click(await screen.findByRole("button", { name: "Copy" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/tok-abc`),
    );
  });

  it("revokes a link", async () => {
    await renderLoaded();

    await userEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    expect(del).toHaveBeenCalledWith("/api/squads/squad-a/invites/i1");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Invite revoked"));
  });

  it("surfaces a failed revoke", async () => {
    del.mockRejectedValue(new Error("Invite not found"));
    await renderLoaded();

    await userEvent.click(await screen.findByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Invite not found"));
  });

  it("prompts to create one when there are none", async () => {
    routeGet({ invites: () => Promise.resolve({ success: true, data: [] }) });

    await renderLoaded();

    expect(await screen.findByText(/No active invite links/)).toBeInTheDocument();
  });

  it("shows progress while creating", async () => {
    post.mockReturnValue(new Promise(() => {}));
    await renderLoaded();

    await userEvent.click(await screen.findByRole("button", { name: "New invite link" }));

    expect(await screen.findByRole("button", { name: "Creating…" })).toBeDisabled();
  });
});
