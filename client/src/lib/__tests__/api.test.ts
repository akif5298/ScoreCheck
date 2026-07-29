/**
 * The API client — the single chokepoint every request passes through.
 *
 * Two things here are load-bearing and easy to break silently: the X-Squad-Id header, which
 * is what scopes every read and write to the right squad, and the FormData branch, which
 * must NOT set Content-Type so the browser can add the multipart boundary. Getting the
 * latter wrong makes every screenshot upload fail with a parse error on the server.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { api, ACTIVE_SQUAD_KEY } from "@/lib/api";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  setLocation("/games");
});

/** jsdom refuses real navigation, so location is replaced with a spy-able stand-in. */
function setLocation(pathname: string): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...window.location, pathname, assign },
  });
  return assign;
}

function ok(body: unknown = { success: true }) {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => body });
}

function fails(status: number, body: unknown = { error: "nope" }, statusText = "Error") {
  fetchMock.mockResolvedValue({
    ok: false,
    status,
    statusText,
    json: async () => body,
  });
}

/** The init object the code passed to fetch on its most recent call. */
function lastInit(): RequestInit & { headers: Record<string, string> } {
  return fetchMock.mock.calls.at(-1)?.[1] as RequestInit & { headers: Record<string, string> };
}

describe("headers", () => {
  it("sends no Authorization when logged out", async () => {
    ok();

    await api.get("/api/games");

    expect(lastInit().headers["Authorization"]).toBeUndefined();
  });

  it("sends the stored token as a bearer", async () => {
    localStorage.setItem("token", "jwt-value");
    ok();

    await api.get("/api/games");

    expect(lastInit().headers["Authorization"]).toBe("Bearer jwt-value");
  });

  it("sends the active squad as X-Squad-Id", async () => {
    localStorage.setItem(ACTIVE_SQUAD_KEY, "squad-a");
    ok();

    await api.get("/api/games");

    expect(lastInit().headers["X-Squad-Id"]).toBe("squad-a");
  });

  it("omits X-Squad-Id when no squad is active", async () => {
    ok();

    await api.get("/api/games");

    // Omitted rather than empty: the server falls back to the user's stored activeSquadId,
    // so a fresh session is scoped correctly before the switcher has written anything.
    expect(lastInit().headers).not.toHaveProperty("X-Squad-Id");
  });

  it("reads localStorage per request, not once at import", async () => {
    ok();
    await api.get("/api/games");
    expect(lastInit().headers["X-Squad-Id"]).toBeUndefined();

    localStorage.setItem(ACTIVE_SQUAD_KEY, "squad-b");
    await api.get("/api/games");

    // The switcher writes the key and reloads; a cached header would send the old scope.
    expect(lastInit().headers["X-Squad-Id"]).toBe("squad-b");
  });

  it("sets a JSON content type for ordinary requests", async () => {
    ok();

    await api.post("/api/games", { a: 1 });

    expect(lastInit().headers["Content-Type"]).toBe("application/json");
  });

  it("sets no content type for FormData, so the browser can add the boundary", async () => {
    ok();
    const form = new FormData();
    form.append("screenshot", new Blob(["x"]), "shot.png");

    await api.post("/api/screenshots/upload", form);

    // Setting it by hand omits the multipart boundary, and every upload fails to parse.
    expect(lastInit().headers).not.toHaveProperty("Content-Type");
  });

  it("passes FormData through without stringifying it", async () => {
    ok();
    const form = new FormData();

    await api.post("/api/screenshots/upload", form);

    expect(lastInit().body).toBe(form);
  });

  it("still authenticates and scopes a FormData request", async () => {
    localStorage.setItem("token", "jwt-value");
    localStorage.setItem(ACTIVE_SQUAD_KEY, "squad-a");
    ok();

    await api.post("/api/screenshots/upload", new FormData());

    expect(lastInit().headers).toMatchObject({
      Authorization: "Bearer jwt-value",
      "X-Squad-Id": "squad-a",
    });
  });
});

