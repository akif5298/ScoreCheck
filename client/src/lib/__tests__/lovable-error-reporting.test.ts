/**
 * Error reporting to the Lovable host page.
 *
 * The reporter is entirely optional — the hook may be absent (self-hosted, or the script
 * blocked) — so the contract is that it never throws. A crash inside the error boundary's
 * own reporter replaces a handled error with an unhandled one.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { reportLovableError } from "@/lib/lovable-error-reporting";

const captureException = vi.fn();

beforeEach(() => {
  captureException.mockReset();
  delete (window as { __lovableEvents?: unknown }).__lovableEvents;
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...window.location, pathname: "/games" },
  });
});

describe("when the host hook is absent", () => {
  it("does nothing and does not throw", () => {
    // Optional chaining all the way down; this is the self-hosted case.
    expect(() => reportLovableError(new Error("boom"))).not.toThrow();
  });

  it("tolerates the hook object existing without the method", () => {
    window.__lovableEvents = {};

    expect(() => reportLovableError(new Error("boom"))).not.toThrow();
  });
});

describe("when the host hook is present", () => {
  beforeEach(() => {
    window.__lovableEvents = { captureException };
  });

  it("forwards the error", () => {
    const error = new Error("render blew up");

    reportLovableError(error);

    expect(captureException).toHaveBeenCalledWith(error, expect.anything(), expect.anything());
  });

  it("tags the source and the route", () => {
    reportLovableError(new Error("boom"));

    // The route is what makes a report actionable — the same stack from /upload and
    // /analytics are different bugs.
    expect(captureException.mock.calls[0][1]).toMatchObject({
      source: "react_error_boundary",
      route: "/games",
    });
  });

  it("merges caller context over the defaults", () => {
    reportLovableError(new Error("boom"), { source: "manual", componentStack: "at Foo" });

    expect(captureException.mock.calls[0][1]).toMatchObject({
      source: "manual",
      componentStack: "at Foo",
      route: "/games",
    });
  });

  it("marks the error unhandled at error severity", () => {
    reportLovableError(new Error("boom"));

    // It reached the error boundary, so from the user's point of view nothing handled it.
    expect(captureException.mock.calls[0][2]).toEqual({
      mechanism: "react_error_boundary",
      handled: false,
      severity: "error",
    });
  });

  it("reports the current route, read per call", () => {
    reportLovableError(new Error("first"));
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: { ...window.location, pathname: "/upload/review" },
    });

    reportLovableError(new Error("second"));

    expect(captureException.mock.calls[1][1]).toMatchObject({ route: "/upload/review" });
  });

  it("forwards a non-Error value unchanged", () => {
    reportLovableError("a string was thrown");

    expect(captureException.mock.calls[0][0]).toBe("a string was thrown");
  });
});
