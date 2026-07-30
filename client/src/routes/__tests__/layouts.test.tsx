/**
 * The two layout routes.
 *
 * `games.tsx` is a bare pass-through. `upload.tsx` is not: it hosts the UploadSessionProvider
 * for the whole upload flow, and that placement is the only reason a batch survives the hop
 * from the dropzone to the review workspace. Move the provider into either child and every
 * in-flight extraction is thrown away on navigation — which is exactly the kind of regression
 * a four-line file invites.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  Outlet: () => <div data-testid="outlet">child route</div>,
}));

vi.mock("@/contexts/upload-session", () => ({
  UploadSessionProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="session-provider">{children}</div>
  ),
}));

import { Route as GamesLayout } from "@/routes/games";
import { Route as UploadLayout } from "@/routes/upload";

function componentOf(route: unknown) {
  return (route as { component: () => ReactNode }).component;
}

describe("the games layout", () => {
  it("renders its child route and nothing else", () => {
    const Layout = componentOf(GamesLayout);

    render(<Layout />);

    // The list and the detail page each bring their own AppShell, so this exists only to
    // give /games and /games/$gameId a common parent segment.
    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });
});

describe("the upload layout", () => {
  it("renders its child route", () => {
    const Layout = componentOf(UploadLayout);

    render(<Layout />);

    expect(screen.getByTestId("outlet")).toBeInTheDocument();
  });

  it("wraps the child in the upload session provider", () => {
    const Layout = componentOf(UploadLayout);

    render(<Layout />);

    // Nesting order is the whole point: the provider must be the parent, so it stays
    // mounted while the child swaps from the dropzone to the review workspace.
    const provider = screen.getByTestId("session-provider");
    expect(provider).toContainElement(screen.getByTestId("outlet"));
  });
});
