/**
 * The app shell — sidebar, nav, breadcrumb, and the auth gate every page sits behind.
 *
 * The gate is the part that matters: AppShell redirects an unauthenticated visitor to
 * /login, which is exactly why the public join page must not use it. The nav's admin entry
 * is a visibility filter only — the server enforces the real check — but showing it to a
 * non-admin sends them to a page that 403s.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

let currentPath = "/";
const navigate = vi.fn();
const logout = vi.fn();
let authState: { user: unknown; loading: boolean } = { user: null, loading: false };

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: currentPath } }),
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ ...authState, logout }),
}));

vi.mock("@/components/squad-switcher", () => ({
  // The switcher has its own suite; here it only needs to be a placeholder.
  SquadSwitcher: () => <div data-testid="squad-switcher" />,
}));

import { AppShell, Card, Metric, Badge, nav } from "@/components/app-shell";

const USER = { id: "u1", email: "akif@test.local", name: "Akif Rahman", role: "USER" };

/** The sidebar nav. Scoped because the breadcrumb renders the same section names. */
function sidebar() {
  return within(screen.getByRole("navigation"));
}

/** The top bar, which holds the breadcrumb. */
function topBar() {
  return within(screen.getByRole("banner"));
}

function renderShell(props: Partial<Parameters<typeof AppShell>[0]> = {}) {
  return render(
    <AppShell title="Overview" {...props}>
      <p>page body</p>
    </AppShell>,
  );
}

beforeEach(() => {
  currentPath = "/";
  navigate.mockReset();
  logout.mockReset();
  authState = { user: USER, loading: false };
});

describe("the nav table", () => {
  it("has a unique two-digit code per entry", () => {
    const codes = nav.map((n) => n.code);

    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^\d{2}$/.test(c))).toBe(true);
  });

  it("has a unique route per entry", () => {
    const routes = nav.map((n) => n.to);

    expect(new Set(routes).size).toBe(routes.length);
  });

  it('calls the box-score section "Matchups", not "Teams"', () => {
    // "Teams" means box-score home/away rows, and next to "Squad" it reads as a synonym.
    expect(nav.find((n) => n.to === "/teams")?.label).toBe("Matchups");
  });
});

