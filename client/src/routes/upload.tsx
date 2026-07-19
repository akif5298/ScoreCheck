import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell, Card, Badge } from "@/components/app-shell";
import { api } from "@/lib/api";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Upload box score — ScoreCheck" },
      {
        name: "description",
        content:
          "Drop a 2K26 screenshot, review the auto-extracted stats, and commit them to your league.",
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

type Stage = "idle" | "uploading" | "review" | "saving" | "saved" | "error";

function UploadPage() {
  // Assignable names come from the user's gamertag mappings (roster page)
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
  const [stage, setStage] = useState<Stage>("idle");
  const [filename, setFilename] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [uploadData, setUploadData] = useState<UploadResponse | null>(null);
  const [players, setPlayers] = useState<ExtractedPlayer[]>([]);
  const [gameData, setGameData] = useState({
    homeTeam: "",
    awayTeam: "",
    homeScore: 0,
    awayScore: 0,
  });
  const inputRef = useRef<HTMLInputElement>(null);

  const onPick = async (file: File | null) => {
    if (!file) return;
    setFilename(file.name);
    setStage("uploading");
    setErrorMsg("");

    try {
      const form = new FormData();
      form.append("screenshot", file);
      const result = await api.post<UploadResponse>("/api/screenshots/upload", form);

      setUploadData(result);
      setPlayers(result.extractedData.players ?? []);
      setGameData({
        homeTeam: result.extractedData.homeTeam ?? "",
        awayTeam: result.extractedData.awayTeam ?? "",
        homeScore: result.extractedData.homeScore ?? 0,
        awayScore: result.extractedData.awayScore ?? 0,
      });
      setStage("review");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Upload failed");
      setStage("error");
    }
  };

  const updatePlayerName = (idx: number, name: string) => {
    setPlayers((prev) => prev.map((p, i) => (i === idx ? { ...p, name } : p)));
  };

  const updateStat = (idx: number, key: keyof ExtractedPlayer, value: number) => {
    setPlayers((prev) => prev.map((p, i) => (i === idx ? { ...p, [key]: value } : p)));
  };

  const updateGameField = (key: keyof typeof gameData, value: string | number) => {
    setGameData((prev) => ({ ...prev, [key]: value }));
  };

  const onSave = async () => {
    if (!uploadData) return;
    setStage("saving");
    try {
      await api.post("/api/screenshots/save", {
        gameData,
        playersData: players.map((p) => ({
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
        imageUrl: uploadData.originalImageUrl,
        originalFileName: uploadData.originalFileName,
      });
      setStage("saved");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Save failed");
      setStage("error");
    }
  };

  const reset = () => {
    setStage("idle");
    setFilename("");
    setErrorMsg("");
    setUploadData(null);
    setPlayers([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <AppShell
      eyebrow="Workflow"
      title="Upload box score"
      description="Drop a screenshot from your 2K26 post-game screen. Extraction takes ~12 seconds and lands in the review table below."
    >
      {stage === "idle" && (
        <Card>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="group grid w-full place-items-center gap-4 rounded-md border border-dashed border-border-strong bg-background p-16 transition-colors hover:border-foreground hover:bg-secondary/40"
          >
            <div className="grid h-12 w-12 place-items-center rounded-md border border-border bg-card font-display text-lg">
              ↑
            </div>
            <div className="text-center">
              <div className="font-display text-lg font-semibold">
                Drop a screenshot or click to browse
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                PNG or JPEG · max 12 MB · auto-extracts in ~12 s
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-1.5">
              <Badge tone="outline">Junk filter</Badge>
              <Badge tone="outline">4-pass GCV</Badge>
              <Badge tone="outline">120 regions</Badge>
              <Badge tone="outline">Basketball validation</Badge>
            </div>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={(e) => void onPick(e.target.files?.[0] ?? null)}
          />
        </Card>
      )}

      {stage === "uploading" && (
        <Card>
          <div className="flex items-center gap-4 border-b border-border pb-5">
            <span className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            <div className="flex-1">
              <div className="font-display text-base font-semibold">Extracting stats…</div>
              <div className="font-mono text-xs text-muted-foreground">{filename}</div>
            </div>
            <Badge tone="primary">Processing</Badge>
          </div>
          <ol className="mt-5 space-y-3">
            {[
              "Junk filter (qwen2.5vl)",
              "Image preprocessing (4 passes)",
              "Google Cloud Vision · 120 regions",
              "Basketball-specific validation",
            ].map((label, i) => (
              <li key={label} className="grid grid-cols-[24px_1fr_auto] items-center gap-3 text-sm">
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  0{i + 1}
                </span>
                <span>{label}</span>
                <span className="stamp animate-pulse">Working…</span>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {stage === "error" && (
        <Card>
          <div className="flex flex-col items-center gap-4 py-10 text-center">
            <Badge tone="danger">Error</Badge>
            <p className="text-sm text-destructive">{errorMsg}</p>
            <button
              onClick={reset}
              className="mt-2 inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-secondary"
            >
              Try again
            </button>
          </div>
        </Card>
      )}

      {(stage === "review" || stage === "saving") && uploadData && (
        <div className="space-y-6">
          <Card>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <Badge tone="success">Extracted · ready to review</Badge>
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <EditableTeamScore
                    label="Home"
                    team={gameData.homeTeam}
                    score={gameData.homeScore}
                    onTeamChange={(v) => updateGameField("homeTeam", v)}
                    onScoreChange={(v) => updateGameField("homeScore", v)}
                  />
                  <span className="text-muted-foreground">vs</span>
                  <EditableTeamScore
                    label="Away"
                    team={gameData.awayTeam}
                    score={gameData.awayScore}
                    onTeamChange={(v) => updateGameField("awayTeam", v)}
                    onScoreChange={(v) => updateGameField("awayScore", v)}
                  />
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Assign player names using the dropdowns. Tap any stat cell to correct.
                </p>
              </div>
              <button
                onClick={() => void onSave()}
                disabled={stage === "saving"}
                className="inline-flex h-10 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {stage === "saving" ? "Saving…" : "Save game"}
              </button>
            </div>
          </Card>

          <Card title="Player stats" hint={`${players.length} rows · assign names + correct stats`}>
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
                  {players.map((p, idx) => (
                    <tr key={idx} className="hover:bg-secondary/40">
                      <td className="py-2 pr-3">
                        <select
                          value={p.name}
                          onChange={(e) => updatePlayerName(idx, e.target.value)}
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
                            onChange={(e) => updateStat(idx, k, Number(e.target.value))}
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
      )}

      {stage === "saved" && (
        <Card>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="grid h-12 w-12 place-items-center rounded-md border border-border bg-card font-display text-lg">
              ✓
            </div>
            <h2 className="font-display text-2xl font-semibold">Saved to your league</h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {gameData.homeTeam} vs {gameData.awayTeam} is now in your dashboard and feeding player
              + team analytics.
            </p>
            <div className="mt-4 flex gap-3">
              <button
                onClick={reset}
                className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-secondary"
              >
                Upload another
              </button>
              <button
                onClick={() => void navigate({ to: "/games" })}
                className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
              >
                View all games
              </button>
            </div>
          </div>
        </Card>
      )}
    </AppShell>
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
