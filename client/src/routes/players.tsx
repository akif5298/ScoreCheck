import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AppShell, Card, Badge } from "@/components/app-shell";
import { api } from "@/lib/api";

export const Route = createFileRoute("/players")({
  head: () => ({
    meta: [
      { title: "Players — ScoreCheck" },
      {
        name: "description",
        content: "Season averages and shooting splits for every player in your league.",
      },
    ],
  }),
  component: PlayersPage,
});

interface PlayerRow {
  player: string;
  team: string;
  games: number;
  ppg: number;
  rpg: number;
  apg: number;
  fgPct: number;
  tpPct: number;
}

function PlayersPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState<"ppg" | "rpg" | "apg" | "fgPct">("ppg");

  useEffect(() => {
    api
      .get<{
        success: boolean;
        data: {
          stats: {
            playerName: string;
            team: string;
            gamesPlayed: number;
            avgPoints: number;
            avgRebounds: number;
            avgAssists: number;
            avgFgPercentage: number;
            avgThreePercentage: number;
          }[];
        };
      }>("/api/analytics/players")
      .then((res) => {
        if (res.success) {
          setPlayers(
            res.data.stats.map((s) => ({
              player: s.playerName,
              team: s.team,
              games: s.gamesPlayed,
              ppg: Number((s.avgPoints ?? 0).toFixed(1)),
              rpg: Number((s.avgRebounds ?? 0).toFixed(1)),
              apg: Number((s.avgAssists ?? 0).toFixed(1)),
              fgPct: Number((s.avgFgPercentage ?? 0).toFixed(1)),
              tpPct: Number((s.avgThreePercentage ?? 0).toFixed(1)),
            })),
          );
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const sorted = [...players].sort((a, b) => b[sort] - a[sort]);

  return (
    <AppShell
      eyebrow="Roster"
      title="Players"
      description="Season-long averages aggregated from every verified box score in the league."
      actions={
        <div className="flex h-9 items-center gap-1 rounded-md border border-border bg-surface p-1">
          {(["ppg", "rpg", "apg", "fgPct"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className={`rounded-sm px-3 py-1 text-xs font-medium uppercase tracking-wider transition-colors ${
                sort === k
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {k === "fgPct" ? "FG%" : k}
            </button>
          ))}
        </div>
      }
    >
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <div className="py-10 text-center text-sm text-muted-foreground">
            No player data yet — upload a box score to populate stats.
          </div>
        </Card>
      ) : (
        <Card padding="none">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-strong bg-secondary/40 text-left">
                  <th className="stamp px-6 py-3 font-normal">#</th>
                  <th className="stamp py-3 pr-3 font-normal">Player</th>
                  <th className="stamp pr-3 font-normal">Team</th>
                  <th className="stamp px-2 py-3 text-right font-normal">GP</th>
                  <th className="stamp px-2 py-3 text-right font-normal">PPG</th>
                  <th className="stamp px-2 py-3 text-right font-normal">RPG</th>
                  <th className="stamp px-2 py-3 text-right font-normal">APG</th>
                  <th className="stamp px-2 py-3 text-right font-normal">FG%</th>
                  <th className="stamp px-6 py-3 text-right font-normal">3P%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((p, i) => (
                  <tr key={p.player} className="hover:bg-secondary/40">
                    <td className="px-6 py-3.5 font-mono text-xs text-muted-foreground tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </td>
                    <td className="py-3.5 pr-3">
                      <div className="flex items-center gap-3">
                        <div className="grid h-8 w-8 place-items-center rounded-full bg-secondary text-[11px] font-semibold">
                          {p.player
                            .split(" ")
                            .map((w) => w[0])
                            .join("")
                            .slice(0, 2)}
                        </div>
                        <span className="font-medium">{p.player}</span>
                      </div>
                    </td>
                    <td className="pr-3 text-xs text-muted-foreground">{p.team}</td>
                    <td className="px-2 text-right font-mono tabular-nums">{p.games}</td>
                    <td className="px-2 text-right font-mono font-semibold tabular-nums">
                      {p.ppg}
                    </td>
                    <td className="px-2 text-right font-mono tabular-nums">{p.rpg}</td>
                    <td className="px-2 text-right font-mono tabular-nums">{p.apg}</td>
                    <td className="px-2 text-right font-mono tabular-nums">
                      {p.fgPct >= 50 ? (
                        <Badge tone="success">{p.fgPct}%</Badge>
                      ) : (
                        <span>{p.fgPct}%</span>
                      )}
                    </td>
                    <td className="px-6 text-right font-mono tabular-nums text-muted-foreground">
                      {p.tpPct}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </AppShell>
  );
}
