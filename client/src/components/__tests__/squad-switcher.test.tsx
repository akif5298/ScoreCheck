/**
 * The active-squad switcher.
 *
 * Load-bearing rather than decorative: uploads target the active squad, so the label on this
 * control is the user's only indication of where a screenshot is about to land. Misreading it
 * files a game with the wrong group, which then needs the move flow to undo.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// vi.mock factories are hoisted above every const in the file, and sonner's reads its spy
// eagerly rather than inside a function — so these have to be hoisted alongside it.
const { navigate, switchSquad, toastError } = vi.hoisted(() => ({
  navigate: vi.fn(),
  switchSquad: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));
vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

let squadState: {
  squads: Squad[];
  activeSquad: Squad | null;
  loading: boolean;
};

vi.mock("@/contexts/squad-context", () => ({
  useSquads: () => ({ ...squadState, switchSquad, refresh: vi.fn() }),
}));

import { SquadSwitcher } from "@/components/squad-switcher";
import { api } from "@/lib/api";
import type { Squad } from "@/contexts/squad-context";

const post = vi.mocked(api.post);

function squad(over: Partial<Squad> = {}): Squad {
  return {
    id: "squad-a",
    name: "Tuesday Run",
    isPersonal: false,
    role: "OWNER",
    memberCount: 3,
    gameCount: 12,
    isActive: true,
    ...over,
  };
}

/** Opens the dropdown and returns once its content is on screen. */
async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: /Tuesday Run|Personal|My games/ }));
  return screen.findByRole("menu");
}

beforeEach(() => {
  navigate.mockReset();
  switchSquad.mockReset();
  toastError.mockReset();
  post.mockReset();
  post.mockResolvedValue({ success: true, data: { id: "squad-new" } });
  const active = squad();
  squadState = { squads: [active], activeSquad: active, loading: false };
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...window.location, pathname: "/", assign: vi.fn() },
  });
});

describe("while squads are loading", () => {
  it("shows a placeholder instead of an empty control", () => {
    squadState = { squads: [], activeSquad: null, loading: true };

    const { container } = render(<SquadSwitcher />);

    // A control that briefly says nothing reads as "no squad", which is alarming on the
    // one element that tells you where your uploads go.
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });
});

