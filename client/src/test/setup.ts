import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => {
  // Unmount anything still rendered. Without this a component that sets state on an
  // interval keeps running into the next test and reports as a leak there instead.
  cleanup();
  // Auth token, stored user and the active squad all live in localStorage, and every one of
  // them changes what the next test's requests look like.
  localStorage.clear();
  vi.restoreAllMocks();
});

/**
 * jsdom implements neither the Pointer Events capture API nor ResizeObserver, and Radix's
 * dropdown/dialog/select primitives call both while opening. Without these, every menu in
 * the app throws "target.hasPointerCapture is not a function" the moment a test clicks it.
 */
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
