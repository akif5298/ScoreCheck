/**
 * The upload batch — files, extraction status, review edits, and the save payload.
 *
 * Two areas carry real risk. computeReviewTeams builds the composite lineup string that is
 * written to BOTH games.homeTeam and every one of that side's players.team rows, and
 * lineupEfficiency later joins those on exact string equality — so a one-character change
 * here silently empties the lineup analytics rather than erroring. And the extraction pump
 * bounds concurrency against a single scale-to-zero GPU with a daily quota, so starting a
 * file twice costs a real extraction out of the user's allowance.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import {
  UploadSessionProvider,
  useUploadSession,
  computeReviewTeams,
  type ExtractedPlayer,
  type UploadResponse,
} from "@/contexts/upload-session";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

const post = vi.mocked(api.post);

function player(over: Partial<ExtractedPlayer> = {}): ExtractedPlayer {
  return {
    name: "Player",
    team: "Team A",
    teammateGrade: "B",
    position: "",
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
    fouls: 0,
    fgMade: 0,
    fgAttempted: 0,
    threeMade: 0,
    threeAttempted: 0,
    ftMade: 0,
    ftAttempted: 0,
    ...over,
  };
}

describe("computeReviewTeams", () => {
  it("groups players by their raw side key", () => {
    const teams = computeReviewTeams(
      [player({ team: "Team A" }), player({ team: "Team B" }), player({ team: "Team A" })],
      [],
    );

    expect(teams.map((t) => t.key)).toEqual(["Team A", "Team B"]);
    expect(teams[0].rows).toHaveLength(2);
  });

  it("keeps the original index on every row", () => {
    // The review table edits by index, so the mapping back has to survive grouping.
    const teams = computeReviewTeams(
      [player({ team: "Team A" }), player({ team: "Team B" }), player({ team: "Team A" })],
      [],
    );

    expect(teams[0].rows.map((r) => r.idx)).toEqual([0, 2]);
    expect(teams[1].rows.map((r) => r.idx)).toEqual([1]);
  });

  it("treats a blank side as Team A", () => {
    expect(computeReviewTeams([player({ team: "" })], [])[0].key).toBe("Team A");
  });

  it("sums each side's points into its score", () => {
    const teams = computeReviewTeams(
      [
        player({ team: "Team A", points: 12 }),
        player({ team: "Team A", points: 8 }),
        player({ team: "Team B", points: 30 }),
      ],
      [],
    );

    expect(teams[0].score).toBe(20);
    expect(teams[1].score).toBe(30);
  });

  it("counts an unparseable points value as zero rather than NaN", () => {
    // The review inputs are free text; one empty cell must not blank the whole score.
    const teams = computeReviewTeams(
      [player({ points: "" as unknown as number }), player({ points: 10 })],
      [],
    );

    expect(teams[0].score).toBe(10);
  });

  describe("naming a side", () => {
    const roster = ["Akif", "Nillan"];

    it("keeps the raw label when nobody on the side is on the roster", () => {
      const teams = computeReviewTeams([player({ team: "Team B", name: "Stranger" })], roster);

      // The opponent side stays "Team B" — naming it after its players would create a
      // lineup row for a team the user never plays as.
      expect(teams[0].displayName).toBe("Team B");
    });

    it("builds the composite lineup once one player is recognised", () => {
      const rows = [
        player({ name: "Akif", position: "PG" }),
        player({ name: "AI", position: "SG" }),
        player({ name: "Stranger", position: "SF" }),
        player({ name: "AI", position: "PF" }),
        player({ name: "Nillan", position: "C" }),
      ];

      // This exact string is stored on games.homeTeam and on all five players.team rows.
      expect(computeReviewTeams(rows, roster)[0].displayName).toBe(
        "Akif (PG) + AI (SG) + Random (SF) + AI (PF) + Nillan (C)",
      );
    });

    it("matches roster names case-insensitively and ignores surrounding space", () => {
      const teams = computeReviewTeams([player({ name: "  aKiF  ", position: "PG" })], roster);

      expect(teams[0].displayName).toBe("  aKiF   (PG)");
    });

    it("falls back to the slot position when the player carries none", () => {
      const rows = [player({ name: "Akif" }), player({ name: "Stranger" })];

      // Position comes from the roster slot, so the first player on a side is the PG.
      expect(computeReviewTeams(rows, roster)[0].displayName).toBe("Akif (PG) + Random (SG)");
    });

    it("uses N/A beyond the fifth slot", () => {
      const rows = [
        player({ name: "Akif" }),
        ...Array.from({ length: 5 }, () => player({ name: "X" })),
      ];

      expect(computeReviewTeams(rows, roster)[0].displayName).toMatch(/Random \(N\/A\)$/);
    });

    it("labels an unassigned player whose name contains 'ai' as AI", () => {
      const teams = computeReviewTeams(
        [player({ name: "Akif", position: "PG" }), player({ name: "Blaine", position: "SG" })],
        roster,
      );

      // A substring test, not an equality one — "Blaine" contains "ai", so a real opponent
      // is labelled AI. Shared verbatim with the backend's generateCustomTeamNamesAfter-
      // Assignment, so changing it here alone would make the two disagree. Pinned, not endorsed.
      expect(teams[0].displayName).toBe("Akif (PG) + AI (SG)");
    });

    it("labels an unassigned player whose name contains 'al' as AI", () => {
      const teams = computeReviewTeams(
        [player({ name: "Akif", position: "PG" }), player({ name: "Alan", position: "SG" })],
        roster,
      );

      expect(teams[0].displayName).toBe("Akif (PG) + AI (SG)");
    });

    it("names each side independently", () => {
      const teams = computeReviewTeams(
        [
          player({ team: "Team A", name: "Akif", position: "PG" }),
          player({ team: "Team B", name: "Nillan", position: "PG" }),
        ],
        roster,
      );

      expect(teams.map((t) => t.displayName)).toEqual(["Akif (PG)", "Nillan (PG)"]);
    });

    it("keeps both raw labels for an empty roster", () => {
      const teams = computeReviewTeams(
        [player({ team: "Team A", name: "Akif" }), player({ team: "Team B", name: "Nillan" })],
        [],
      );

      expect(teams.map((t) => t.displayName)).toEqual(["Team A", "Team B"]);
    });
  });

  it("returns nothing for no players", () => {
    expect(computeReviewTeams([], ["Akif"])).toEqual([]);
  });
});

// ── Provider ────────────────────────────────────────────────────────────────

let uuid = 0;

function pngFile(name = "IMG_0001.png"): File {
  return new File([new Uint8Array([1, 2, 3])], name, { type: "image/png" });
}

function uploadResponse(over: Partial<UploadResponse["extractedData"]> = {}): UploadResponse {
  return {
    extractedData: {
      homeTeam: "Team A",
      awayTeam: "Team B",
      homeScore: 20,
      awayScore: 30,
      players: [
        player({ name: "Akif", points: 20 }),
        player({ team: "Team B", name: "Opp", points: 30 }),
      ],
      ...over,
    },
    originalImageUrl: "squad/shot.png",
    originalFileName: "IMG_0001.png",
  };
}

/** A promise the test resolves by hand, for observing in-flight state. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Routes api.post by path so warmup, upload and save can behave differently. */
function routePost(handlers: { upload?: () => unknown; save?: () => unknown } = {}) {
  post.mockImplementation((path: string) => {
    if (path.includes("/warmup")) return Promise.resolve({ success: true });
    if (path.includes("/upload"))
      return (handlers.upload?.() ?? Promise.resolve(uploadResponse())) as never;
    if (path.includes("/save"))
      return (handlers.save?.() ?? Promise.resolve({ success: true })) as never;
    return Promise.resolve({}) as never;
  });
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <UploadSessionProvider>{children}</UploadSessionProvider>
);

