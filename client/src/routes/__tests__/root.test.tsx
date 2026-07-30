/**
 * The root route — document head, provider stack, and the two fallback screens.
 *
 * The provider nesting is load-bearing: SquadProvider reads useAuth, so it has to sit inside
 * AuthProvider, and both need the QueryClient above them. Get the order wrong and the app
 * throws "useAuth must be used within AuthProvider" on first paint with no other clue.
 *
 * The error screen is the one users see when everything else has failed, so it must not
 * depend on the app working — and it has to report the error out-of-band, since by then the
 * component that threw is gone.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const { invalidate, reportLovableError } = vi.hoisted(() => ({
  invalidate: vi.fn(),
  reportLovableError: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createRootRouteWithContext: () => (opts: Record<string, unknown>) => ({
    ...opts,
    useRouteContext: () => ({ queryClient: { mounted: true } }),
  }),
  Outlet: () => <div data-testid="outlet">page</div>,
  Link: ({ to, children }: { to: string; children: ReactNode; className?: string }) => (
    <a href={to}>{children}</a>
  ),
  useRouter: () => ({ invalidate }),
  HeadContent: () => <div data-testid="head-content" />,
  Scripts: () => <div data-testid="scripts" />,
}));

vi.mock("sonner", () => ({
  Toaster: (props: Record<string, unknown>) => (
    <div data-testid="toaster" data-position={String(props.position)} />
  ),
}));

vi.mock("@tanstack/react-query", () => ({
  QueryClient: class {},
  QueryClientProvider: ({ children }: { client: unknown; children: ReactNode }) => (
    <div data-testid="query-provider">{children}</div>
  ),
}));

vi.mock("@/contexts/auth-context", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="auth-provider">{children}</div>
  ),
}));

vi.mock("@/contexts/squad-context", () => ({
  SquadProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="squad-provider">{children}</div>
  ),
}));

vi.mock("@/lib/lovable-error-reporting", () => ({ reportLovableError }));

vi.mock("@/styles.css?url", () => ({ default: "/assets/styles.css" }));

import { Route } from "@/routes/__root";

interface RootRoute {
  head: () => {
    meta: Record<string, string>[];
    links: Record<string, string>[];
  };
  component: () => ReactNode;
  shellComponent: (props: { children: ReactNode }) => ReactNode;
  notFoundComponent: () => ReactNode;
  errorComponent: (props: { error: Error; reset: () => void }) => ReactNode;
}

const root = Route as unknown as RootRoute;

beforeEach(() => {
  invalidate.mockReset();
  reportLovableError.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("the document head", () => {
  it("declares a charset and viewport", () => {
    const { meta } = root.head();

    expect(meta).toContainEqual({ charSet: "utf-8" });
    expect(meta).toContainEqual({
      name: "viewport",
      content: "width=device-width, initial-scale=1",
    });
  });

  it("sets a default title and description", () => {
    const { meta } = root.head();

    expect(meta).toContainEqual({ title: "ScoreCheck — NBA 2K26 Box Score Tracker" });
    expect(meta.find((m) => m.name === "description")?.content).toMatch(/NBA 2K26/);
  });

  it("provides link-preview metadata", () => {
    const { meta } = root.head();

    // An invite link gets pasted into a group chat; without these it previews as a bare URL.
    expect(meta).toContainEqual({ property: "og:type", content: "website" });
    expect(meta).toContainEqual({ name: "twitter:card", content: "summary" });
    expect(meta.find((m) => m.property === "og:title")?.content).toMatch(/ScoreCheck/);
  });

  it("links the app stylesheet", () => {
    const { links } = root.head();

    expect(links).toContainEqual({ rel: "stylesheet", href: "/assets/styles.css" });
  });

  it("preconnects to the font hosts before requesting the font CSS", () => {
    const { links } = root.head();
    const preconnects = links.filter((l) => l.rel === "preconnect").map((l) => l.href);
    const fontSheet = links.findIndex((l) => l.href?.includes("fonts.googleapis.com/css2"));
    const firstPreconnect = links.findIndex((l) => l.rel === "preconnect");

    expect(preconnects).toEqual(["https://fonts.googleapis.com", "https://fonts.gstatic.com"]);
    // Ordering matters: a preconnect after the request it was meant to warm up is wasted.
    expect(firstPreconnect).toBeLessThan(fontSheet);
  });

  it("marks the gstatic preconnect anonymous, as fonts are fetched CORS", () => {
    const { links } = root.head();

    // Without crossOrigin the browser opens a second connection and the preconnect is moot.
    expect(links).toContainEqual({
      rel: "preconnect",
      href: "https://fonts.gstatic.com",
      crossOrigin: "anonymous",
    });
  });
});

describe("the provider stack", () => {
  it("nests query → auth → squad → page", () => {
    const RootComponent = root.component;

    render(<RootComponent />);

    const query = screen.getByTestId("query-provider");
    const auth = screen.getByTestId("auth-provider");
    const squad = screen.getByTestId("squad-provider");

    // SquadProvider calls useAuth, and both need the QueryClient — this exact order is what
    // keeps first paint from throwing.
    expect(query).toContainElement(auth);
    expect(auth).toContainElement(squad);
    expect(squad).toContainElement(screen.getByTestId("outlet"));
  });

  it("mounts the toaster inside the providers", () => {
    const RootComponent = root.component;

    render(<RootComponent />);

    // Toasts are fired from inside those contexts, so the Toaster has to outlive them.
    expect(screen.getByTestId("squad-provider")).toContainElement(screen.getByTestId("toaster"));
  });

  it("positions toasts bottom-right", () => {
    const RootComponent = root.component;

    render(<RootComponent />);

    expect(screen.getByTestId("toaster")).toHaveAttribute("data-position", "bottom-right");
  });
});

describe("the document shell", () => {
  it("renders the page and the hydration scripts", () => {
    const RootShell = root.shellComponent;

    render(<RootShell>{<div data-testid="page-body" />}</RootShell>);

    // Only these two are observable here. Rendering the <html>/<head>/<body> skeleton into
    // a container makes React 19 drop the <head> children outright, so <HeadContent /> is
    // absent from the DOM — that half of this component is exercised by the real prerender
    // (vite build), and by the CSP hash test in test/integration/serverApp.test.ts, which
    // reads the shell HTML the build actually produced.
    expect(screen.getByTestId("page-body")).toBeInTheDocument();
    expect(screen.getByTestId("scripts")).toBeInTheDocument();
  });

  it("puts the scripts after the page content, so hydration finds the markup", () => {
    const RootShell = root.shellComponent;

    const { container } = render(<RootShell>{<div data-testid="page-body" />}</RootShell>);
    const nodes = Array.from(container.children).map((el) => el.getAttribute("data-testid"));

    expect(nodes).toEqual(["page-body", "scripts"]);
  });
});

describe("the not-found screen", () => {
  it("says what happened", () => {
    const NotFound = root.notFoundComponent;

    render(<NotFound />);

    expect(screen.getByRole("heading", { level: 1, name: "404" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Page not found" })).toBeInTheDocument();
  });

  it("offers a way back", () => {
    const NotFound = root.notFoundComponent;

    render(<NotFound />);

    expect(screen.getByText("Go home")).toHaveAttribute("href", "/");
  });
});

describe("the error screen", () => {
  function renderError(error = new Error("render blew up")) {
    const ErrorComponent = root.errorComponent;
    const reset = vi.fn();
    render(<ErrorComponent error={error} reset={reset} />);
    return reset;
  }

  it("explains the failure without leaking the stack", () => {
    renderError(new Error("Cannot read property foo of undefined"));

    expect(screen.getByRole("heading", { name: "This page didn't load" })).toBeInTheDocument();
    // The message would mean nothing to the user and can carry internal detail.
    expect(screen.queryByText(/Cannot read property/)).not.toBeInTheDocument();
  });

  it("logs the error to the console for whoever is debugging", () => {
    const error = new Error("render blew up");

    renderError(error);

    expect(console.error).toHaveBeenCalledWith(error);
  });

  it("reports the error out of band, tagged with the boundary", () => {
    const error = new Error("render blew up");

    renderError(error);

    // The component that threw is gone by now, so this is the only place the failure can
    // be attributed to a route rather than to a generic 500.
    expect(reportLovableError).toHaveBeenCalledWith(error, {
      boundary: "tanstack_root_error_component",
    });
  });

  it("retries by invalidating the router and resetting the boundary", async () => {
    const reset = renderError();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    // Resetting alone re-renders the same stale data and fails again; the invalidate is
    // what makes "Try again" actually try something different.
    expect(invalidate).toHaveBeenCalled();
    expect(reset).toHaveBeenCalled();
  });

  it("offers a full page load home as the escape hatch", () => {
    renderError();

    // A plain anchor, not a Link: if the router is what broke, client-side navigation
    // cannot be trusted to get out.
    const home = screen.getByText("Go home");
    expect(home.tagName).toBe("A");
    expect(home).toHaveAttribute("href", "/");
  });
});
