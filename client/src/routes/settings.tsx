import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, Card, Badge } from "@/components/app-shell";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — ScoreCheck" },
      {
        name: "description",
        content: "Account, OCR pipeline, and notification preferences for ScoreCheck.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const [autoVerify, setAutoVerify] = useState(true);
  const [notifyReview, setNotifyReview] = useState(true);
  const [notifySaved, setNotifySaved] = useState(false);
  const [pipeline, setPipeline] = useState<"gcv" | "qwen">("gcv");

  return (
    <AppShell
      eyebrow="Preferences"
      title="Settings"
      description="Tune the OCR pipeline, manage your account, and decide what lands in your inbox."
      actions={
        <button className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90">
          Save changes
        </button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card title="Account" hint="Apple Sign-In session">
          <div className="flex items-center gap-4 border-b border-border pb-5">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground font-display text-lg font-semibold">
              MJ
            </div>
            <div className="flex-1">
              <div className="font-display text-base font-semibold">Marcus Johnson</div>
              <div className="text-xs text-muted-foreground">marcus@scorecheck.app</div>
              <div className="mt-1.5">
                <Badge tone="primary">Admin</Badge>
              </div>
            </div>
          </div>
          <dl className="mt-5 space-y-3 text-sm">
            <Row label="Handle" value="@marcus" />
            <Row label="Member since" value="Jan 2026" />
            <Row label="Last sign-in" value="2 hours ago" />
            <Row label="Connected" value="Apple ID" />
          </dl>
          <button className="mt-6 inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-secondary">
            Sign out
          </button>
        </Card>

        <div className="space-y-6">
          <Card title="OCR pipeline" hint="Choose extraction engine for new uploads">
            <div className="grid gap-3 sm:grid-cols-2">
              <PipelineCard
                active={pipeline === "gcv"}
                onClick={() => setPipeline("gcv")}
                title="Google Cloud Vision"
                meta="4-pass · 120 regions"
                stat="99.1% accuracy"
                cost="$0.006 / image"
              />
              <PipelineCard
                active={pipeline === "qwen"}
                onClick={() => setPipeline("qwen")}
                title="Qwen2.5-VL"
                meta="Local · Ollama"
                stat="96.8% accuracy"
                cost="Free"
              />
            </div>
            <Toggle
              label="Auto-verify high-confidence runs"
              hint="Skip the review screen when OCR confidence ≥ 99%"
              value={autoVerify}
              onChange={setAutoVerify}
            />
          </Card>

          <Card title="Notifications" hint="When ScoreCheck pings you">
            <div className="divide-y divide-border">
              <Toggle
                label="Review queue alerts"
                hint="Email me when a teammate uploads a low-confidence game"
                value={notifyReview}
                onChange={setNotifyReview}
              />
              <Toggle
                label="Saved-game digest"
                hint="Weekly summary of every game added to the league"
                value={notifySaved}
                onChange={setNotifySaved}
              />
            </div>
          </Card>

          <Card title="Danger zone" hint="Permanent actions, please be sure">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
              <div>
                <div className="font-display text-sm font-semibold">Delete league data</div>
                <div className="text-xs text-muted-foreground">
                  Removes every uploaded game and screenshot. Cannot be undone.
                </div>
              </div>
              <button className="inline-flex h-9 items-center rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:opacity-90">
                Delete
              </button>
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="stamp">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4 first:pt-5">
      <div className="flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>
      </div>
      <button
        onClick={() => onChange(!value)}
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${
          value ? "border-primary bg-primary" : "border-border bg-secondary"
        }`}
        aria-pressed={value}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-background transition-transform ${
            value ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

function PipelineCard({
  active,
  onClick,
  title,
  meta,
  stat,
  cost,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  meta: string;
  stat: string;
  cost: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md border p-4 text-left transition-colors ${
        active
          ? "border-foreground bg-secondary/60"
          : "border-border bg-background hover:bg-secondary/40"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-sm font-semibold">{title}</span>
        {active && <Badge tone="primary">Active</Badge>}
      </div>
      <div className="stamp mt-1">{meta}</div>
      <div className="mt-3 font-mono text-sm tabular-nums">{stat}</div>
      <div className="text-xs text-muted-foreground">{cost}</div>
    </button>
  );
}
