import { createFileRoute } from "@tanstack/react-router";
import { AppShell, Card, Metric, Badge } from "@/components/app-shell";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const Route = createFileRoute("/eval")({
  head: () => ({
    meta: [
      { title: "Eval harness — ScoreCheck" },
      {
        name: "description",
        content:
          "Reproducible OCR field-level accuracy benchmark across labeled box-score screenshots.",
      },
    ],
  }),
  component: EvalPage,
});

const runs = [
  {
    id: "r014",
    date: "2026-06-22",
    pipeline: "GCV",
    images: 64,
    accuracy: 99.1,
    latency: 12.1,
    cost: 0.006,
  },
  {
    id: "r013",
    date: "2026-06-21",
    pipeline: "Qwen2.5-VL",
    images: 64,
    accuracy: 96.8,
    latency: 19.6,
    cost: 0.0,
  },
  {
    id: "r012",
    date: "2026-06-18",
    pipeline: "GCV",
    images: 58,
    accuracy: 98.6,
    latency: 12.4,
    cost: 0.006,
  },
  {
    id: "r011",
    date: "2026-06-17",
    pipeline: "Qwen2.5-VL",
    images: 58,
    accuracy: 95.9,
    latency: 21.3,
    cost: 0.0,
  },
  {
    id: "r010",
    date: "2026-06-14",
    pipeline: "GCV",
    images: 50,
    accuracy: 98.2,
    latency: 12.9,
    cost: 0.006,
  },
];

const fieldAccuracy = [
  { field: "PTS", acc: 99.7 },
  { field: "REB", acc: 99.1 },
  { field: "AST", acc: 99.0 },
  { field: "STL", acc: 98.4 },
  { field: "BLK", acc: 98.1 },
  { field: "FG", acc: 97.6 },
  { field: "3P", acc: 96.2 },
  { field: "FT", acc: 98.5 },
];

function EvalPage() {
  const latest = runs[0];

  return (
    <AppShell
      eyebrow="Benchmark"
      title="Eval harness"
      description="Reproducible field-level accuracy on a labeled dataset. Run `npm run eval` locally to refresh."
      actions={
        <button className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
          Run benchmark
        </button>
      }
    >
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Latest accuracy"
          value={`${latest.accuracy}%`}
          delta={{ value: "+0.5 vs prev" }}
        />
        <Metric label="Pipeline" value={latest.pipeline} hint={`${latest.images} images`} />
        <Metric label="Avg latency" value={`${latest.latency}s`} hint="per image" />
        <Metric label="Cost / image" value={`$${latest.cost.toFixed(4)}`} hint="API calls" />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Field-level accuracy" hint="Latest GCV run · 64 labeled images">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={fieldAccuracy} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis
                  dataKey="field"
                  stroke="var(--color-muted-foreground)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  domain={[90, 100]}
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
                <Bar dataKey="acc" radius={[3, 3, 0, 0]} fill="var(--color-primary)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Pipeline comparison" hint="GCV vs Qwen2.5-VL">
          <div className="space-y-4">
            <Compare label="Accuracy" gcv="99.1%" qwen="96.8%" />
            <Compare label="Avg latency" gcv="12s" qwen="20s warm" />
            <Compare label="Cost / image" gcv="$0.0060" qwen="$0.0000" />
            <Compare label="Internet" gcv="Required" qwen="None" />
          </div>
        </Card>
      </div>

      <Card title="Run history" hint="Last five benchmark runs" padding="none" className="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-strong bg-secondary/40 text-left">
                <th className="stamp px-6 py-3 font-normal">Run</th>
                <th className="stamp pr-3 font-normal">Date</th>
                <th className="stamp pr-3 font-normal">Pipeline</th>
                <th className="stamp px-2 py-3 text-right font-normal">Images</th>
                <th className="stamp px-2 py-3 text-right font-normal">Accuracy</th>
                <th className="stamp px-2 py-3 text-right font-normal">Latency</th>
                <th className="stamp px-6 py-3 text-right font-normal">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-secondary/40">
                  <td className="px-6 py-3.5 font-mono text-xs">{r.id}</td>
                  <td className="pr-3 text-xs text-muted-foreground">{r.date}</td>
                  <td className="pr-3">
                    <Badge tone={r.pipeline === "GCV" ? "primary" : "outline"}>{r.pipeline}</Badge>
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums">{r.images}</td>
                  <td className="px-2 text-right font-mono font-semibold tabular-nums">
                    {r.accuracy}%
                  </td>
                  <td className="px-2 text-right font-mono tabular-nums">{r.latency}s</td>
                  <td className="px-6 text-right font-mono tabular-nums text-muted-foreground">
                    ${r.cost.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </AppShell>
  );
}

function Compare({ label, gcv, qwen }: { label: string; gcv: string; qwen: string }) {
  return (
    <div className="grid grid-cols-[1fr_auto_auto] items-center gap-4 border-b border-border pb-3 last:border-0 last:pb-0">
      <span className="stamp">{label}</span>
      <span className="font-mono text-sm font-semibold tabular-nums">{gcv}</span>
      <span className="font-mono text-sm tabular-nums text-muted-foreground">{qwen}</span>
    </div>
  );
}