function renderSession() {
  return renderHook(() => useUploadSession(), { wrapper });
}

beforeEach(() => {
  post.mockReset();
  uuid = 0;
  // jsdom implements neither, and both are called on every added file.
  URL.createObjectURL = vi.fn(() => `blob:preview-${++uuid}`);
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => `item-${++uuid}` });
  routePost();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useUploadSession outside a provider", () => {
  it("throws rather than handing back null", () => {
    expect(() => renderHook(() => useUploadSession())).toThrow(
      /must be used within an UploadSessionProvider/,
    );
  });
});

describe("warming the extraction host", () => {
  it("pokes the host as soon as the flow opens", async () => {
    renderSession();

    // Modal cold-starts in 70-85s; overlapping that with the user picking files is the
    // difference between a snappy upload and a minute of apparent hang.
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/screenshots/warmup"));
  });

  it("ignores a warmup failure", async () => {
    post.mockRejectedValue(new Error("host asleep"));

    // Fire-and-forget: the upload's own preflight still waits out a cold start.
    expect(() => renderSession()).not.toThrow();
    await waitFor(() => expect(post).toHaveBeenCalled());
  });
});

describe("addFiles", () => {
  it("adds png and jpeg files and reports the count", async () => {
    const { result } = renderSession();

    let added = 0;
    act(() => {
      added = result.current.addFiles([
        pngFile("a.png"),
        new File(["x"], "b.jpg", { type: "image/jpeg" }),
      ]);
    });

    expect(added).toBe(2);
    expect(result.current.items).toHaveLength(2);
  });

  it("rejects anything that is not an image", async () => {
    const { result } = renderSession();

    let added = 0;
    act(() => {
      added = result.current.addFiles([
        new File(["x"], "notes.pdf", { type: "application/pdf" }),
        new File(["x"], "clip.mp4", { type: "video/mp4" }),
      ]);
    });

    expect(added).toBe(0);
    expect(result.current.items).toEqual([]);
  });

  it("keeps only the image files from a mixed drop", async () => {
    const { result } = renderSession();

    act(() => {
      result.current.addFiles([
        pngFile(),
        new File(["x"], "notes.pdf", { type: "application/pdf" }),
      ]);
    });

    expect(result.current.items).toHaveLength(1);
  });

  it("returns zero for null", () => {
    const { result } = renderSession();

    expect(result.current.addFiles(null)).toBe(0);
  });

  it("makes a preview URL per file", async () => {
    const { result } = renderSession();

    act(() => {
      result.current.addFiles([pngFile("a.png"), pngFile("b.png")]);
    });

    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
    expect(result.current.items[0].previewUrl).toMatch(/^blob:/);
  });

  it("appends to an existing batch rather than replacing it", async () => {
    const { result } = renderSession();

    act(() => void result.current.addFiles([pngFile("a.png")]));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    act(() => void result.current.addFiles([pngFile("b.png")]));

    expect(result.current.items.map((i) => i.filename)).toEqual(["a.png", "b.png"]);
  });
});

