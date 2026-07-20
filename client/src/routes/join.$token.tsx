import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { api, ACTIVE_SQUAD_KEY } from "@/lib/api";

export const Route = createFileRoute("/join/$token")({
  head: () => ({
    meta: [{ title: "Join a squad — ScoreCheck" }],
  }),
  component: JoinPage,
});

interface Preview {
  squadId: string;
  squadName: string;
  invitedByName: string | null;
  memberCount: number;
  gameCount: number;
}

interface RosterEntry {
  id: string;
  gamertag: string;
  displayName: string;
  linkedUserId: string | null;
  isYou: boolean;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary";

function JoinPage() {
  const { token } = Route.useParams();
  const { user, loading: authLoading } = useAuth();

  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  // null = usable; string = the reason it isn't.
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [joinedSquadId, setJoinedSquadId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<ApiResponse<Preview>>(`/api/squads/invites/${token}`)
      .then((res) => setPreview(res.data))
      .catch((err: Error & { status?: number }) =>
        setPreviewError(
          err.status === 404 ? "This invite link is invalid, expired, or fully used." : err.message,
        ),
      )
      .finally(() => setPreviewLoading(false));
  }, [token]);

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-8 flex items-center justify-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-md bg-primary text-primary-foreground">
            ●
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-display text-base font-semibold tracking-tight">ScoreCheck</span>
            <span className="stamp">NBA 2K26 · v1.4</span>
          </div>
        </Link>

        <div className="rounded-lg border border-border bg-card p-8">
          {previewLoading ? (
            <div className="flex h-32 items-center justify-center">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            </div>
          ) : previewError || !preview ? (
            <div className="text-center">
              <div className="stamp mb-3">Invite</div>
              <h1 className="font-display text-2xl font-semibold">Can't use this link</h1>
              <p className="mt-2 text-sm text-muted-foreground">{previewError}</p>
              <Link
                to="/"
                className="mt-6 inline-flex h-10 items-center justify-center rounded-md border border-border px-4 text-sm hover:bg-secondary"
              >
                Go home
              </Link>
            </div>
          ) : joinedSquadId ? (
            <IdentifyStep squadId={joinedSquadId} squadName={preview.squadName} />
          ) : (
            <>
              <div className="text-center">
                <div className="stamp mb-3">You're invited</div>
                <h1 className="font-display text-3xl font-semibold leading-tight">
                  {preview.squadName}
                </h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  {preview.invitedByName ? `${preview.invitedByName} invited you. ` : ""}
                  {preview.memberCount} member{preview.memberCount === 1 ? "" : "s"} ·{" "}
                  {preview.gameCount} game{preview.gameCount === 1 ? "" : "s"} shared.
                </p>
              </div>

              <div className="mt-8">
                {authLoading ? (
                  <div className="flex h-10 items-center justify-center">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
                  </div>
                ) : user ? (
                  <JoinButton
                    token={token}
                    squadName={preview.squadName}
                    onJoined={(squadId) => setJoinedSquadId(squadId)}
                  />
                ) : (
                  <AuthPanel token={token} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function JoinButton({
  token,
  squadName,
  onJoined,
}: {
  token: string;
  squadName: string;
  onJoined: (squadId: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  const join = async () => {
    setBusy(true);
    try {
      const res = await api.post<ApiResponse<{ squadId: string; joined: boolean }>>(
        `/api/squads/join/${token}`,
      );
      // Make the joined squad the active scope for the rest of the app.
      localStorage.setItem(ACTIVE_SQUAD_KEY, res.data.squadId);
      toast.success(res.data.joined ? `Joined ${squadName}` : `You're already in ${squadName}`);
      onJoined(res.data.squadId);
    } catch (err) {
      setBusy(false);
      toast.error((err as Error).message || "Could not join");
    }
  };

  return (
    <button
      onClick={() => void join()}
      disabled={busy}
      className="inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
    >
      {busy ? "Joining…" : `Join ${squadName}`}
    </button>
  );
}

/** Login or signup inline. The invite token doubles as the signup gate, so no separate code. */
function AuthPanel({ token }: { token: string }) {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState<"signup" | "login">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

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
        // The squad invite token satisfies the signup gate — that's the whole point of the link.
        await signup({ email, password, name: name.trim() || undefined, inviteCode: token });
      }
      // On success, the page re-renders with a user and shows the Join button.
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <p className="mb-4 text-center text-xs text-muted-foreground">
        {mode === "signup"
          ? "Create an account to join — no separate invite code needed."
          : "Sign in to join this squad."}
      </p>
      <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-3">
        {mode === "signup" && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name (optional)"
            autoComplete="name"
            maxLength={100}
            className={inputClass}
          />
        )}
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          className={inputClass}
        />
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={mode === "signup" ? "Password (min 8 chars)" : "Password"}
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          minLength={mode === "signup" ? 8 : 1}
          maxLength={72}
          className={inputClass}
        />
        <button
          type="submit"
          disabled={submitting}
          className="mt-1 inline-flex h-11 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {submitting ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        {mode === "signup" ? "Already have an account? " : "New here? "}
        <button
          onClick={() => setMode(mode === "signup" ? "login" : "signup")}
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {mode === "signup" ? "Sign in" : "Create an account"}
        </button>
      </p>
    </div>
  );
}

/** "Which player are you?" — claim a roster entry, or skip. Shown right after joining. */
function IdentifyStep({ squadId, squadName }: { squadId: string; squadName: string }) {
  const navigate = useNavigate();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    api
      .get<ApiResponse<RosterEntry[]>>(`/api/squads/${squadId}/roster`)
      .then((res) => setRoster(res.data))
      .catch(() => setRoster([]))
      .finally(() => setLoading(false));
  }, [squadId]);

  const claim = async (mappingId: string) => {
    setClaiming(true);
    try {
      await api.post(`/api/squads/${squadId}/roster/claim`, { mappingId });
      toast.success("Identity claimed");
      void navigate({ to: "/" });
    } catch (err) {
      setClaiming(false);
      toast.error((err as Error).message || "Could not claim");
    }
  };

  const unclaimed = roster.filter((r) => !r.linkedUserId);

  return (
    <div>
      <div className="text-center">
        <div className="stamp mb-3">You're in · {squadName}</div>
        <h1 className="font-display text-2xl font-semibold">Which player are you?</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Claiming your roster entry links these stats to you. You can change it later on the Squad
          page.
        </p>
      </div>

      {loading ? (
        <div className="mt-6 flex h-16 items-center justify-center">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        </div>
      ) : unclaimed.length === 0 ? (
        <p className="mt-6 text-center text-sm text-muted-foreground">
          No unclaimed roster entries yet — you can identify yourself later from the Squad page.
        </p>
      ) : (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {unclaimed.map((r) => (
            <button
              key={r.id}
              disabled={claiming}
              onClick={() => void claim(r.id)}
              className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-secondary disabled:opacity-50"
            >
              {r.displayName}
            </button>
          ))}
        </div>
      )}

      <div className="mt-8 rounded-md border border-border bg-secondary/20 p-3 text-center text-xs text-muted-foreground">
        Have games of your own? Move them into {squadName} anytime from the{" "}
        <Link
          to="/games"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Games page
        </Link>
        .
      </div>

      <button
        onClick={() => void navigate({ to: "/" })}
        className="mt-4 inline-flex h-10 w-full items-center justify-center rounded-md border border-border px-4 text-sm hover:bg-secondary"
      >
        {unclaimed.length === 0 ? "Continue" : "Skip for now"}
      </button>
    </div>
  );
}
