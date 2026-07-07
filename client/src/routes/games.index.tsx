import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AppShell, Card, Badge } from "@/components/app-shell";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/games/")({
  head: () => ({
    meta: [
      { title: "Games — ScoreCheck" },
      {
        name: "description",
        content: "Full game history with box scores for your NBA 2K26 league.",
      },
    ],
  }),
  component: GamesPage,
});

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

interface Game {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  players: PlayerRow[];
}

function GamesPage() {
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ success: boolean; data: Game[] }>("/api/screenshots/games")
      .then((res) => {
        if (res.success) setGames(res.data);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <AppShell eyebrow="History" title="Games" description="All uploaded box scores.">
        <div className="flex h-48 items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        </div>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell eyebrow="History" title="Games" description="All uploaded box scores.">
        <Card>
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      eyebrow="History"
      title="Games"
      description="Every uploaded box score in reverse-chronological order."
    >
      <Card padding="none">
        {games.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No games yet — upload a box score screenshot to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-strong bg-secondary/40 text-left">
                  <th className="stamp px-6 py-3 font-normal">Date</th>
                  <th className="stamp py-3 pr-3 font-normal">Matchup</th>
                  <th className="stamp px-2 py-3 text-right font-normal">Score</th>
                  <th className="stamp px-6 py-3 text-right font-normal">Players</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {games.map((g) => {
                  const winner = g.homeScore >= g.awayScore ? g.homeTeam : g.awayTeam;
                  return (
                    <tr key={g.id} className="hover:bg-secondary/40">
                      <td className="stamp px-6 py-4">
                        {g.date ? formatDate(g.date.slice(0, 10), { year: true }) : "—"}
                      </td>
                      <td className="py-4 pr-3">
                        <Link
                          to="/games/$gameId"
                          params={{ gameId: g.id }}
                          className="font-display font-semibold hover:text-primary"
                        >
                          {g.homeTeam} vs {g.awayTeam}
                        </Link>
                        <div className="mt-0.5">
                          <Badge tone="success">{winner} won</Badge>
                        </div>
                      </td>
                      <td className="px-2 text-right font-mono font-semibold tabular-nums">
                        {g.homeScore}–{g.awayScore}
                      </td>
                      <td className="px-6 text-right font-mono tabular-nums text-muted-foreground">
                        {g.players?.length ?? 0}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </AppShell>
  );
}