describe("the extraction pump", () => {
  it("extracts at most two files at once", async () => {
    const gate = deferred<UploadResponse>();
    routePost({ upload: () => gate.promise });
    const { result } = renderSession();

    act(() => {
      result.current.addFiles([pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]);
    });

    await waitFor(() =>
      expect(result.current.items.filter((i) => i.status === "extracting")).toHaveLength(2),
    );
    // The third waits: the extraction host is one scale-to-zero GPU, and each call costs
    // against a per-user daily quota.
    expect(result.current.items[2].status).toBe("queued");

    await act(async () => {
      gate.resolve(uploadResponse());
    });
  });

  it("starts the next file as a slot frees up", async () => {
    const { result } = renderSession();

    act(() => {
      result.current.addFiles([pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]);
    });

    await waitFor(() => {
      expect(result.current.items.every((i) => i.status === "ready")).toBe(true);
    });
  });

  it("never extracts the same file twice", async () => {
    const { result } = renderSession();

    act(() => void result.current.addFiles([pngFile("a.png")]));
    await waitFor(() => expect(result.current.items[0].status).toBe("ready"));

    // Each extraction is a real GPU call against a per-user daily quota, so a second start
    // costs the user an upload. What prevents it is the status flip to "extracting" in the
    // same commit that selects the file — see the note below about processingRef.
    const uploads = post.mock.calls.filter(([p]) => String(p).includes("/upload"));
    expect(uploads).toHaveLength(1);
  });

  it("stores the extracted players and game data", async () => {
    const { result } = renderSession();

    act(() => void result.current.addFiles([pngFile()]));
    await waitFor(() => expect(result.current.items[0].status).toBe("ready"));

    expect(result.current.items[0].players).toHaveLength(2);
    expect(result.current.items[0].gameData).toEqual({
      homeTeam: "Team A",
      awayTeam: "Team B",
      homeScore: 20,
      awayScore: 30,
    });
  });

  it("defaults a missing grade and position to empty strings", async () => {
    routePost({
      upload: () =>
        Promise.resolve(
          uploadResponse({
            players: [{ name: "Akif", team: "Team A", points: 5 } as unknown as ExtractedPlayer],
          }),
        ),
    });
    const { result } = renderSession();

    act(() => void result.current.addFiles([pngFile()]));
    await waitFor(() => expect(result.current.items[0].status).toBe("ready"));

    // The review inputs are controlled; undefined would make React switch them to
    // uncontrolled and warn, then drop the user's first keystroke.
    expect(result.current.items[0].players[0]).toMatchObject({ teammateGrade: "", position: "" });
  });

  it("tolerates a response with no players array", async () => {
    routePost({
      upload: () =>
        Promise.resolve(uploadResponse({ players: undefined as unknown as ExtractedPlayer[] })),
    });
    const { result } = renderSession();

    act(() => void result.current.addFiles([pngFile()]));
    await waitFor(() => expect(result.current.items[0].status).toBe("ready"));

    expect(result.current.items[0].players).toEqual([]);
  });

  it("marks a failed extraction with the server's message", async () => {
    routePost({ upload: () => Promise.reject(new Error("Extraction service unavailable")) });
    const { result } = renderSession();

    act(() => void result.current.addFiles([pngFile()]));

    await waitFor(() => expect(result.current.items[0].status).toBe("error"));
    expect(result.current.items[0].errorMsg).toBe("Extraction service unavailable");
  });

  it("uses a fallback message when a non-Error is thrown", async () => {
    routePost({ upload: () => Promise.reject("just a string") });
    const { result } = renderSession();

    act(() => void result.current.addFiles([pngFile()]));

    await waitFor(() => expect(result.current.items[0].errorMsg).toBe("Extraction failed"));
  });

  it("keeps going after one file fails", async () => {
    let call = 0;
    routePost({
      upload: () =>
        ++call === 1 ? Promise.reject(new Error("boom")) : Promise.resolve(uploadResponse()),
    });
    const { result } = renderSession();

    act(() => void result.current.addFiles([pngFile("a.png"), pngFile("b.png")]));

    await waitFor(() => {
      expect(result.current.counts.error).toBe(1);
      expect(result.current.counts.ready).toBe(1);
    });
  });
});

