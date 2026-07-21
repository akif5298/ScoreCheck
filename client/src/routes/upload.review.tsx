import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge, Card, nav } from "@/components/app-shell";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/auth-context";
import { api } from "@/lib/api";
import {
  useUploadSession,
  type ExtractedPlayer,
  type GameData,
  type ItemStatus,
  type UploadItem,
} from "@/contexts/upload-session";

export const Route = createFileRoute("/upload/review")({
  head: () => ({
    meta: [
      { title: "Review box scores — ScoreCheck" },
      {
        name: "description",
        content:
          "Review and confirm each auto-extracted 2K26 box score before it lands in your league.",
      },
    ],
  }),
  component: ReviewWorkspace,
});

function ReviewWorkspace() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const {
    items,
    selectedId,
    selectedItem,
    counts,
    allSaved,
    select,
    addFiles,
    updatePlayerName,
    updateStat,
    updateGameField,
    retryItem,
    removeItem,
    startOver,
    save,
  } = useUploadSession();
  const addInputRef = useRef<HTMLInputElement>(null);

  // Nothing to review (direct hit on the URL, or the batch was cleared) → back to the dropzone.
  useEffect(() => {
    if (items.length === 0) void navigate({ to: "/upload", replace: true });
  }, [items.length, navigate]);

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

  // Auth guard (this page renders outside AppShell, which normally does the redirect).
  if (!loading && !user) {
    void navigate({ to: "/login" });
    return null;
  }
  if (items.length === 0) return null;

  const addMore = (files: FileList | File[] | null) => {
    addFiles(files);
    if (addInputRef.current) addInputRef.current.value = "";
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Top bar: hamburger (other areas) on the left, exits on the right */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              className="grid h-9 w-9 place-items-center rounded-md border border-border bg-surface text-lg hover:bg-secondary"
              aria-label="Open navigation"
            >
              ☰
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuLabel>Go to</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {nav
                .filter((n) => n.to !== "/admin" || user?.role === "ADMIN")
                .map((n) => (
                  <DropdownMenuItem key={n.to} asChild>
                    <Link to={n.to} className="flex items-center gap-3">
                      <span className="font-mono text-[10px] tracking-widest text-muted-foreground">
                        {n.code}
                      </span>
                      <span>{n.label}</span>
                    </Link>
                  </DropdownMenuItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  logout();
                  void navigate({ to: "/login" });
                }}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Link to="/" className="flex items-center gap-2.5 hover:opacity-90">
            <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground">
              <span className="text-xs">●</span>
            </div>
            <div className="hidden leading-none sm:flex sm:flex-col">
              <span className="font-display text-sm font-semibold tracking-tight">ScoreCheck</span>
              <span className="stamp">Review uploads</span>
            </div>
          </Link>
        </div>

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
            {allSaved ? "Done · analytics ▸" : "Go to analytics"}
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left rail: a slim strip of screenshots you scroll through, each with its name under it. */}
        <aside className="flex w-40 shrink-0 flex-col border-r border-border bg-secondary/30 lg:w-44">
          <div className="flex items-center justify-between px-3 py-2.5">
            <span className="stamp">Uploads · {items.length}</span>
            {counts.pending > 0 && (
              <span className="font-mono text-[10px] text-muted-foreground">{counts.pending}⋯</span>
            )}
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-3">
            {items.map((it) => (
              <button
                key={it.id}
                onClick={() => select(it.id)}
                title={it.filename}
                className={`block w-full rounded-md border p-1 text-left transition-colors ${
                  it.id === selectedId
                    ? "border-foreground bg-secondary/70"
                    : "border-border bg-card hover:bg-secondary/50"
                }`}
              >
                <img
                  src={it.previewUrl}
                  alt=""
                  className="aspect-video w-full rounded border border-border object-cover"
                />
                <div className="mt-1 flex items-center justify-between gap-1 px-0.5">
                  <span className="truncate font-mono text-[10px] text-muted-foreground">
                    {it.filename}
                  </span>
                  <StatusDot status={it.status} />
                </div>
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t border-border p-2">
            <button
              onClick={() => addInputRef.current?.click()}
              className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-surface px-3 text-sm font-medium hover:bg-secondary"
            >
              + Add more
            </button>
            <button
              onClick={startOver}
              className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-surface px-3 text-xs font-medium text-muted-foreground hover:bg-secondary"
            >
              Start over
            </button>
            <input
              ref={addInputRef}
              type="file"
              accept="image/png,image/jpeg"
              multiple
              className="hidden"
              onChange={(e) => addMore(e.target.files)}
            />
          </div>
        </aside>

        {/* Main: image on top, stats below */}
        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-6 px-6 py-6">
            {!selectedItem ? (
              <Card>
                <div className="py-10 text-center text-sm text-muted-foreground">
                  Select a file on the left to review it.
                </div>
              </Card>
            ) : (
              <>
                {/* Image at the top — shown immediately (from the local file), including while it
                    extracts, so you always see the screenshot you're reviewing. */}
                <div className="rounded-lg border border-border bg-card p-3">
                  <img
                    src={selectedItem.previewUrl}
                    alt={selectedItem.filename}
                    className="mx-auto max-h-[46vh] w-auto rounded-md object-contain"
                  />
                  <div className="mt-2 flex items-center justify-between px-1">
                    <span className="truncate font-mono text-xs text-muted-foreground">
                      {selectedItem.filename}
                    </span>
                    <StatusBadge status={selectedItem.status} />
                  </div>
                </div>

                {/* Stats in the middle, under the image */}
                {selectedItem.status === "queued" || selectedItem.status === "extracting" ? (
                  <ExtractingCard queued={selectedItem.status === "queued"} />
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
                        This game is in your dashboard and feeding player + team analytics. Pick
                        another file on the left, or head to your games or analytics above.
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
                    onSave={() => void save()}
                  />
                )}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
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

// Compact status indicator for the slim rail, where a full text badge won't fit.
function StatusDot({ status }: { status: ItemStatus }) {
  const map: Record<ItemStatus, { cls: string; label: string; pulse?: boolean }> = {
    queued: { cls: "bg-muted-foreground/50", label: "Queued" },
    extracting: { cls: "bg-primary", label: "Extracting", pulse: true },
    ready: { cls: "bg-primary", label: "Ready" },
    saving: { cls: "bg-primary", label: "Saving", pulse: true },
    saved: { cls: "bg-success", label: "Saved" },
    error: { cls: "bg-destructive", label: "Error" },
  };
  const s = map[status];
  return (
    <span
      title={s.label}
      className={`h-2 w-2 shrink-0 rounded-full ${s.cls} ${s.pulse ? "animate-pulse" : ""}`}
    />
  );
}

function ExtractingCard({ queued }: { queued: boolean }) {
  return (
    <Card>
      <div className="flex items-center gap-4 border-b border-border pb-5">
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        <div className="flex-1">
          <div className="font-display text-base font-semibold">
            {queued ? "Waiting in queue…" : "Extracting stats…"}
          </div>
          <div className="text-xs text-muted-foreground">
            The screenshot above is already saved — pulling the box score now.
          </div>
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

  // Split the roster into its two teams so each shows as a clear group of players. Group by the
  // players' own team string (which the save path expects to equal homeTeam/awayTeam), preserving
  // each player's original index so the edit handlers still target the right row.
  const groups: {
    team: string;
    score?: number;
    rows: { player: ExtractedPlayer; idx: number }[];
  }[] = [];
  item.players.forEach((player, idx) => {
    const team = player.team || "Unassigned";
    let group = groups.find((g) => g.team === team);
    if (!group) {
      const score =
        team === item.gameData.homeTeam
          ? item.gameData.homeScore
          : team === item.gameData.awayTeam
            ? item.gameData.awayScore
            : undefined;
      group = { team, score, rows: [] };
      groups.push(group);
    }
    group.rows.push({ player, idx });
  });

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

      {allowedNames.length === 0 && (
        <div className="rounded-md border border-dashed border-border bg-background p-4 text-sm text-muted-foreground">
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

      {groups.map((group) => (
        <TeamStatsTable
          key={group.team}
          team={group.team}
          score={group.score}
          rows={group.rows}
          allowedNames={allowedNames}
          onPlayerName={onPlayerName}
          onStat={onStat}
        />
      ))}
    </div>
  );
}

function TeamStatsTable({
  team,
  score,
  rows,
  allowedNames,
  onPlayerName,
  onStat,
}: {
  team: string;
  score?: number;
  rows: { player: ExtractedPlayer; idx: number }[];
  allowedNames: string[];
  onPlayerName: (idx: number, name: string) => void;
  onStat: (idx: number, key: keyof ExtractedPlayer, value: number) => void;
}) {
  return (
    <Card
      title={team || "Team"}
      hint={`${rows.length} players`}
      action={
        score !== undefined ? (
          <span className="font-mono text-2xl font-semibold tabular-nums">{score}</span>
        ) : undefined
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-strong text-left">
              <th className="stamp pb-2 pr-3 font-normal min-w-[140px]">Player</th>
              {["PTS", "REB", "AST", "STL", "BLK", "TO", "PF"].map((h) => (
                <th key={h} className="stamp px-1 pb-2 text-right font-normal">
                  {h}
                </th>
              ))}
              <th className="stamp px-1 pb-2 text-center font-normal">FG</th>
              <th className="stamp px-1 pb-2 text-center font-normal">3P</th>
              <th className="stamp px-1 pb-2 text-center font-normal">FT</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ player: p, idx }) => (
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
                      <option value={p.name}>{p.name}</option>
                    )}
                  </select>
                </td>
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
                    <StatInput value={p[k]} onChange={(v) => onStat(idx, k, v)} />
                  </td>
                ))}
                <td className="px-1">
                  <MadeAttempt
                    made={p.fgMade}
                    attempted={p.fgAttempted}
                    onMade={(v) => onStat(idx, "fgMade", v)}
                    onAttempted={(v) => onStat(idx, "fgAttempted", v)}
                  />
                </td>
                <td className="px-1">
                  <MadeAttempt
                    made={p.threeMade}
                    attempted={p.threeAttempted}
                    onMade={(v) => onStat(idx, "threeMade", v)}
                    onAttempted={(v) => onStat(idx, "threeAttempted", v)}
                  />
                </td>
                <td className="px-1">
                  <MadeAttempt
                    made={p.ftMade}
                    attempted={p.ftAttempted}
                    onMade={(v) => onStat(idx, "ftMade", v)}
                    onAttempted={(v) => onStat(idx, "ftAttempted", v)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function StatInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-12 rounded border border-transparent bg-transparent px-1.5 py-1 text-right font-mono tabular-nums hover:border-border focus:border-foreground focus:outline-none"
    />
  );
}

// FG / 3P / FT are made-and-attempted pairs, both editable.
function MadeAttempt({
  made,
  attempted,
  onMade,
  onAttempted,
}: {
  made: number;
  attempted: number;
  onMade: (v: number) => void;
  onAttempted: (v: number) => void;
}) {
  const cls =
    "w-9 rounded border border-transparent bg-transparent px-1 py-1 text-right font-mono tabular-nums hover:border-border focus:border-foreground focus:outline-none";
  return (
    <div className="flex items-center justify-center gap-0.5">
      <input
        type="number"
        value={made}
        onChange={(e) => onMade(Number(e.target.value))}
        className={cls}
        aria-label="Made"
      />
      <span className="text-muted-foreground">/</span>
      <input
        type="number"
        value={attempted}
        onChange={(e) => onAttempted(Number(e.target.value))}
        className={cls}
        aria-label="Attempted"
      />
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
