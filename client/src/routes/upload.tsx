import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell, Card, Badge } from "@/components/app-shell";
import { api } from "@/lib/api";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload box scores — ScoreCheck" },
      {
        name: "description",
        content:
          "Drop several 2K26 screenshots, review each auto-extracted box score, and commit them to your league.",
      },
    ],
  }),
  component: UploadPage,
});

interface ExtractedPlayer {
  id?: string;
  name: string;
  team: string;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fgMade: number;
  fgAttempted: number;
  threeMade: number;
  threeAttempted: number;
  ftMade: number;
  ftAttempted: number;
}

interface UploadResponse {
  extractedData: {
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    players: ExtractedPlayer[];
  };
  originalImageUrl: string;
  originalFileName: string;
}

type ItemStatus = "queued" | "extracting" | "ready" | "saving" | "saved" | "error";

interface GameData {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

interface UploadItem {
  id: string;
  file: File;
  filename: string;
  previewUrl: string;
  status: ItemStatus;
  errorMsg?: string;
  uploadData?: UploadResponse;
  players: ExtractedPlayer[];
  gameData: GameData;
}

// How many screenshots extract at once. The extraction host is a single scale-to-zero GPU
// with a daily quota, so a small cap keeps a couple moving without flooding one cold start.
const CONCURRENCY = 2;

function UploadPage() {
  // Assignable names come from the user's gamertag mappings (roster page).
  const { data: mappings = [] } = useQuery({
    queryKey: ["mappings"],
    queryFn: () =>
      api
        .get<{ success: boolean; data: { id: string; gamertag: string; displayName: string }[] }>(
          "/api/mappings",
        )
        .then((r) => r.data),
  });
  const allowedNames = Array.from(new Set(mappings.map((m) => m.displayName))).sort();

  const navigate = useNavigate();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Ids whose extraction has been kicked off — guards the pump effect against starting the
  // same file twice across re-renders (and React StrictMode's double-invoked effects).
  const processingRef = useRef<Set<string>>(new Set());
  // Mirror of items for the unmount cleanup, so that effect need not depend on items.
  const itemsRef = useRef<UploadItem[]>([]);
  itemsRef.current = items;

  // Revoke every preview object URL on unmount so a big batch doesn't leak.
  useEffect(() => {
    return () => {
      for (const it of itemsRef.current) URL.revokeObjectURL(it.previewUrl);
    };
  }, []);

  // Poke the extraction host the moment this page opens, so Modal's ~70-85s cold
  // start (container boot + loading the models into VRAM) overlaps with the user
  // picking and reviewing files rather than stalling the first extraction. Fire-and-
  // forget: a failure is a non-event — the upload's own preflight still waits out a
  // cold start if this didn't land — and the server throttles repeat pokes.
  useEffect(() => {
    api.post("/api/screenshots/warmup").catch(() => {});
  }, []);

  const extractItem = useCallback(async (id: string, file: File) => {
    try {
      const form = new FormData();
      form.append("screenshot", file);
      const result = await api.post<UploadResponse>("/api/screenshots/upload", form);
      setItems((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                status: "ready",
                uploadData: result,
                players: result.extractedData.players ?? [],
                gameData: {
                  homeTeam: result.extractedData.homeTeam ?? "",
                  awayTeam: result.extractedData.awayTeam ?? "",
                  homeScore: result.extractedData.homeScore ?? 0,
                  awayScore: result.extractedData.awayScore ?? 0,
                },
              }
            : i,
        ),
      );
    } catch (err) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === id
            ? { ...i, status: "error", errorMsg: err instanceof Error ? err.message : "Extraction failed" }
            : i,
        ),
      );
    } finally {
      processingRef.current.delete(id);
    }
  }, []);

  // Pump: whenever a slot frees up and files are queued, start the next one(s).
  useEffect(() => {
    const inflight = items.filter((i) => i.status === "extracting").length;
    const slots = CONCURRENCY - inflight;
    if (slots <= 0) return;
    const toStart = items
      .filter((i) => i.status === "queued" && !processingRef.current.has(i.id))
      .slice(0, slots);
    if (toStart.length === 0) return;
    for (const it of toStart) processingRef.current.add(it.id);
    setItems((prev) =>
      prev.map((i) => (toStart.some((t) => t.id === i.id) ? { ...i, status: "extracting" } : i)),
    );
    for (const it of toStart) void extractItem(it.id, it.file);
  }, [items, extractItem]);

  // Keep a sensible selection: when nothing is selected (or the selected file was just saved),
  // jump to the first file that's ready to review.
  useEffect(() => {
    if (items.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    const selected = items.find((i) => i.id === selectedId);
    if (!selected || selected.status === "saved") {
      const nextReady = items.find((i) => i.status === "ready");
      if (nextReady && nextReady.id !== selectedId) setSelectedId(nextReady.id);
    }
  }, [items, selectedId]);

  const addFiles = (files: FileList | File[] | null) => {
    if (!files) return;
    const arr = Array.from(files).filter((f) => /image\/(png|jpe?g)/.test(f.type));
    if (arr.length === 0) return;
    const newItems: UploadItem[] = arr.map((file) => ({
      id: crypto.randomUUID(),
      file,
      filename: file.name,
      previewUrl: URL.createObjectURL(file),
      status: "queued",
      players: [],
      gameData: { homeTeam: "", awayTeam: "", homeScore: 0, awayScore: 0 },
    }));
    setItems((prev) => [...prev, ...newItems]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const patchSelected = (patch: (item: UploadItem) => UploadItem) => {
    setItems((prev) => prev.map((i) => (i.id === selectedId ? patch(i) : i)));
  };

  const updatePlayerName = (idx: number, name: string) =>
    patchSelected((i) => ({
      ...i,
      players: i.players.map((p, k) => (k === idx ? { ...p, name } : p)),
    }));

  const updateStat = (idx: number, key: keyof ExtractedPlayer, value: number) =>
    patchSelected((i) => ({
      ...i,
      players: i.players.map((p, k) => (k === idx ? { ...p, [key]: value } : p)),
    }));

  const updateGameField = (key: keyof GameData, value: string | number) =>
    patchSelected((i) => ({ ...i, gameData: { ...i.gameData, [key]: value } }));

  const retryItem = (id: string) => {
    processingRef.current.delete(id);
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: "queued", errorMsg: undefined } : i)),
    );
  };

  const removeItem = (id: string) => {
    processingRef.current.delete(id);
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const startOver = () => {
    for (const it of items) URL.revokeObjectURL(it.previewUrl);
    processingRef.current.clear();
    setItems([]);
    setSelectedId(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const onSave = async () => {
    const item = items.find((i) => i.id === selectedId);
    if (!item || !item.uploadData) return;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "saving" } : i)));
    try {
      await api.post("/api/screenshots/save", {
        gameData: item.gameData,
        playersData: item.players.map((p) => ({
          name: p.name,
          team: p.team,
          points: p.points,
          rebounds: p.rebounds,
          assists: p.assists,
          steals: p.steals,
          blocks: p.blocks,
          turnovers: p.turnovers,
          fouls: p.fouls,
          fgMade: p.fgMade,
          fgAttempted: p.fgAttempted,
          threeMade: p.threeMade,
          threeAttempted: p.threeAttempted,
          ftMade: p.ftMade,
          ftAttempted: p.ftAttempted,
        })),
        imageUrl: item.uploadData.originalImageUrl,
        originalFileName: item.uploadData.originalFileName,
      });
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "saved" } : i)));
    } catch (err) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: "error", errorMsg: err instanceof Error ? err.message : "Save failed" }
            : i,
        ),
      );
    }
  };

  const selectedItem = items.find((i) => i.id === selectedId) ?? null;
  const counts = {
    pending: items.filter((i) => i.status === "queued" || i.status === "extracting").length,
    ready: items.filter((i) => i.status === "ready").length,
    saved: items.filter((i) => i.status === "saved").length,
    error: items.filter((i) => i.status === "error").length,
  };
  const allSaved = items.length > 0 && counts.saved === items.length;

  // ---- Empty state: the big dropzone -------------------------------------------------------
  if (items.length === 0) {
    return (
      <AppShell
        eyebrow="Workflow"
        title="Upload box scores"
        description="Drop one or more screenshots from your 2K26 post-game screens. Each extracts in the background and lands in the review list — confirm them one at a time."
      >
        <Card>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              addFiles(e.dataTransfer.files);
            }}
            className={`group grid w-full place-items-center gap-4 rounded-md border border-dashed p-16 transition-colors ${
              isDragging
                ? "border-foreground bg-secondary/60"
                : "border-border-strong bg-background hover:border-foreground hover:bg-secondary/40"
            }`}
          >
            <div className="grid h-12 w-12 place-items-center rounded-md border border-border bg-card font-display text-lg">
              ↑
            </div>
            <div className="text-center">
              <div className="font-display text-lg font-semibold">
                Drop screenshots or click to browse
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                PNG or JPEG · select several at once · each auto-extracts in ~12&nbsp;s
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              <Badge tone="outline">Junk filter</Badge>
              <Badge tone="outline">Fine-tuned VLM</Badge>
              <Badge tone="outline">Basketball validation</Badge>
            </div>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
        </Card>
      </AppShell>
    );
  }

  // ---- Batch state: sidebar + review pane --------------------------------------------------
  return (
    <AppShell
      eyebrow="Workflow"
      title="Upload box scores"
      description="Files extract in the background. Confirm each one, then head to your games or analytics."
      actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => void navigate({ to: "/games" })}
            className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-secondary"
          >
            View games
          </button>
          <button
            onClick={() => void navigate({ to: "/analytics" })}
            className={`inline-flex h-9 items-center rounded-md px-4 text-sm font-medium ${
              allSaved
                ? "bg-primary text-primary-foreground hover:opacity-90"
                : "border border-border bg-surface hover:bg-secondary"
            }`}
          >
            Go to analytics
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Summary bar */}
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-display text-base font-semibold">{items.length} file{items.length === 1 ? "" : "s"}</span>
              {counts.pending > 0 && <Badge tone="outline">{counts.pending} extracting</Badge>}
              {counts.ready > 0 && <Badge tone="primary">{counts.ready} to review</Badge>}
              {counts.saved > 0 && <Badge tone="success">{counts.saved} saved</Badge>}
              {counts.error > 0 && <Badge tone="danger">{counts.error} failed</Badge>}
              {allSaved && (
                <span className="stamp text-muted-foreground">All caught up</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => inputRef.current?.click()}
                className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-secondary"
              >
                Add more
              </button>
              <button
                onClick={startOver}
                className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium text-muted-foreground hover:bg-secondary"
              >
                Start over
              </button>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
        </Card>

        <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
          {/* Sidebar */}
          <div className="space-y-2">
            {items.map((it) => (
              <button
                key={it.id}
                onClick={() => setSelectedId(it.id)}
                className={`flex w-full items-center gap-3 rounded-md border p-2 text-left transition-colors ${
                  it.id === selectedId
                    ? "border-foreground bg-secondary/60"
                    : "border-border bg-card hover:bg-secondary/40"
                }`}
              >
                <img
                  src={it.previewUrl}
                  alt=""
                  className="h-10 w-16 shrink-0 rounded border border-border object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-xs text-muted-foreground">
                    {it.filename}
                  </div>
                  <div className="mt-1">
                    <StatusBadge status={it.status} />
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Review pane */}
          <div>
            {!selectedItem ? (
              <Card>
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Select a file on the left to review it.
                </div>
              </Card>
            ) : selectedItem.status === "queued" || selectedItem.status === "extracting" ? (
              <ExtractingCard filename={selectedItem.filename} queued={selectedItem.status === "queued"} />
            ) : selectedItem.status === "error" ? (
              <Card>
                <div className="flex flex-col items-center gap-4 py-10 text-center">
                  <Badge tone="danger">Error</Badge>
                  <p className="text-sm text-destructive">{selectedItem.errorMsg}</p>
                  <div className="flex gap-3">
                    <button
                      onClick={() => retryItem(selectedItem.id)}
                      className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
                    >
                      Retry
                    </button>
                    <button
                      onClick={() => removeItem(selectedItem.id)}
                      className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-secondary"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </Card>
            ) : selectedItem.status === "saved" ? (
              <Card>
                <div className="flex flex-col items-center gap-3 py-10 text-center">
                  <div className="grid h-12 w-12 place-items-center rounded-md border border-border bg-card font-display text-lg">
                    ✓
                  </div>
                  <h2 className="font-display text-xl font-semibold">
                    {selectedItem.gameData.homeTeam || "Home"} vs{" "}
                    {selectedItem.gameData.awayTeam || "Away"} saved
                  </h2>
                  <p className="max-w-md text-sm text-muted-foreground">
                    This game is in your dashboard and feeding player + team analytics. Pick another
                    file, or head to your games or analytics above.
                  </p>
                </div>
              </Card>
            ) : (
              // ready | saving
              <ReviewPane
                item={selectedItem}
                allowedNames={allowedNames}
                onGameField={updateGameField}
                onPlayerName={updatePlayerName}
                onStat={updateStat}
                onSave={() => void onSave()}
              />
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function StatusBadge({ status }: { status: ItemStatus }) {
  switch (status) {
    case "queued":
      return <Badge tone="outline">Queued</Badge>;
    case "extracting":
      return <Badge tone="outline">Extracting…</Badge>;
    case "ready":
      return <Badge tone="primary">Ready</Badge>;
    case "saving":
      return <Badge tone="primary">Saving…</Badge>;
    case "saved":
      return <Badge tone="success">Saved</Badge>;
    case "error":
      return <Badge tone="danger">Error</Badge>;
  }
}

function ExtractingCard({ filename, queued }: { filename: string; queued: boolean }) {
  return (
    <Card>
      <div className="flex items-center gap-4 border-b border-border pb-5">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        <div className="flex-1">
          <div className="font-display text-base font-semibold">
            {queued ? "Waiting in queue…" : "Extracting stats…"}
          </div>
          <div className="font-mono text-xs text-muted-foreground">{filename}</div>
        </div>
        <Badge tone="primary">{queued ? "Queued" : "Processing"}</Badge>
      </div>
      <ol className="mt-5 space-y-3">
        {["Junk filter", "Fine-tuned VLM extraction", "Basketball-specific validation"].map(
          (label, i) => (
            <li key={label} className="grid grid-cols-[24px_1fr_auto] items-center gap-3 text-sm">
              <span className="font-mono text-xs tabular-nums text-muted-foreground">0{i + 1}</span>
              <span>{label}</span>
              <span className={`stamp ${queued ? "text-muted-foreground" : "animate-pulse"}`}>
                {queued ? "Pending" : "Working…"}
              </span>
            </li>
          ),
        )}
      </ol>
    </Card>
  );
}

function ReviewPane({
  item,
  allowedNames,
  onGameField,
  onPlayerName,
  onStat,
  onSave,
}: {
  item: UploadItem;
  allowedNames: string[];
  onGameField: (key: keyof GameData, value: string | number) => void;
  onPlayerName: (idx: number, name: string) => void;
  onStat: (idx: number, key: keyof ExtractedPlayer, value: number) => void;
  onSave: () => void;
}) {
  const saving = item.status === "saving";
  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Badge tone="success">Extracted · ready to review</Badge>
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <EditableTeamScore
                label="Home"
                team={item.gameData.homeTeam}
                score={item.gameData.homeScore}
                onTeamChange={(v) => onGameField("homeTeam", v)}
                onScoreChange={(v) => onGameField("homeScore", v)}
              />
              <span className="text-muted-foreground">vs</span>
              <EditableTeamScore
                label="Away"
                team={item.gameData.awayTeam}
                score={item.gameData.awayScore}
                onTeamChange={(v) => onGameField("awayTeam", v)}
                onScoreChange={(v) => onGameField("awayScore", v)}
              />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Assign player names using the dropdowns. Tap any stat cell to correct.
            </p>
          </div>
          <button
            onClick={onSave}
            disabled={saving}
            className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save game"}
          </button>
        </div>
      </Card>

      <Card title="Player stats" hint={`${item.players.length} rows · assign names + correct stats`}>
        {allowedNames.length === 0 && (
          <div className="mb-4 rounded-md border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
            No mapped players yet — totals and analytics only track names from your{" "}
            <Link
              to="/roster"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              roster mappings
            </Link>
            . Add gamertag → name mappings first so assigned stats count.
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-strong text-left">
                <th className="stamp pb-2 pr-3 font-normal min-w-[140px]">Player</th>
                <th className="stamp pb-2 pr-3 font-normal">Team</th>
                {["PTS", "REB", "AST", "STL", "BLK", "TO", "PF"].map((h) => (
                  <th key={h} className="stamp px-1 pb-2 text-right font-normal">
                    {h}
                  </th>
                ))}
                <th className="stamp px-2 pb-2 text-right font-normal">FG</th>
                <th className="stamp px-2 pb-2 text-right font-normal">3P</th>
                <th className="stamp px-2 pb-2 text-right font-normal">FT</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {item.players.map((p, idx) => (
                <tr key={idx} className="hover:bg-secondary/40">
                  <td className="py-2 pr-3">
                    <select
                      value={p.name}
                      onChange={(e) => onPlayerName(idx, e.target.value)}
                      className="w-full rounded border border-border bg-background px-2 py-1 text-sm focus:border-foreground focus:outline-none"
                    >
                      <option value="">— assign —</option>
                      {allowedNames.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                      {p.name && !allowedNames.includes(p.name) && (
                        <option value={p.name}>{p.name} (OCR)</option>
                      )}
                    </select>
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">{p.team}</td>
                  {(
                    [
                      "points",
                      "rebounds",
                      "assists",
                      "steals",
                      "blocks",
                      "turnovers",
                      "fouls",
                    ] as const
                  ).map((k) => (
                    <td key={k} className="px-0.5 text-right">
                      <input
                        type="number"
                        value={p[k]}
                        onChange={(e) => onStat(idx, k, Number(e.target.value))}
                        className="w-12 rounded border border-transparent bg-transparent px-1.5 py-1 text-right font-mono tabular-nums hover:border-border focus:border-foreground focus:outline-none"
                      />
                    </td>
                  ))}
                  <td className="px-2 text-right font-mono text-xs text-muted-foreground tabular-nums">
                    {p.fgMade}/{p.fgAttempted}
                  </td>
                  <td className="px-2 text-right font-mono text-xs text-muted-foreground tabular-nums">
                    {p.threeMade}/{p.threeAttempted}
                  </td>
                  <td className="px-2 text-right font-mono text-xs text-muted-foreground tabular-nums">
                    {p.ftMade}/{p.ftAttempted}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function EditableTeamScore({
  label,
  team,
  score,
  onTeamChange,
  onScoreChange,
}: {
  label: string;
  team: string;
  score: number;
  onTeamChange: (v: string) => void;
  onScoreChange: (v: number) => void;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="stamp">{label}</span>
      <input
        type="text"
        value={team}
        onChange={(e) => onTeamChange(e.target.value)}
        className="w-28 rounded border border-border bg-background px-2 py-1 font-display text-sm font-semibold focus:border-foreground focus:outline-none"
        placeholder="Team name"
      />
      <input
        type="number"
        value={score}
        onChange={(e) => onScoreChange(Number(e.target.value))}
        className="w-16 rounded border border-border bg-background px-2 py-1 font-mono text-2xl font-semibold tabular-nums focus:border-foreground focus:outline-none"
      />
    </div>
  );
}
