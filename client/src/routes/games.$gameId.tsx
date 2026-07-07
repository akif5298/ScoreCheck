import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AppShell, Card } from "@/components/app-shell";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

interface PlayerRow {
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

interface GameDetail {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  players: PlayerRow[];
}

export const Route = createFileRoute("/games/$gameId")({
  head: () => ({
    meta: [{ title: "Game detail — ScoreCheck" }],
  }),
  component: GameDetailPage,
});

function teamFg(players: PlayerRow[]) {
  const made = players.reduce((s, p) => s + (p.fgMade ?? 0), 0);
  const att = players.reduce((s, p) => s + (p.fgAttempted ?? 0), 0);
  return att > 0 ? `${((made / att) * 100).toFixed(1)}%` : "—";
}

function GameDetailPage() {
  const { gameId } = Route.useParams();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ success: boolean; data: GameDetail }>(`/api/screenshots/games/${gameId}`)
      .then((res) => {
        if (res.success) setGame(res.data);
        else setError("Game not found.");
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [gameId]);

  if (loading) {
    return (
      <AppShell eyebrow="Game detail" title="Loading…">
        <div className="flex h-48 items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        </div>
      </AppShell>
    );
  }

  if (error || !game) {
    return (
      <AppShell
        eyebrow="Game detail"
        title="Not found"
        actions={
          <Link
            to="/games"
            className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm hover:bg-secondary"
          >
            ← Games
          </Link>
        }
      >
        <Card>
          <p className="text-sm text-destructive">{error ?? "Game not found."}</p>
        </Card>
      </AppShell>
    );
  }

  const winner = game.homeScore >= game.awayScore ? game.homeTeam : game.awayTeam;
  const homePlayers = game.players?.filter((p) => p.team === game.homeTeam) ?? [];
  const awayPlayers = game.players?.filter((p) => p.team === game.awayTeam) ?? [];
  const dateLabel = game.date ? formatDate(game.date.slice(0, 10), { year: true }) : "Game detail";

  return (
    <AppShell
      eyebrow={dateLabel}
      title={`${game.homeTeam} vs ${game.awayTeam}`}
      description={`Final · ${game.homeTeam} ${game.homeScore} — ${game.awayTeam} ${game.awayScore}`}
      actions={
        <Link
          to="/games"
          className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm hover:bg-secondary"
        >
          ← Games
        </Link>
      }
    >
      {/* Score banner */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="stamp mb-1">{game.homeTeam}</div>
          <div className="font-display text-5xl font-semibold tabular-nums">{game.homeScore}</div>
          <div className="mt-2 text-xs text-muted-foreground">
            FG {teamFg(homePlayers)} · {homePlayers.reduce((s, p) => s + (p.rebounds ?? 0), 0)} REB
            · {homePlayers.reduce((s, p) => s + (p.assists ?? 0), 0)} AST
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card p-5">
          <div className="stamp mb-2">Winner</div>
          <div className="font-display text-xl font-semibold">{winner}</div>
          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
            Final
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card p-5 text-right">
          <div className="stamp mb-1">{game.awayTeam}</div>
          <div className="font-display text-5xl font-semibold tabular-nums">{game.awayScore}</div>
          <div className="mt-2 text-xs text-muted-foreground">
            FG {teamFg(awayPlayers)} · {awayPlayers.reduce((s, p) => s + (p.rebounds ?? 0), 0)} REB
            · {awayPlayers.reduce((s, p) => s + (p.assists ?? 0), 0)} AST
          </div>
        </div>
      </div>

      {/* Per-team box scores */}
      {[game.homeTeam, game.awayTeam].map((team) => {
        const players = game.players?.filter((p) => p.team === team) ?? [];
        if (players.length === 0) return null;
        return (
          <Card key={team} title={team} padding="none" className="mt-6">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-strong bg-secondary/40 text-left">
                    <th className="stamp px-6 py-3 font-normal">Player</th>
                    {["PTS", "REB", "AST", "STL", "BLK", "TO", "PF"].map((h) => (
                      <th key={h} className="stamp px-2 py-3 text-right font-normal">
                        {h}
                      </th>
                    ))}
                    <th className="stamp px-2 py-3 text-right font-normal">FG</th>
                    <th className="stamp px-2 py-3 text-right font-normal">3P</th>
                    <th className="stamp px-6 py-3 text-right font-normal">FT</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {players.map((p, i) => (
                    <tr key={i} className="hover:bg-secondary/40">
                      <td className="px-6 py-3 font-medium">{p.name}</td>
                      {[
                        p.points,
                        p.rebounds,
                        p.assists,
                        p.steals,
                        p.blocks,
                        p.turnovers,
                        p.fouls,
                      ].map((v, vi) => (
                        <td key={vi} className="px-2 text-right font-mono tabular-nums">
                          {v ?? 0}
                        </td>
                      ))}
                      <td className="px-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {p.fgMade}/{p.fgAttempted}
                      </td>
                      <td className="px-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {p.threeMade}/{p.threeAttempted}
                      </td>
                      <td className="px-6 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {p.ftMade}/{p.ftAttempted}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </AppShell>
  );
}