describe("the auth gate", () => {
  it("redirects to login once auth resolves with no user", () => {
    authState = { user: null, loading: false };

    renderShell();

    expect(navigate).toHaveBeenCalledWith({ to: "/login" });
  });

  it("renders nothing rather than a logged-out shell", () => {
    authState = { user: null, loading: false };

    const { container } = renderShell();

    // Painting the sidebar first and redirecting after would flash another user's nav.
    expect(container).toBeEmptyDOMElement();
  });

  it("waits while auth is still resolving", () => {
    authState = { user: null, loading: true };

    renderShell();

    // The token is confirmed against the server on mount; redirecting during that window
    // would bounce every signed-in user to /login on every page load.
    expect(navigate).not.toHaveBeenCalled();
  });

  it("renders the page once a user is present", () => {
    renderShell();

    expect(screen.getByText("page body")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("the page header", () => {
  it("shows the title", () => {
    renderShell({ title: "Analytics" });

    expect(screen.getByRole("heading", { level: 1, name: "Analytics" })).toBeInTheDocument();
  });

  it("shows the eyebrow and description when given", () => {
    // Not "Workspace" — the sidebar already labels its nav that, and the collision would
    // make this pass for the wrong reason.
    renderShell({ eyebrow: "Season 2026", description: "Everything at a glance" });

    expect(screen.getByText("Season 2026")).toBeInTheDocument();
    expect(screen.getByText("Everything at a glance")).toBeInTheDocument();
  });

  it("omits the description when not given", () => {
    renderShell();

    expect(screen.queryByText("Everything at a glance")).not.toBeInTheDocument();
  });

  it("renders action slots", () => {
    renderShell({ actions: <button>Export</button> });

    expect(screen.getByRole("button", { name: "Export" })).toBeInTheDocument();
  });
});

describe("the sidebar nav", () => {
  it("hides Admin from a non-admin", () => {
    renderShell();

    // Server-enforced too; this just avoids offering a link that 403s.
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  it("shows Admin to an admin", () => {
    authState = { user: { ...USER, role: "ADMIN" }, loading: false };

    renderShell();

    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("renders every non-admin entry", () => {
    renderShell();

    for (const entry of nav.filter((n) => n.to !== "/admin")) {
      expect(sidebar().getByText(entry.label)).toBeInTheDocument();
    }
  });

  it("marks the overview active only on an exact match", () => {
    currentPath = "/games";

    renderShell();

    expect(sidebar().getByText("Overview").closest("a")?.className).not.toContain("bg-primary");
  });

  it("marks the current section active", () => {
    currentPath = "/games";

    renderShell();

    expect(sidebar().getByText("Games").closest("a")?.className).toContain("bg-primary");
  });

  it("keeps the section active on a child route", () => {
    currentPath = "/games/abc123";

    // The detail page still belongs to Games; losing the highlight there reads as a
    // navigation bug.
    renderShell();

    expect(sidebar().getByText("Games").closest("a")?.className).toContain("bg-primary");
  });

  it("does not treat a prefix collision as active", () => {
    currentPath = "/gameshub";

    renderShell();

    expect(sidebar().getByText("Games").closest("a")?.className).not.toContain("bg-primary");
  });
});

describe("the user block", () => {
  it("builds initials from the name", () => {
    renderShell();

    expect(screen.getByText("AR")).toBeInTheDocument();
  });

  it("caps initials at two letters", () => {
    authState = { user: { ...USER, name: "Ana Bea Cara Dee" }, loading: false };

    renderShell();

    expect(screen.getByText("AB")).toBeInTheDocument();
  });

  it("falls back to ?? when the user has no name", () => {
    authState = { user: { ...USER, name: undefined }, loading: false };

    renderShell();

    expect(screen.getByText("??")).toBeInTheDocument();
  });

  it("shows the email when there is no name", () => {
    authState = { user: { ...USER, name: undefined }, loading: false };

    renderShell();

    expect(screen.getByText("akif@test.local")).toBeInTheDocument();
  });

  it("shows the role in lower case", () => {
    authState = { user: { ...USER, role: "ADMIN" }, loading: false };

    renderShell();

    expect(screen.getByText("admin")).toBeInTheDocument();
  });

  it("signs out and returns to login", async () => {
    renderShell();

    await userEvent.click(screen.getByTitle("Sign out"));

    expect(logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/login" });
  });
});

describe("the breadcrumb", () => {
  it.each([
    ["/", "Overview"],
    ["/upload", "Upload"],
    ["/games", "Games"],
    ["/teams", "Matchups"],
    ["/squad", "Squad"],
    ["/settings", "Settings"],
  ])("labels %s as %s", (path, label) => {
    currentPath = path;

    renderShell({ title: "unrelated title" });

    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  });

  it("shows a two-level trail on a game detail page", () => {
    currentPath = "/games/abc123";

    renderShell({ title: "Jul 29, 2026" });

    // The parent link is the only way back to the list on a page reached by deep link.
    expect(topBar().getByText("Game detail")).toBeInTheDocument();
    expect(topBar().getByText("Games").closest("a")).toHaveAttribute("href", "/games");
  });

  it("falls back to the product name for an unmapped route", () => {
    currentPath = "/nothing-here";

    renderShell();

    expect(screen.getAllByText("ScoreCheck").length).toBeGreaterThan(0);
  });
});

describe("Card", () => {
  it("renders its children", () => {
    render(<Card>inner</Card>);

    expect(screen.getByText("inner")).toBeInTheDocument();
  });

  it("renders a title, hint and action", () => {
    render(
      <Card title="Recent games" hint="last 10" action={<button>All</button>}>
        inner
      </Card>,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Recent games" })).toBeInTheDocument();
    expect(screen.getByText("last 10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
  });

  it("omits the header block entirely when there is nothing to put in it", () => {
    const { container } = render(<Card>inner</Card>);

    // An empty header would still take its margin and misalign every card without a title.
    expect(container.querySelector("h2")).toBeNull();
  });

  it.each([
    ["default", "p-6"],
    ["tight", "p-4"],
  ])("applies %s padding", (padding, expected) => {
    const { container } = render(<Card padding={padding as "default" | "tight"}>inner</Card>);

    expect(container.querySelector("section")?.className).toContain(expected);
  });

  it("applies no padding when asked for none", () => {
    const { container } = render(<Card padding="none">inner</Card>);
    const className = container.querySelector("section")?.className ?? "";

    expect(className).not.toMatch(/\bp-6\b/);
    expect(className).not.toMatch(/\bp-4\b/);
  });

  it("merges a caller's className", () => {
    const { container } = render(<Card className="col-span-2">inner</Card>);

    expect(container.querySelector("section")?.className).toContain("col-span-2");
  });
});

describe("Metric", () => {
  it("renders the label and value", () => {
    render(<Metric label="Games" value={38} />);

    expect(screen.getByText("Games")).toBeInTheDocument();
    expect(screen.getByText("38")).toBeInTheDocument();
  });

  it("accepts a preformatted string value", () => {
    render(<Metric label="FG%" value="47.2%" />);

    expect(screen.getByText("47.2%")).toBeInTheDocument();
  });

  it("shows a hint when given", () => {
    render(<Metric label="Games" value={38} hint="this season" />);

    expect(screen.getByText("this season")).toBeInTheDocument();
  });

  it("colours a positive delta as success", () => {
    render(<Metric label="PPG" value={24} delta={{ value: "+2.1", positive: true }} />);

    expect(screen.getByText("+2.1").className).toContain("text-success");
  });

  it("colours a negative delta as destructive", () => {
    render(<Metric label="PPG" value={24} delta={{ value: "-2.1", positive: false }} />);

    expect(screen.getByText("-2.1").className).toContain("text-destructive");
  });

  it("treats an unspecified direction as success", () => {
    // Only an explicit `positive: false` is negative, so a delta with no direction reads
    // as neutral-good rather than alarming.
    render(<Metric label="PPG" value={24} delta={{ value: "+0.0" }} />);

    expect(screen.getByText("+0.0").className).toContain("text-success");
  });
});

describe("Badge", () => {
  it("renders its children", () => {
    render(<Badge>saved</Badge>);

    expect(screen.getByText("saved")).toBeInTheDocument();
  });

  it.each([
    ["default", "bg-secondary"],
    ["success", "text-success"],
    ["warning", "text-warning"],
    ["primary", "bg-primary"],
    ["danger", "text-destructive"],
    ["outline", "border-border"],
  ])("styles the %s tone", (tone, expected) => {
    render(<Badge tone={tone as "default"}>x</Badge>);

    expect(screen.getByText("x").className).toContain(expected);
  });
});
