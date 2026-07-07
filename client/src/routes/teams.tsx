import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AppShell, Card, Metric } from "@/components/app-shell";
import { api } from "@/lib/api";

interface TeamStat {
  name: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  totalPoints: number;
  avgPoints: number;
  fg_percentage: number;
  three_percentage: number;
}

export const Route = createFileRoute("/teams")({
  head: () => ({
    meta: [
      { title: "Teams — ScoreCheck" },
      { name: "description", content: "Win/loss records and shooting efficiency by team." },
    ],
  }),
  component: TeamsPage,
});

function TeamsPage() {
  const [stats, setStats] = useState<TeamStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ success: boolean; data: { teams: unknown[]; stats: TeamStat[] } }>(
        "/api/analytics/teams",
      )
      .then((res) => {
        if (res.success) setStats(res.data.stats);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <AppShell
        eyebrow="Standings"
        title="Teams"
        description="Win/loss records and shooting efficiency by team."
      >
        <div className="flex h-48 items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        </div>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell eyebrow="Standings" title="Teams">
        <Card>
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      </AppShell>
    );
  }

  const sorted = [...stats].sort((a, b) => b.wins - a.wins);
  const topOffense =
    sorted.length > 0 ? sorted.reduce((a, b) => (a.avgPoints > b.avgPoints ? a : b)) : null;
  const bestFg =
    sorted.length > 0 ? sorted.reduce((a, b) => (a.fg_percentage > b.fg_percentage ? a : b)) : null;

  return (
    <AppShell
      eyebrow="Standings"
      title="Teams"
      description="Win/loss records and shooting efficiency across all uploaded games."
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <Metric label="Teams" value={stats.length} />
        <Metric
          label="Top offense"
          value={topOffense ? `${topOffense.avgPoints.toFixed(1)} PPG` : "—"}
          hint={topOffense?.name}
        />
        <Metric
          label="Best FG%"
          value={bestFg ? `${bestFg.fg_percentage.toFixed(1)}%` : "—"}
          hint={bestFg?.name}
        />
      </section>

      <Card title="Standings" hint="Sorted by wins" padding="none" className="mt-6">
        {sorted.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No team data yet — upload some box scores to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-strong bg-secondary/40 text-left">
                  <th className="stamp px-6 py-3 font-normal">#</th>
                  <th className="stamp py-3 pr-3 font-normal">Team</th>
                  <th className="stamp px-2 py-3 text-right font-normal">GP</th>
                  <th className="stamp px-2 py-3 text-right font-normal">W</th>
                  <th className="stamp px-2 py-3 text-right font-normal">L</th>
                  <th className="stamp px-2 py-3 text-right font-normal">Win%</th>
                  <th className="stamp px-2 py-3 text-right font-normal">PPG</th>
                  <th className="stamp px-2 py-3 text-right font-normal">FG%</th>
                  <th className="stamp px-6 py-3 text-right font-normal">3P%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sorted.map((t, i) => {
                  const winPct =
                    t.gamesPlayed > 0 ? ((t.wins / t.gamesPlayed) * 100).toFixed(1) : "—";
                  return (
                    <tr key={t.name} className="hover:bg-secondary/40">
                      <td className="stamp px-6 py-3.5">{i + 1}</td>
                      <td className="py-3.5 pr-3 font-display font-semibold">{t.name}</td>
                      <td className="px-2 text-right font-mono tabular-nums">{t.gamesPlayed}</td>
                      <td className="px-2 text-right font-mono font-semibold tabular-nums text-success">
                        {t.wins}
                      </td>
                      <td className="px-2 text-right font-mono tabular-nums text-destructive">
                        {t.losses}
                      </td>
                      <td className="px-2 text-right font-mono tabular-nums">
                        {winPct === "—" ? "—" : `${winPct}%`}
                      </td>
                      <td className="px-2 text-right font-mono tabular-nums">
                        {t.avgPoints.toFixed(1)}
                      </td>
                      <td className="px-2 text-right font-mono tabular-nums">
                        {t.fg_percentage.toFixed(1)}%
                      </td>
                      <td className="px-6 text-right font-mono tabular-nums">
                        {t.three_percentage.toFixed(1)}%
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
