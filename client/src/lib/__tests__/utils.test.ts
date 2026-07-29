/**
 * `cn` is used by every component in the app to merge a base class list with per-call
 * overrides. The tailwind-merge half is the part worth testing: plain clsx would emit both
 * "p-2" and "p-4" and let CSS source order decide, which is not what any caller means.
 */
import { describe, it, expect } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins plain class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("lets a later tailwind class win over an earlier one in the same group", () => {
    // This is the whole reason for tailwind-merge: `cn("p-2", className)` must let a
    // caller's "p-4" replace the default rather than sit alongside it.
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("keeps classes from different groups", () => {
    expect(cn("p-2", "text-sm")).toBe("p-2 text-sm");
  });

  it("resolves a shorthand against its longhand", () => {
    // px-4 is more specific than p-2 on the horizontal axis, so both survive.
    expect(cn("p-2", "px-4")).toBe("p-2 px-4");
  });

  it("applies conditional object syntax", () => {
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });

  it("flattens arrays", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["false", false],
    ["an empty string", ""],
  ])("ignores %s", (_label, value) => {
    // Components pass `className` straight through, and it is usually undefined.
    expect(cn("base", value)).toBe("base");
  });

  it("returns an empty string for no input", () => {
    expect(cn()).toBe("");
  });

  it("handles the variant-prefixed form", () => {
    expect(cn("hover:bg-red-500", "hover:bg-blue-500")).toBe("hover:bg-blue-500");
  });

  it("does not merge across different variants", () => {
    expect(cn("bg-red-500", "hover:bg-blue-500")).toBe("bg-red-500 hover:bg-blue-500");
  });
});
