import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { AppShell, Card, Metric, Badge } from "@/components/app-shell";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Overview — ScoreCheck" },
      {
        name: "description",
        content: "League overview: recent games, top performers, and OCR pipeline status.",
      },
      { property: "og:title", content: "Overview — ScoreCheck" },
      {
        property: "og:description",
        content: "League overview, top performers, and OCR pipeline status.",
      },
    ],
  }),
  component: Dashboard,
});

interface RecentGame {
  id: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  createdAt: string;
}

interface TopPlayer {
  playerName: string;
  avgPoints: number;
  team: string;
}

interface DashboardData {
  totalGames: number;
  totalPlayers: number;
  totalTeams: number;
  avgPointsTeamAAndB: number;
  recentGames: RecentGame[];
  topPerformers: { points: TopPlayer[]; rebounds: TopPlayer[]; assists: TopPlayer[] };
}

function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ success: boolean; data: DashboardData }>("/api/analytics/dashboard")
      .then((res) => {
        if (res.success) setData(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const leaders = (data?.topPerformers?.points ?? []).slice(0, 5);

  return (
    <AppShell
      eyebrow="Season 2026 · Friend league"
      title="Overview"
      description="Every box score from your group, automatically extracted and stored."
      actions={
        <>
          <Link
            to="/analytics"
            className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-secondary"
          >
            Analytics
          </Link>
          <Link
            to="/upload"
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Upload box score
          </Link>
        </>
      }
    >
      {loading ? (
        <div className="flex h-48 items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Games tracked" value={data?.totalGames ?? 0} />
            <Metric label="Distinct players" value={data?.totalPlayers ?? 0} />
            <Metric label="Teams" value={data?.totalTeams ?? 0} />
            <Metric
              label="Avg combined PPG"
              value={data?.avgPointsTeamAAndB != null ? data.avgPointsTeamAAndB.toFixed(1) : "—"}
            />
          </section>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.55fr_1fr]">
            <Card
              title="Recent games"
              hint="Last five box scores"
              action={
                <Link
                  to="/games"
                  className="text-xs font-medium text-foreground underline-offset-4 hover:underline"
                >
                  All games →
                </Link>
              }
            >
              {(data?.recentGames?.length ?? 0) === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No games yet — upload a screenshot to get started.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {data!.recentGames.slice(0, 5).map((g) => {
                    const winner = g.homeScore > g.awayScore ? "home" : "away";
                    return (
                      <li
                        key={g.id}
                        className="grid grid-cols-[1fr_auto] items-center gap-4 py-4 first:pt-0 last:pb-0"
                      >
                        <div>
                          <div className="stamp">
                            {formatDate(g.createdAt.slice(0, 10), { year: true })}
                          </div>
                          <div className="mt-2 flex items-center gap-4 font-display">
                            <TeamScore
                              name={g.homeTeam}
                              score={g.homeScore}
                              winner={winner === "home"}
                            />
                            <span className="text-muted-foreground/60">vs</span>
                            <TeamScore
                              name={g.awayTeam}
                              score={g.awayScore}
                              winner={winner === "away"}
                            />
                          </div>
                        </div>
                        <Badge tone={g.homeScore > g.awayScore ? "success" : "outline"}>
                          {winner === "home" ? g.homeTeam : g.awayTeam} won
                        </Badge>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card title="Scoring leaders" hint="Points per game · all games">
              {leaders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No data yet.</p>
              ) : (
                <ol className="space-y-1">
                  {leaders.map((p, i) => (
                    <li
                      key={p.playerName}
                      className="grid grid-cols-[24px_1fr_auto] items-center gap-3 rounded-md px-2 py-2.5 hover:bg-secondary/60"
                    >
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{p.playerName}</div>
                        <div className="text-[11px] text-muted-foreground">{p.team}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-display text-lg font-semibold tabular-nums">
                          {p.avgPoints.toFixed(1)}
                        </div>
                        <div className="stamp">ppg</div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </div>

          <Card
            title="Upload pipeline"
            hint="Five steps from screenshot to saved row"
            className="mt-6"
          >
            <ol className="grid gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-5">
              {[
                { n: "01", t: "Screenshot", s: "JPEG / PNG · 4K ok" },
                { n: "02", t: "Junk filter", s: "qwen2.5vl · ~1.5s" },
                { n: "03", t: "GCV extract", s: "4-pass · 120 regions" },
                { n: "04", t: "Review & edit", s: "Confirm or correct" },
                { n: "05", t: "Save", s: "PostgreSQL · Prisma" },
              ].map((step) => (
                <li key={step.n} className="bg-card p-5">
                  <div className="font-mono text-[11px] tracking-widest text-muted-foreground">
                    STEP {step.n}
                  </div>
                  <div className="mt-2 font-display text-base font-semibold">{step.t}</div>
                  <div className="mt-1 text-xs text-muted-foreground">{step.s}</div>
                </li>
              ))}
            </ol>
          </Card>
        </>
      )}
    </AppShell>
  );
}

function TeamScore({ name, score, winner }: { name: string; score: number; winner: boolean }) {
  return (
    <span className="flex items-baseline gap-2">
      <span
        className={`text-sm font-semibold ${winner ? "text-foreground" : "text-muted-foreground"}`}
      >
        {name}
      </span>
      <span
        className={`font-mono text-2xl tabular-nums ${winner ? "text-foreground" : "text-muted-foreground"}`}
      >
        {score}
      </span>
    </span>
  );
}
