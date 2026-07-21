import { Link, useRouterState, useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useAuth } from "@/contexts/auth-context";
import { SquadSwitcher } from "@/components/squad-switcher";

export const nav = [
  { to: "/", label: "Overview", code: "01" },
  { to: "/upload", label: "Upload", code: "02" },
  { to: "/games", label: "Games", code: "03" },
  { to: "/players", label: "Players", code: "04" },
  { to: "/roster", label: "Roster", code: "05" },
  // "Teams" here means box-score home/away rows; renamed to avoid reading as a synonym of Squad.
  { to: "/teams", label: "Matchups", code: "06" },
  { to: "/analytics", label: "Analytics", code: "07" },
  { to: "/squad", label: "Squad", code: "11" },
  { to: "/eval", label: "Eval harness", code: "08" },
  { to: "/admin", label: "Admin", code: "09" },
  { to: "/settings", label: "Settings", code: "10" },
] as const;

export function AppShell({
  children,
  title,
  eyebrow,
  description,
  actions,
}: {
  children: ReactNode;
  title: string;
  eyebrow?: string;
  description?: string;
  actions?: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  // Redirect to login once auth state is known and user is not signed in
  if (!loading && !user) {
    void navigate({ to: "/login" });
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-border bg-secondary/40 lg:flex">
        <Link
          to="/"
          className="flex h-16 items-center gap-2.5 border-b border-border px-6 hover:bg-secondary/60"
        >
          <div className="grid h-8 w-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <span className="text-sm">●</span>
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display text-base font-semibold tracking-tight">ScoreCheck</span>
            <span className="stamp">NBA 2K26 · v1.4</span>
          </div>
        </Link>

        <SquadSwitcher />

        <nav className="flex-1 overflow-y-auto p-3">
          <div className="stamp px-3 pb-2 pt-3">Workspace</div>
          <ul className="space-y-0.5">
            {nav
              .filter((n) => n.to !== "/admin" || user?.role === "ADMIN")
              .map((n) => {
                const active =
                  n.to === "/"
                    ? pathname === "/"
                    : pathname === n.to || pathname.startsWith(`${n.to}/`);
                return (
                  <li key={n.to}>
                    <Link
                      to={n.to}
                      className={`group flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : "text-foreground/70 hover:bg-secondary hover:text-foreground"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <span
                          className={`font-mono text-[10px] tracking-widest ${
                            active ? "text-primary-foreground/60" : "text-muted-foreground"
                          }`}
                        >
                          {n.code}
                        </span>
                        <span className="font-medium">{n.label}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
          </ul>
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-md px-2 py-2">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground text-xs font-semibold">
              {user?.name
                ? user.name
                    .split(" ")
                    .map((w) => w[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()
                : "??"}
            </div>
            <div className="flex-1 leading-tight min-w-0">
              <div className="truncate text-sm font-medium">
                {user?.name ?? user?.email ?? "User"}
              </div>
              <div className="text-[11px] text-muted-foreground capitalize">
                {user?.role?.toLowerCase() ?? "user"}
              </div>
            </div>
            <button
              onClick={() => {
                logout();
                void navigate({ to: "/login" });
              }}
              className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary"
              title="Sign out"
            >
              Out
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-border bg-background/85 px-6 backdrop-blur-xl lg:px-10">
          <div className="flex items-center gap-3">
            <Crumb pathname={pathname} />
          </div>
          <div className="flex items-center gap-2">
            <button className="hidden h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm text-muted-foreground hover:text-foreground sm:flex">
              <span className="font-mono text-xs">⌘K</span>
              <span>Search</span>
            </button>
            <Link
              to="/upload"
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              + New upload
            </Link>
          </div>
        </header>

        {/* Page header */}
        <div className="border-b border-border bg-background">
          <div className="px-6 py-10 lg:px-10">
            {eyebrow && <div className="stamp mb-3">{eyebrow}</div>}
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="max-w-2xl">
                <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight sm:text-5xl">
                  {title}
                </h1>
                {description && (
                  <p className="mt-3 text-base text-muted-foreground">{description}</p>
                )}
              </div>
              {actions && <div className="flex items-center gap-2">{actions}</div>}
            </div>
          </div>
        </div>

        <main className="px-6 py-8 lg:px-10">{children}</main>

        <footer className="border-t border-border px-6 py-6 text-xs text-muted-foreground lg:px-10">
          <div className="flex items-center justify-between">
            <span>© 2026 ScoreCheck · Personal league analytics</span>
            <span className="stamp">build · 2026.06.24</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

const crumbMap: Record<string, string> = {
  "/": "Overview",
  "/upload": "Upload",
  "/players": "Players",
  "/roster": "Roster",
  "/analytics": "Analytics",
  "/games": "Games",
  "/teams": "Matchups",
  "/squad": "Squad",
  "/eval": "Eval harness",
  "/settings": "Settings",
  "/admin": "Admin",
};

function Crumb({ pathname }: { pathname: string }) {
  if (pathname.startsWith("/games/")) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="stamp">ScoreCheck</span>
        <span className="text-muted-foreground/60">/</span>
        <Link to="/games" className="stamp hover:text-foreground">
          Games
        </Link>
        <span className="text-muted-foreground/60">/</span>
        <span className="font-medium">Game detail</span>
      </div>
    );
  }
  const label = crumbMap[pathname] ?? "ScoreCheck";
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="stamp">ScoreCheck</span>
      <span className="text-muted-foreground/60">/</span>
      <span className="font-medium">{label}</span>
    </div>
  );
}

/* ---------- Reusable bits ---------- */

export function Card({
  title,
  hint,
  action,
  children,
  className = "",
  padding = "default",
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padding?: "default" | "tight" | "none";
}) {
  const pad = padding === "none" ? "" : padding === "tight" ? "p-4" : "p-6";
  return (
    <section className={`rounded-lg border border-border bg-card ${pad} ${className}`}>
      {(title || action) && (
        <div
          className={`mb-5 flex items-center justify-between ${padding === "none" ? "px-6 pt-6" : ""}`}
        >
          <div>
            {title && (
              <h2 className="font-display text-sm font-semibold uppercase tracking-[0.14em]">
                {title}
              </h2>
            )}
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Metric({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string | number;
  delta?: { value: string; positive?: boolean };
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <span className="stamp">{label}</span>
        {delta && (
          <span
            className={`font-mono text-[11px] ${
              delta.positive === false ? "text-destructive" : "text-success"
            }`}
          >
            {delta.value}
          </span>
        )}
      </div>
      <div className="mt-4 font-display text-3xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning" | "primary" | "danger" | "outline";
}) {
  const tones = {
    default: "bg-secondary text-secondary-foreground",
    success: "bg-success/10 text-success",
    warning: "bg-warning/15 text-warning",
    primary: "bg-primary text-primary-foreground",
    danger: "bg-destructive/10 text-destructive",
    outline: "border border-border text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
