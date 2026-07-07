import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Card, Metric, Badge } from "@/components/app-shell";
import { adminStats, recentGames } from "@/lib/mock-data";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — ScoreCheck" },
      {
        name: "description",
        content: "Master account access for managing users, games, and the OCR review queue.",
      },
    ],
  }),
  component: Admin,
});

const users = [
  { id: "u1", handle: "marcus", role: "admin", games: 42, lastActive: "2h ago" },
  { id: "u2", handle: "jess", role: "user", games: 38, lastActive: "1d ago" },
  { id: "u3", handle: "kev", role: "user", games: 29, lastActive: "3d ago" },
  { id: "u4", handle: "ari", role: "user", games: 22, lastActive: "5d ago" },
  { id: "u5", handle: "ty", role: "user", games: 16, lastActive: "1w ago" },
];

function Admin() {
  const review = recentGames.filter((g) => g.status !== "verified").slice(0, 3);

  return (
    <AppShell
      eyebrow="Master account"
      title="Admin"
      description="Manage users, work the review queue, and monitor OCR pipeline health."
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Users" value={adminStats.totalUsers} hint="3 active this week" />
        <Metric label="Games" value={adminStats.totalGames} delta={{ value: "+8 wk" }} />
        <Metric
          label="Screenshots"
          value={adminStats.totalScreenshots}
          delta={{ value: "+11 wk" }}
        />
        <Metric
          label="Review queue"
          value={adminStats.pendingReview}
          delta={{ value: "needs eyes", positive: false }}
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card title="Users" hint="League members" padding="none">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-strong bg-secondary/40 text-left">
                <th className="stamp px-6 py-3 font-normal">Handle</th>
                <th className="stamp pr-3 font-normal">Role</th>
                <th className="stamp px-2 text-right font-normal">Games</th>
                <th className="stamp px-6 text-right font-normal">Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-secondary/40">
                  <td className="px-6 py-3.5 font-medium">@{u.handle}</td>
                  <td className="pr-3">
                    {u.role === "admin" ? (
                      <Badge tone="primary">Admin</Badge>
                    ) : (
                      <Badge tone="outline">User</Badge>
                    )}
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums">{u.games}</td>
                  <td className="px-6 text-right text-xs text-muted-foreground">{u.lastActive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="Review queue" hint="Low-confidence uploads">
          {review.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">
              Nothing to review.
            </div>
          ) : (
            <ul className="space-y-3">
              {review.map((g) => (
                <li key={g.id} className="rounded-md border border-border bg-background p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-sm font-semibold">
                      {g.away.abbr} @ {g.home.abbr}
                    </span>
                    <Badge tone="warning">{g.ocrConfidence}%</Badge>
                  </div>
                  <div className="stamp mt-1">
                    @{g.uploadedBy} · {g.date}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90">
                      Approve
                    </button>
                    <button className="flex-1 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-secondary">
                      Inspect
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Pipeline health" hint="Last 24 hours" className="lg:col-span-2" padding="none">
          <div className="grid gap-px overflow-hidden bg-border sm:grid-cols-4">
            {[
              { l: "Junk filter", v: "1.4 s", s: "warm" },
              { l: "GCV extract", v: "11.8 s", s: "nominal" },
              { l: "Qwen2.5-VL", v: "19.6 s", s: "standby" },
              { l: "Eval accuracy", v: "98.6%", s: "labeled set" },
            ].map((m) => (
              <div key={m.l} className="bg-card p-5">
                <div className="stamp">{m.l}</div>
                <div className="mt-2 font-display text-2xl font-semibold tabular-nums">{m.v}</div>
                <div className="text-[11px] text-muted-foreground">{m.s}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </AppShell>
  );
}