describe("selection", () => {
  it("selects the first file immediately, before it has extracted", async () => {
    const gate = deferred<UploadResponse>();
    routePost({ upload: () => gate.promise });
    const { result } = renderSession();

    act(() => void result.current.addFiles([pngFile("a.png")]));

    // So the screenshot is on screen the moment the review page loads, rather than a
    // placeholder until extraction finishes.
    await waitFor(() => expect(result.current.selectedItem?.filename).toBe("a.png"));
    expect(result.current.selectedItem?.status).not.toBe("ready");

    await act(async () => {
      gate.resolve(uploadResponse());
    });
  });

  it("advances to the next ready file once the selected one is saved", async () => {
    const { result } = renderSession();
    act(() => void result.current.addFiles([pngFile("a.png"), pngFile("b.png")]));
    await waitFor(() => expect(result.current.counts.ready).toBe(2));

    await act(async () => {
      await result.current.save(["Akif"]);
    });

    expect(result.current.selectedItem?.filename).toBe("b.png");
  });

  it("clears the selection when the batch empties", async () => {
    const { result } = renderSession();
    act(() => void result.current.addFiles([pngFile()]));
    await waitFor(() => expect(result.current.selectedId).not.toBeNull());

    act(() => result.current.startOver());

    await waitFor(() => expect(result.current.selectedId).toBeNull());
  });

  it("re-selects when the selected file is removed", async () => {
    const { result } = renderSession();
    act(() => void result.current.addFiles([pngFile("a.png"), pngFile("b.png")]));
    await waitFor(() => expect(result.current.counts.ready).toBe(2));
    const firstId = result.current.items[0].id;

    act(() => result.current.removeItem(firstId));

    await waitFor(() => expect(result.current.selectedItem?.filename).toBe("b.png"));
  });

  it("select() moves to the requested file", async () => {
    const { result } = renderSession();
    act(() => void result.current.addFiles([pngFile("a.png"), pngFile("b.png")]));
    await waitFor(() => expect(result.current.counts.ready).toBe(2));

    act(() => result.current.select(result.current.items[1].id));

    expect(result.current.selectedItem?.filename).toBe("b.png");
  });
});

