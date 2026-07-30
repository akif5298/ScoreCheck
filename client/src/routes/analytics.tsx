import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AppShell, Card, Metric, Badge } from "@/components/app-shell";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — ScoreCheck" },
      {
        name: "description",
        content: "Trend charts, scoring leaders, and team efficiency for your NBA 2K26 league.",
      },
    ],
  }),
  component: Analytics,
});

interface RecentGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  createdAt: string;
}

interface PlayerStat {
  playerName: string;
  avgPoints: number;
  avgRebounds: number;
  avgAssists: number;
  avgFgPercentage: number;
  avgThreePercentage: number;
  gamesPlayed: number;
  team: string;
}

interface TeamStat {
  name: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  totalPoints: number;
  totalRebounds: number;
  totalAssists: number;
  avgPoints: number;
}

interface DashboardData {
  totalGames: number;
  totalPlayers: number;
  totalTeams: number;
  avgPointsTeamAAndB: number;
  recentGames: RecentGame[];
  topPerformers: { points: { playerName: string; avgPoints: number; team: string }[] };
  playerStats: PlayerStat[];
  teamStats: TeamStat[];
}

function Analytics() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  // See the same state in index.tsx: without it a failed request rendered empty charts, which
  // is indistinguishable from a league that has no games.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ success: boolean; data: DashboardData }>("/api/analytics/dashboard")
      .then((res) => {
        if (res.success) setData(res.data);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const leaders = (data?.topPerformers?.points ?? []).slice(0, 8);
  const trend = (data?.recentGames ?? [])
    .slice()
    .reverse()
    .map((g) => ({
      date: formatDate(g.createdAt.slice(0, 10)),
      home: g.homeScore,
      away: g.awayScore,
    }));

  const barData = leaders.map((p) => ({
    player: p.playerName,
    ppg: Number(p.avgPoints.toFixed(1)),
  }));

  return (
    <AppShell
      eyebrow="Analytics"
      title="League trends"
      description="Aggregate views built from every verified box score. Powered by Recharts."
    >
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        </div>
      ) : error ? (
        <Card>
          <p className="text-sm text-destructive">{error}</p>
        </Card>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Games tracked" value={data?.totalGames ?? 0} />
            <Metric
              label="Top scorer"
              value={leaders[0]?.avgPoints.toFixed(1) ?? "—"}
              hint={leaders[0] ? `${leaders[0].playerName} · ppg` : undefined}
            />
            <Metric
              label="Best 3P%"
              value={
                (data?.playerStats?.length ?? 0) > 0
                  ? `${Math.max(...data!.playerStats.map((p) => p.avgThreePercentage ?? 0)).toFixed(1)}%`
                  : "—"
              }
            />
            <Metric label="Avg combined PPG" value={data?.avgPointsTeamAAndB?.toFixed(1) ?? "—"} />
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Card title="Score trend" hint="Home vs away · recent games">
              <div className="h-64">
                {trend.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No games yet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trend} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis
                        dataKey="date"
                        stroke="var(--color-muted-foreground)"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="var(--color-muted-foreground)"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="home"
                        stroke="var(--color-primary)"
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="away"
                        stroke="var(--color-muted-foreground)"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={{ r: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card title="Scoring leaders" hint="Points per game">
              <div className="h-64">
                {barData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No data yet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={barData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                      <XAxis
                        dataKey="player"
                        stroke="var(--color-muted-foreground)"
                        fontSize={10}
                        interval={0}
                        angle={-20}
                        textAnchor="end"
                        height={60}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        stroke="var(--color-muted-foreground)"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: "var(--color-secondary)" }}
                        contentStyle={{
                          backgroundColor: "var(--color-card)",
                          border: "1px solid var(--color-border)",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="ppg" radius={[3, 3, 0, 0]}>
                        {barData.map((_, i) => (
                          <Cell
                            key={i}
                            fill={i === 0 ? "var(--color-primary)" : "var(--color-chart-2)"}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>

            <Card
              title="Team totals"
              hint="Cumulative across all uploaded games"
              className="lg:col-span-2"
            >
              {(data?.teamStats?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">No team data yet.</p>
              ) : (
                <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
                  {data!.teamStats.map((team) => (
                    <div key={team.name} className="bg-card p-5">
                      <div className="flex items-center justify-between">
                        <span className="stamp">{team.name}</span>
                        <Badge tone="outline">
                          {team.wins}W–{team.losses}L
                        </Badge>
                      </div>
                      <div className="mt-4 grid grid-cols-3 gap-3">
                        <Stat l="PTS" v={team.totalPoints} primary />
                        <Stat l="REB" v={team.totalRebounds} />
                        <Stat l="AST" v={team.totalAssists} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </AppShell>
  );
}

function Stat({ l, v, primary }: { l: string; v: number; primary?: boolean }) {
  return (
    <div>
      <div
        className={`font-display text-2xl font-semibold tabular-nums ${
          primary ? "text-foreground" : "text-muted-foreground"
        }`}
      >
        {v ?? 0}
      </div>
      <div className="stamp">{l}</div>
    </div>
  );
}
