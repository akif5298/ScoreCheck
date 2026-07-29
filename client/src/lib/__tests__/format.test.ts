/**
 * Date formatting. Deliberately hand-rolled rather than toLocaleDateString, because the
 * SPA shell is prerendered and a locale-dependent string differs between the prerender and
 * the browser, which React reports as a hydration mismatch.
 */
import { describe, it, expect } from "vitest";
import { formatDate } from "@/lib/format";

describe("formatDate", () => {
  it("formats a date-only ISO string", () => {
    expect(formatDate("2026-07-29")).toBe("Jul 29");
  });

  it("adds the year on request", () => {
    expect(formatDate("2026-07-29", { year: true })).toBe("Jul 29, 2026");
  });

  it.each([
    ["2026-01-05", "Jan 5"],
    ["2026-12-31", "Dec 31"],
  ])("handles the month boundaries: %s", (iso, expected) => {
    expect(formatDate(iso)).toBe(expected);
  });

  it("does not zero-pad the day", () => {
    expect(formatDate("2026-03-07")).toBe("Mar 7");
  });

  it("never consults the local timezone", () => {
    // The string is split, not parsed into a Date, so a user in UTC-5 sees the same day as
    // the server. Parsing "2026-07-29" with new Date() would shift it to the 28th for them.
    expect(formatDate("2026-01-01", { year: true })).toBe("Jan 1, 2026");
  });

  it("accepts a full ISO timestamp, which is what the API actually returns", () => {
    // Previously "Jul NaN": splitting on "-" left "29T17:58:53.735Z" as the day. All six
    // call sites worked around it with their own .slice(0, 10), so the contract was
    // enforced six times and the seventh caller would have rendered NaN into the UI.
    expect(formatDate("2026-07-29T17:58:53.735Z")).toBe("Jul 29");
    expect(formatDate("2026-07-29T17:58:53.735Z", { year: true })).toBe("Jul 29, 2026");
  });

  it.each([
    ["2026-07-29T00:00:00.000Z", "2026-07-29"],
    ["2026-01-05T23:59:59Z", "2026-01-05"],
  ])("formats %s exactly as it formats %s", (timestamp, dateOnly) => {
    expect(formatDate(timestamp, { year: true })).toBe(formatDate(dateOnly, { year: true }));
  });

  it("is unchanged by a caller that still slices first", () => {
    // The existing .slice(0, 10) at every call site is now redundant but harmless, so those
    // files need no edit to benefit.
    const iso = "2026-07-29T17:58:53.735Z";

    expect(formatDate(iso.slice(0, 10), { year: true })).toBe(formatDate(iso, { year: true }));
  });

  it("produces a nonsense month for an unparseable string", () => {
    expect(formatDate("not-a-date")).toBe("undefined NaN");
  });

  it("falls back to January when the month segment is missing", () => {
    // The `?? 1` default only catches an absent segment, not an unparseable one.
    expect(formatDate("2026")).toBe("Jan undefined");
  });
});