describe("review edits", () => {
  async function readySession() {
    const session = renderSession();
    act(() => void session.result.current.addFiles([pngFile()]));
    await waitFor(() => expect(session.result.current.items[0].status).toBe("ready"));
    return session;
  }

  it("renames a player by index", async () => {
    const { result } = await readySession();

    act(() => result.current.updatePlayerName(0, "Corrected"));

    expect(result.current.selectedItem?.players[0].name).toBe("Corrected");
  });

  it("leaves the other players untouched", async () => {
    const { result } = await readySession();

    act(() => result.current.updatePlayerName(0, "Corrected"));

    expect(result.current.selectedItem?.players[1].name).toBe("Opp");
  });

  it("updates a teammate grade", async () => {
    const { result } = await readySession();

    act(() => result.current.updateGrade(1, "A+"));

    expect(result.current.selectedItem?.players[1].teammateGrade).toBe("A+");
  });

  it("updates a single stat", async () => {
    const { result } = await readySession();

    act(() => result.current.updateStat(0, "rebounds", 14));

    expect(result.current.selectedItem?.players[0].rebounds).toBe(14);
  });

  it("edits only the selected file", async () => {
    const { result } = renderSession();
    act(() => void result.current.addFiles([pngFile("a.png"), pngFile("b.png")]));
    await waitFor(() => expect(result.current.counts.ready).toBe(2));

    act(() => result.current.updatePlayerName(0, "Corrected"));

    expect(result.current.items[0].players[0].name).toBe("Corrected");
    expect(result.current.items[1].players[0].name).toBe("Akif");
  });
});