describe("when no squad could be resolved", () => {
  it("renders nothing rather than a broken control", () => {
    squadState = { squads: [], activeSquad: null, loading: false };

    const { container } = render(<SquadSwitcher />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("the trigger", () => {
  it("names the active squad", () => {
    render(<SquadSwitcher />);

    expect(screen.getByText("Tuesday Run")).toBeInTheDocument();
  });

  it("shows two-letter initials", () => {
    render(<SquadSwitcher />);

    expect(screen.getByText("TU")).toBeInTheDocument();
  });

  it("shows the member count", () => {
    render(<SquadSwitcher />);

    expect(screen.getByText("3 members")).toBeInTheDocument();
  });

  it("uses the singular for one member", () => {
    const active = squad({ memberCount: 1 });
    squadState = { squads: [active], activeSquad: active, loading: false };

    render(<SquadSwitcher />);

    expect(screen.getByText("1 member")).toBeInTheDocument();
  });

  it('labels a personal squad "Personal" rather than counting it', () => {
    // Named something other than "Personal" so the subtitle is what this asserts on, not
    // the squad name echoing it back.
    const active = squad({ isPersonal: true, name: "My games", memberCount: 1 });
    squadState = { squads: [active], activeSquad: active, loading: false };

    render(<SquadSwitcher />);

    expect(screen.getByText("My games")).toBeInTheDocument();
    expect(screen.getByText("Personal")).toBeInTheDocument();
  });
});

describe("the squad list", () => {
  beforeEach(() => {
    const active = squad({ id: "squad-a", name: "Tuesday Run" });
    squadState = {
      squads: [
        active,
        squad({ id: "squad-b", name: "Sunday League", gameCount: 7, isActive: false }),
      ],
      activeSquad: active,
      loading: false,
    };
  });

  it("lists every squad", async () => {
    render(<SquadSwitcher />);

    const menu = await openMenu();

    expect(within(menu).getByText("Sunday League")).toBeInTheDocument();
  });

  it("ticks the active squad", async () => {
    render(<SquadSwitcher />);

    const menu = await openMenu();

    expect(within(menu).getByText("✓")).toBeInTheDocument();
  });

  it("shows the game count on the others, as the reason to switch", async () => {
    render(<SquadSwitcher />);

    const menu = await openMenu();

    expect(within(menu).getByText("7g")).toBeInTheDocument();
  });

  it("switches when another squad is chosen", async () => {
    render(<SquadSwitcher />);

    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Sunday League"));

    expect(switchSquad).toHaveBeenCalledWith("squad-b");
  });

  it("does nothing when the active squad is chosen", async () => {
    render(<SquadSwitcher />);

    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Tuesday Run"));

    // Switching reloads the whole app; doing that for a no-op change would look like a crash.
    expect(switchSquad).not.toHaveBeenCalled();
  });

  it("marks a personal squad in the list", async () => {
    const active = squad({ id: "squad-a" });
    squadState = {
      squads: [active, squad({ id: "p", name: "Personal", isPersonal: true, isActive: false })],
      activeSquad: active,
      loading: false,
    };
    render(<SquadSwitcher />);

    const menu = await openMenu();

    expect(within(menu).getByText("personal")).toBeInTheDocument();
  });
});

describe("managing the squad", () => {
  it("offers management for a shared squad", async () => {
    render(<SquadSwitcher />);

    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("Manage this squad"));

    expect(navigate).toHaveBeenCalledWith({ to: "/squad" });
  });

  it("hides management for a personal squad", async () => {
    const active = squad({ isPersonal: true, name: "Personal" });
    squadState = { squads: [active], activeSquad: active, loading: false };
    render(<SquadSwitcher />);

    const menu = await openMenu();

    // There are no members or invites to manage in a squad of one.
    expect(within(menu).queryByText("Manage this squad")).not.toBeInTheDocument();
  });
});

describe("creating a squad", () => {
  async function openCreateDialog() {
    render(<SquadSwitcher />);
    const menu = await openMenu();
    await userEvent.click(within(menu).getByText("+ Create squad"));
    return screen.findByRole("dialog");
  }

  it("opens a dialog", async () => {
    const dialog = await openCreateDialog();

    expect(within(dialog).getByText("Create a squad")).toBeInTheDocument();
  });

  it("keeps Create disabled until a name is typed", async () => {
    const dialog = await openCreateDialog();

    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("keeps Create disabled for whitespace only", async () => {
    const dialog = await openCreateDialog();

    await userEvent.type(within(dialog).getByRole("textbox"), "   ");

    expect(within(dialog).getByRole("button", { name: "Create" })).toBeDisabled();
  });

  it("creates, activates and lands on the squad page", async () => {
    const dialog = await openCreateDialog();

    await userEvent.type(within(dialog).getByRole("textbox"), "Sunday League");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(post).toHaveBeenCalledWith("/api/squads", { name: "Sunday League" });
    // Storing the id before activating means the reload is already scoped correctly.
    expect(localStorage.getItem("activeSquadId")).toBe("squad-new");
    expect(post).toHaveBeenCalledWith("/api/squads/squad-new/activate");
    expect(window.location.assign).toHaveBeenCalledWith("/squad");
  });

  it("trims the name before sending it", async () => {
    const dialog = await openCreateDialog();

    await userEvent.type(within(dialog).getByRole("textbox"), "  Sunday League  ");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(post).toHaveBeenCalledWith("/api/squads", { name: "Sunday League" });
  });

  it("submits on Enter", async () => {
    const dialog = await openCreateDialog();

    await userEvent.type(within(dialog).getByRole("textbox"), "Sunday League{Enter}");

    expect(post).toHaveBeenCalledWith("/api/squads", { name: "Sunday League" });
  });

  it("caps the name length", async () => {
    const dialog = await openCreateDialog();

    expect(within(dialog).getByRole("textbox")).toHaveAttribute("maxlength", "60");
  });

  it("surfaces a failure as a toast and re-enables the form", async () => {
    post.mockRejectedValue(new Error("Squad name already taken"));
    const dialog = await openCreateDialog();

    await userEvent.type(within(dialog).getByRole("textbox"), "Sunday League");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(toastError).toHaveBeenCalledWith("Squad name already taken");
    // Leaving it stuck on "Creating…" would strand the user with no way to retry.
    expect(within(dialog).getByRole("button", { name: "Create" })).toBeEnabled();
  });

  it("falls back to a generic message when the error has none", async () => {
    post.mockRejectedValue(new Error(""));
    const dialog = await openCreateDialog();

    await userEvent.type(within(dialog).getByRole("textbox"), "Sunday League");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));

    expect(toastError).toHaveBeenCalledWith("Could not create squad");
  });

  it("refuses to close while the create request is in flight", async () => {
    post.mockReturnValue(new Promise(() => {}));
    const dialog = await openCreateDialog();
    await userEvent.type(within(dialog).getByRole("textbox"), "Sunday League");
    await userEvent.click(within(dialog).getByRole("button", { name: "Create" }));
    // The label flips once the request is in flight, which is how we know busy is set.
    expect(await within(dialog).findByRole("button", { name: "Creating…" })).toBeDisabled();

    await userEvent.keyboard("{Escape}");

    // Dismissing mid-create would leave the squad created but the app never switched into
    // it, with no feedback that anything happened.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("closes on Cancel without creating anything", async () => {
    const dialog = await openCreateDialog();

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(post).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
