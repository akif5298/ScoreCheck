/**
 * Session storage. Small, but every request and every route guard reads it, and the one
 * bug this module has already had — logout leaving activeSquadId behind, so the next user
 * on the same browser sent someone else's squad id — was invisible until someone shared a
 * machine.
 */
import { describe, it, expect } from "vitest";
import {
  getToken,
  getStoredUser,
  setSession,
  clearSession,
  isAuthenticated,
  type AuthUser,
} from "@/lib/auth";

const USER: AuthUser = {
  id: "u1",
  email: "akif@test.local",
  name: "Akif",
  role: "USER",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("getToken", () => {
  it("returns null when nothing is stored", () => {
    expect(getToken()).toBeNull();
  });

  it("returns the stored token", () => {
    localStorage.setItem("token", "jwt-value");

    expect(getToken()).toBe("jwt-value");
  });
});

describe("getStoredUser", () => {
  it("returns null when nothing is stored", () => {
    expect(getStoredUser()).toBeNull();
  });

  it("parses the stored user", () => {
    localStorage.setItem("user", JSON.stringify(USER));

    expect(getStoredUser()).toEqual(USER);
  });

  it("returns null rather than throwing on corrupt JSON", () => {
    localStorage.setItem("user", "{not json");

    // A half-written entry would otherwise throw during render and blank the whole app,
    // with no way for the user to recover short of clearing site data by hand.
    expect(getStoredUser()).toBeNull();
  });

  it("returns null for an empty string", () => {
    localStorage.setItem("user", "");

    expect(getStoredUser()).toBeNull();
  });
});

describe("setSession", () => {
  it("stores the token and the user together", () => {
    setSession("jwt-value", USER);

    expect(localStorage.getItem("token")).toBe("jwt-value");
    expect(JSON.parse(localStorage.getItem("user") as string)).toEqual(USER);
  });

  it("round-trips through the getters", () => {
    setSession("jwt-value", USER);

    expect(getToken()).toBe("jwt-value");
    expect(getStoredUser()).toEqual(USER);
  });

  it("overwrites a previous session", () => {
    setSession("first", USER);
    setSession("second", { ...USER, id: "u2", email: "other@test.local" });

    expect(getToken()).toBe("second");
    expect(getStoredUser()?.id).toBe("u2");
  });
});

describe("clearSession", () => {
  it("removes the token and the user", () => {
    setSession("jwt-value", USER);

    clearSession();

    expect(getToken()).toBeNull();
    expect(getStoredUser()).toBeNull();
  });

  it("clears the active squad, so the next user does not inherit this scope", () => {
    setSession("jwt-value", USER);
    localStorage.setItem("activeSquadId", "squad-a");

    clearSession();

    // Leaving it set makes the next login send a squad the user is not a member of, and
    // the server answers 404 until the squad list reloads. This is a fixed regression.
    expect(localStorage.getItem("activeSquadId")).toBeNull();
  });

  it("clears the legacy demoUser key", () => {
    localStorage.setItem("demoUser", "{}");

    clearSession();

    expect(localStorage.getItem("demoUser")).toBeNull();
  });

  it("is safe to call when nothing is stored", () => {
    expect(() => clearSession()).not.toThrow();
  });

  it("leaves unrelated keys alone", () => {
    localStorage.setItem("theme", "dark");

    clearSession();

    expect(localStorage.getItem("theme")).toBe("dark");
  });
});

describe("isAuthenticated", () => {
  it("is true only with both a token and a user", () => {
    setSession("jwt-value", USER);

    expect(isAuthenticated()).toBe(true);
  });

  it.each([
    ["nothing stored", () => {}],
    ["only a token", () => localStorage.setItem("token", "jwt-value")],
    ["only a user", () => localStorage.setItem("user", JSON.stringify(USER))],
    [
      "a token and a corrupt user",
      () => {
        localStorage.setItem("token", "jwt-value");
        localStorage.setItem("user", "{not json");
      },
    ],
  ])("is false with %s", (_label, arrange) => {
    arrange();

    // Half a session is not a session: the app shell reads the user for the sidebar, so
    // treating a token alone as authenticated renders a logged-in shell with no identity.
    expect(isAuthenticated()).toBe(false);
  });
});