describe("retry, remove and startOver", () => {
  it("re-queues a failed file and extracts it again", async () => {
    let call = 0;
    routePost({
      upload: () =>
        ++call === 1 ? Promise.reject(new Error("boom")) : Promise.resolve(uploadResponse()),
    });
    const { result } = renderSession();
    act(() => void result.current.addFiles([pngFile()]));
    await waitFor(() => expect(result.current.items[0].status).toBe("error"));

    act(() => result.current.retryItem(result.current.items[0].id));

    // Retry has to clear the processing guard too, or the pump never restarts the file.
    await waitFor(() => expect(result.current.items[0].status).toBe("ready"));
  });

  it("clears the previous error message on retry", async () => {
    routePost({ upload: () => Promise.reject(new Error("boom")) });
    const { result } = renderSession();
    act(() => void result.current.addFiles([pngFile()]));
    await waitFor(() => expect(result.current.items[0].status).toBe("error"));

    routePost({ upload: () => new Promise(() => {}) });
    act(() => result.current.retryItem(result.current.items[0].id));

    await waitFor(() => expect(result.current.items[0].errorMsg).toBeUndefined());
  });

  it("frees the preview URL when a file is removed", async () => {
    const { result } = renderSession();
    act(() => void result.current.addFiles([pngFile()]));
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    const url = result.current.items[0].previewUrl;

    act(() => result.current.removeItem(result.current.items[0].id));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(result.current.items).toEqual([]);
  });

  it("ignores a remove for an unknown id", async () => {
    const { result } = renderSession();
    act(() => void result.current.addFiles([pngFile()]));
    await waitFor(() => expect(result.current.items).toHaveLength(1));

    act(() => result.current.removeItem("no-such-id"));

    expect(result.current.items).toHaveLength(1);
  });

  it("startOver empties the batch and frees every preview", async () => {
    const { result } = renderSession();
    act(() => void result.current.addFiles([pngFile("a.png"), pngFile("b.png")]));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    act(() => result.current.startOver());

    expect(result.current.items).toEqual([]);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("frees every preview when the flow unmounts", async () => {
    const { result, unmount } = renderSession();
    act(() => void result.current.addFiles([pngFile("a.png"), pngFile("b.png")]));
    await waitFor(() => expect(result.current.items).toHaveLength(2));

    unmount();

    // Leaving /upload with a big batch open would otherwise hold every screenshot in memory
    // for the life of the tab.
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });
});

describe("counts and allSaved", () => {
  it("counts queued and extracting files as pending", async () => {
    routePost({ upload: () => new Promise(() => {}) });
    const { result } = renderSession();

    act(() => void result.current.addFiles([pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]));

    await waitFor(() => expect(result.current.counts.pending).toBe(3));
  });

  it("is not allSaved while anything is outstanding", async () => {
    const { result } = renderSession();
    act(() => void result.current.addFiles([pngFile("a.png"), pngFile("b.png")]));
    await waitFor(() => expect(result.current.counts.ready).toBe(2));

    await act(async () => {
      await result.current.save(["Akif"]);
    });

    expect(result.current.allSaved).toBe(false);
  });

  it("is allSaved only once every file is saved", async () => {
    const { result } = renderSession();
    act(() => void result.current.addFiles([pngFile("a.png"), pngFile("b.png")]));
    await waitFor(() => expect(result.current.counts.ready).toBe(2));

    await act(async () => {
      await result.current.save(["Akif"]);
    });
    await act(async () => {
      await result.current.save(["Akif"]);
    });

    expect(result.current.allSaved).toBe(true);
  });

  it("is not allSaved for an empty batch", () => {
    const { result } = renderSession();

    expect(result.current.allSaved).toBe(false);
  });
});

describe("save", () => {
  function savedPayload() {
    const call = post.mock.calls.find(([p]) => String(p).includes("/save"));
    return call?.[1] as {
      gameData: Record<string, unknown>;
      playersData: Record<string, unknown>[];
      imageUrl: string;
      originalFileName: string;
    };
  }

  async function readyToSave(players?: ExtractedPlayer[]) {
    if (players) routePost({ upload: () => Promise.resolve(uploadResponse({ players })) });
    const session = renderSession();
    act(() => void session.result.current.addFiles([pngFile()]));
    await waitFor(() => expect(session.result.current.items[0].status).toBe("ready"));
    return session;
  }

  it("does nothing when nothing is selected", async () => {
    const { result } = renderSession();

    await act(async () => {
      await result.current.save(["Akif"]);
    });

    expect(post.mock.calls.filter(([p]) => String(p).includes("/save"))).toHaveLength(0);
  });

  it("sends the composite lineup as the home team name", async () => {
    const { result } = await readyToSave([
      player({ team: "Team A", name: "Akif", position: "PG", points: 20 }),
      player({ team: "Team B", name: "Opp", position: "PG", points: 30 }),
    ]);

    await act(async () => {
      await result.current.save(["Akif"]);
    });

    expect(savedPayload().gameData).toEqual({
      homeTeam: "Akif (PG)",
      awayTeam: "Team B",
      homeScore: 20,
      awayScore: 30,
    });
  });

  it("writes the same string onto every player of that side", async () => {
    const { result } = await readyToSave([
      player({ team: "Team A", name: "Akif", position: "PG", points: 20 }),
      player({ team: "Team B", name: "Opp", position: "PG", points: 30 }),
    ]);

    await act(async () => {
      await result.current.save(["Akif"]);
    });

    // lineupEfficiency joins players.team to games.homeTeam on equality; if these two
    // strings ever differ the game silently vanishes from lineup analytics.
    const payload = savedPayload();
    expect(payload.playersData[0].team).toBe(payload.gameData.homeTeam);
    expect(payload.playersData[1].team).toBe(payload.gameData.awayTeam);
  });

  it("derives the scores from the players, not from the extracted header", async () => {
    const { result } = await readyToSave([
      player({ team: "Team A", name: "Akif", points: 11 }),
      player({ team: "Team A", name: "Nillan", points: 9 }),
      player({ team: "Team B", name: "Opp", points: 40 }),
    ]);

    await act(async () => {
      await result.current.save(["Akif"]);
    });

    // The header score is often misread; the sum of the rows the user just corrected is
    // the more trustworthy number.
    expect(savedPayload().gameData).toMatchObject({ homeScore: 20, awayScore: 40 });
  });

  it("sends every stat the review page can edit", async () => {
    const { result } = await readyToSave([player({ team: "Team A", name: "Akif", points: 20 })]);

    await act(async () => {
      await result.current.save(["Akif"]);
    });

    expect(Object.keys(savedPayload().playersData[0]).sort()).toEqual(
      [
        "assists",
        "blocks",
        "fgAttempted",
        "fgMade",
        "ftAttempted",
        "ftMade",
        "fouls",
        "name",
        "points",
        "rebounds",
        "steals",
        "team",
        "teammateGrade",
        "threeAttempted",
        "threeMade",
        "turnovers",
      ].sort(),
    );
  });

  it("passes the stored image reference back for the dedup check", async () => {
    const { result } = await readyToSave();

    await act(async () => {
      await result.current.save(["Akif"]);
    });

    expect(savedPayload()).toMatchObject({
      imageUrl: "squad/shot.png",
      originalFileName: "IMG_0001.png",
    });
  });

  it("marks the file saved", async () => {
    const { result } = await readyToSave();

    await act(async () => {
      await result.current.save(["Akif"]);
    });

    expect(result.current.items[0].status).toBe("saved");
  });

  it("records a save failure without losing the edits", async () => {
    routePost({
      save: () => Promise.reject(new Error("visually similar screenshot already saved")),
    });
    const { result } = await readyToSave();

    await act(async () => {
      await result.current.save(["Akif"]);
    });

    expect(result.current.items[0].status).toBe("error");
    expect(result.current.items[0].errorMsg).toBe("visually similar screenshot already saved");
    // The corrected players survive, so the user can retry rather than re-review.
    expect(result.current.items[0].players).toHaveLength(2);
  });

  it("uses a fallback message when a non-Error is thrown", async () => {
    routePost({ save: () => Promise.reject("just a string") });
    const { result } = await readyToSave();

    await act(async () => {
      await result.current.save(["Akif"]);
    });

    expect(result.current.items[0].errorMsg).toBe("Save failed");
  });

  it("falls back to the raw labels when the roster is empty", async () => {
    const { result } = await readyToSave();

    await act(async () => {
      await result.current.save([]);
    });

    expect(savedPayload().gameData).toMatchObject({ homeTeam: "Team A", awayTeam: "Team B" });
  });
});

/**
 * NOTE on processingRef: the pump also filters on `!processingRef.current.has(i.id)`, and
 * nothing here covers that clause. Removing it leaves all of these tests green, including
 * under StrictMode — because the pump marks the files "extracting" in the same commit that
 * selects them, so a re-run never sees them queued again. It is belt-and-braces against a
 * re-entrant render, not a reachable code path. Recorded rather than covered, because a
 * test that only passes with the clause present would have to fake a render order React
 * does not produce.
 */
describe("re-entrancy", () => {
  it("starts each file once under StrictMode's double-invoked effects", async () => {
    const strictWrapper = ({ children }: { children: ReactNode }) => (
      <StrictMode>
        <UploadSessionProvider>{children}</UploadSessionProvider>
      </StrictMode>
    );
    const { result } = renderHook(() => useUploadSession(), { wrapper: strictWrapper });

    act(() => void result.current.addFiles([pngFile("a.png"), pngFile("b.png")]));
    await waitFor(() => expect(result.current.counts.ready).toBe(2));

    // StrictMode is how the app runs in development, so this pins the property that
    // matters even though it does not isolate which mechanism delivers it.
    expect(post.mock.calls.filter(([p]) => String(p).includes("/upload"))).toHaveLength(2);
  });
});