describe("verbs", () => {
  it.each([
    ["get", () => api.get("/api/games"), undefined, undefined],
    ["post", () => api.post("/api/games", { a: 1 }), "POST", '{"a":1}'],
    ["put", () => api.put("/api/games/1", { a: 1 }), "PUT", '{"a":1}'],
    ["patch", () => api.patch("/api/games/1", { a: 1 }), "PATCH", '{"a":1}'],
    ["del", () => api.del("/api/games/1"), "DELETE", undefined],
  ])("%s sends the right method and body", async (_label, call, method, body) => {
    ok();

    await call();

    expect(lastInit().method).toBe(method);
    expect(lastInit().body).toBe(body);
  });

  it("returns the parsed JSON body", async () => {
    ok({ success: true, data: [{ id: "g1" }] });

    await expect(api.get("/api/games")).resolves.toEqual({
      success: true,
      data: [{ id: "g1" }],
    });
  });

  it("serialises an undefined post body as undefined, not as a literal", async () => {
    ok();

    await api.post("/api/screenshots/warmup");

    // JSON.stringify(undefined) is undefined, so fetch sends no body at all — which is
    // what the warmup endpoint expects.
    expect(lastInit().body).toBeUndefined();
  });
});

describe("error responses", () => {
  it("throws with the server's error message", async () => {
    fails(400, { error: "Validation error" });

    await expect(api.get("/api/games")).rejects.toThrow("Validation error");
  });

  it("attaches the status so callers can branch on it", async () => {
    fails(409, { error: "Duplicate entry" });

    await expect(api.get("/api/games")).rejects.toMatchObject({ status: 409 });
  });

  it("falls back to a generic message when the body has no error field", async () => {
    fails(500, { something: "else" });

    await expect(api.get("/api/games")).rejects.toThrow("Request failed");
  });

  it("uses statusText when the error body is not JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });

    // A proxy returning an HTML error page is the usual cause, and "Unexpected token <"
    // tells the user nothing.
    await expect(api.get("/api/games")).rejects.toThrow("Bad Gateway");
  });
});

describe("expired sessions", () => {
  it("clears the session and redirects on a 401", async () => {
    const assign = setLocation("/games");
    localStorage.setItem("token", "stale");
    localStorage.setItem("user", "{}");
    fails(401, { error: "Authentication failed" });

    await expect(api.get("/api/games")).rejects.toThrow();

    expect(localStorage.getItem("token")).toBeNull();
    expect(localStorage.getItem("user")).toBeNull();
    expect(assign).toHaveBeenCalledWith("/login");
  });

  it("leaves the session alone for a 401 from an auth route", async () => {
    const assign = setLocation("/login");
    localStorage.setItem("token", "current");
    fails(401, { error: "Invalid credentials" });

    await expect(api.post("/api/auth/login", {})).rejects.toThrow("Invalid credentials");

    // A wrong password on the login form must surface as a message, not as a redirect
    // loop that discards the session the user is trying to create.
    expect(localStorage.getItem("token")).toBe("current");
    expect(assign).not.toHaveBeenCalled();
  });

  it("does not redirect when already on the login page", async () => {
    const assign = setLocation("/login");
    fails(401, { error: "Authentication failed" });

    await expect(api.get("/api/games")).rejects.toThrow();

    expect(assign).not.toHaveBeenCalled();
  });

  it.each([403, 404, 500])("does not clear the session on a %i", async (status) => {
    const assign = setLocation("/games");
    localStorage.setItem("token", "current");
    fails(status, { error: "nope" });

    await expect(api.get("/api/games")).rejects.toThrow();

    // Only 401 means the session is bad. Clearing on a 403 would log the user out every
    // time they touched another squad's resource.
    expect(localStorage.getItem("token")).toBe("current");
    expect(assign).not.toHaveBeenCalled();
  });
});
