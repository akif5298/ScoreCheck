import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/contexts/auth-context";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Sign in — ScoreCheck" },
      {
        name: "description",
        content: "Sign in to ScoreCheck to upload box scores and track your league.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { user, loading, demoLogin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      void navigate({ to: "/" });
    }
  }, [user, loading, navigate]);

  const handleDemoLogin = async () => {
    await demoLogin();
    void navigate({ to: "/" });
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Left — brand panel */}
      <aside className="relative hidden flex-col justify-between border-r border-border bg-secondary/50 p-10 lg:flex">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground">
            ●
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display text-base font-semibold tracking-tight">ScoreCheck</span>
            <span className="stamp">NBA 2K26 · v1.4</span>
          </div>
        </Link>

        <div className="max-w-md">
          <div className="stamp mb-4">A personal league dashboard</div>
          <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight">
            Every box score, automatically extracted and archived.
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Drop a 2K26 screenshot, confirm the auto-extracted stats, and your friend group's season
            averages update in real time. Powered by a locally-hosted vision-language model with a
            basketball-aware validation layer.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-6">
          <Pill k="98%" v="players detected" />
          <Pill k="$0" v="per upload — fully local" />
          <Pill k="13" v="stats per player" />
        </dl>
      </aside>

      {/* Right — form */}
      <main className="flex flex-col p-6 sm:p-10">
        <div className="flex items-center justify-between">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground lg:hidden"
          >
            <div className="grid h-7 w-7 place-items-center rounded-md bg-primary text-primary-foreground text-xs">
              ●
            </div>
            ScoreCheck
          </Link>
          <Link
            to="/"
            className="ml-auto text-xs text-muted-foreground underline-offset-4 hover:underline"
          >
            ← Back home
          </Link>
        </div>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">
          <div className="stamp mb-3">Welcome back</div>
          <h2 className="font-display text-3xl font-semibold tracking-tight">Sign in</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Use Apple to access your league. We never see your password.
          </p>

          <div className="mt-8">
            <button
              onClick={() => void handleDemoLogin()}
              disabled={loading}
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              <span aria-hidden>&#63743;</span>
              {loading ? "Signing in…" : "Continue with Apple (Demo)"}
            </button>
          </div>

          <p className="mt-3 text-center text-xs text-muted-foreground">
            Demo mode — uses the backend's Apple Sign-In dev bypass.
          </p>

          {/* Dev-only convenience: skips straight to the app with a demo session.
              Safe to leave in — it uses the same demo auth as the main button. */}
          <div className="mt-10 text-center">
            <button
              onClick={() => void handleDemoLogin()}
              disabled={loading}
              className="text-xs text-muted-foreground/60 underline-offset-4 hover:text-muted-foreground hover:underline disabled:opacity-50"
            >
              Skip (Dev)
            </button>
          </div>
        </div>

        <footer className="text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>© 2026 ScoreCheck</span>
            <span className="stamp">build · 2026.06.24</span>
          </div>
        </footer>
      </main>
    </div>
  );
}

function Pill({ k, v }: { k: string; v: string }) {
  return (
    <div className="border-l border-border pl-4">
      <dt className="font-display text-2xl font-semibold tabular-nums">{k}</dt>
      <dd className="stamp mt-1">{v}</dd>
    </div>
  );
}
