import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
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

type Mode = "login" | "signup";

function LoginPage() {
  const { user, loading, login, signup } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) {
      void navigate({ to: "/" });
    }
  }, [user, loading, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (mode === "signup" && password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setSubmitting(true);
    try {
      if (mode === "login") {
        await login(email, password);
      } else {
        await signup({ email, password, name: name.trim() || undefined, inviteCode });
      }
      void navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary";

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
          <div className="stamp mb-4">Your league's dashboard</div>
          <h1 className="font-display text-4xl font-semibold leading-[1.05] tracking-tight">
            Every box score, automatically extracted and archived.
          </h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Drop a 2K26 screenshot, confirm the auto-extracted stats, and your friend group's season
            averages update in real time. Powered by a fine-tuned vision-language model with a
            basketball-aware validation layer.
          </p>
        </div>

        <dl className="grid grid-cols-3 gap-6">
          <Pill k="98%" v="players detected" />
          <Pill k="22s" v="per screenshot" />
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
          <div className="stamp mb-3">{mode === "login" ? "Welcome back" : "Join your league"}</div>
          <h2 className="font-display text-3xl font-semibold tracking-tight">
            {mode === "login" ? "Sign in" : "Create account"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "login"
              ? "Sign in with your email and password."
              : "You'll need the invite code from your league admin."}
          </p>

          <form onSubmit={(e) => void handleSubmit(e)} className="mt-8 flex flex-col gap-4">
            {mode === "signup" && (
              <div>
                <label htmlFor="name" className="stamp mb-1.5 block">
                  Name <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Akif"
                  autoComplete="name"
                  maxLength={100}
                  className={inputClass}
                />
              </div>
            )}

            <div>
              <label htmlFor="email" className="stamp mb-1.5 block">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                className={inputClass}
              />
            </div>

            <div>
              <label htmlFor="password" className="stamp mb-1.5 block">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={mode === "signup" ? 8 : 1}
                maxLength={72}
                className={inputClass}
              />
            </div>

            {mode === "signup" && (
              <div>
                <label htmlFor="inviteCode" className="stamp mb-1.5 block">
                  Invite code
                </label>
                <input
                  id="inviteCode"
                  required
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="From your league admin"
                  autoComplete="off"
                  className={inputClass}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || loading}
              className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {submitting
                ? mode === "login"
                  ? "Signing in…"
                  : "Creating account…"
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            {mode === "login" ? (
              <>
                New here?{" "}
                <button
                  onClick={() => setMode("signup")}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button
                  onClick={() => setMode("login")}
                  className="font-medium text-foreground underline-offset-4 hover:underline"
                >
                  Sign in
                </button>
              </>
            )}
          </p>
        </div>

        <footer className="text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>© 2026 ScoreCheck</span>
            <span className="stamp">build · 2026.07.18</span>
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
