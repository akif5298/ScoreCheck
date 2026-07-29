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
