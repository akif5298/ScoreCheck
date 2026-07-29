/**
 * Out-of-band error capture.
 *
 * server.ts uses this to recover the original stack after h3 has already swallowed a throw
 * into a generic 500 Response. It is a single-slot, one-shot buffer with a TTL — all three
 * of those properties matter, and all three are easy to break without noticing, since a
 * regression only shows up as a less useful error page.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { consumeLastCapturedError } from "@/lib/error-capture";

/** jsdom has ErrorEvent; PromiseRejectionEvent is not constructible, so it is faked. */
function dispatchError(error: unknown): void {
  globalThis.dispatchEvent(new ErrorEvent("error", { error }));
}

function dispatchRejection(reason: unknown): void {
  const event = new Event("unhandledrejection") as Event & { reason?: unknown };
  event.reason = reason;
  globalThis.dispatchEvent(event);
}

beforeEach(() => {
  // The buffer is module state and survives between tests; drain whatever is left.
  consumeLastCapturedError();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("capturing", () => {
  it("returns undefined when nothing has been captured", () => {
    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("captures the error from a global error event", () => {
    const error = new Error("render blew up");

    dispatchError(error);

    expect(consumeLastCapturedError()).toBe(error);
  });

  it("captures the reason from an unhandled rejection", () => {
    const reason = new Error("fetch rejected");

    dispatchRejection(reason);

    expect(consumeLastCapturedError()).toBe(reason);
  });

  it("falls back to the event when it carries no error", () => {
    // Some browsers dispatch a bare error event for cross-origin script failures; keeping
    // the event is more useful than dropping the signal entirely.
    globalThis.dispatchEvent(new ErrorEvent("error"));

    expect(consumeLastCapturedError()).toBeInstanceOf(Event);
  });

  it("keeps only the most recent error", () => {
    const first = new Error("first");
    const second = new Error("second");

    dispatchError(first);
    dispatchError(second);

    // One slot, not a queue: the page renders one error, and the latest is the relevant one.
    expect(consumeLastCapturedError()).toBe(second);
  });

  it("captures a non-Error rejection reason", () => {
    dispatchRejection("a string reason");

    expect(consumeLastCapturedError()).toBe("a string reason");
  });
});

describe("consuming", () => {
  it("empties the slot, so the same error is never reported twice", () => {
    dispatchError(new Error("once"));

    expect(consumeLastCapturedError()).toBeDefined();
    // A second page render must not resurface an error from the previous request.
    expect(consumeLastCapturedError()).toBeUndefined();
  });
});

describe("the TTL", () => {
  it("returns an error captured just under the 5s window", () => {
    vi.useFakeTimers();
    dispatchError(new Error("recent"));

    vi.advanceTimersByTime(4_999);

    expect(consumeLastCapturedError()).toBeInstanceOf(Error);
  });

  it("discards an error older than the window", () => {
    vi.useFakeTimers();
    dispatchError(new Error("stale"));

    vi.advanceTimersByTime(5_001);

    // Without the TTL, an error from one request would be attached to an unrelated 500
    // minutes later, pointing whoever reads it at the wrong place entirely.
    expect(consumeLastCapturedError()).toBeUndefined();
  });

  it("clears the slot when the TTL expires, rather than leaving it to rot", () => {
    vi.useFakeTimers();
    dispatchError(new Error("stale"));
    vi.advanceTimersByTime(5_001);
    consumeLastCapturedError();

    // Even rewinding cannot bring it back — expiry deletes rather than hides.
    vi.setSystemTime(Date.now() - 10_000);
    expect(consumeLastCapturedError()).toBeUndefined();
  });
});
