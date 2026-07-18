import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AppShell, Card, Badge } from "@/components/app-shell";
import { useAuth } from "@/contexts/auth-context";
import { api } from "@/lib/api";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — ScoreCheck" },
      {
        name: "description",
        content: "Account and security preferences for ScoreCheck.",
      },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleSignOut = () => {
    logout();
    void navigate({ to: "/login" });
  };

  if (!user) return null; // AppShell redirects to /login

  const initials =
    (user.name ?? user.email)
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase())
      .join("") || "?";

  const memberSince = new Date(user.createdAt).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });

  return (
    <AppShell
      eyebrow="Preferences"
      title="Settings"
      description="Manage your account and security."
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card title="Account" hint="Your ScoreCheck identity">
          <div className="flex items-center gap-4 border-b border-border pb-5">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground font-display text-lg font-semibold">
              {initials}
            </div>
            <div className="flex-1">
              <div className="font-display text-base font-semibold">{user.name ?? "—"}</div>
              <div className="text-xs text-muted-foreground">{user.email}</div>
              <div className="mt-1.5">
                <Badge tone={user.role === "ADMIN" ? "primary" : "default"}>
                  {user.role === "ADMIN" ? "Admin" : "Member"}
                </Badge>
              </div>
            </div>
          </div>
          <dl className="mt-5 space-y-3 text-sm">
            <Row label="Member since" value={memberSince} />
            <Row label="Sign-in" value="Email + password" />
          </dl>
          <button
            onClick={handleSignOut}
            className="mt-6 inline-flex h-9 items-center rounded-md border border-border bg-surface px-4 text-sm font-medium hover:bg-secondary"
          >
            Sign out
          </button>
        </Card>

        <ChangePasswordCard />
      </div>
    </AppShell>
  );
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const inputClass =
    "w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary";

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New passwords don't match");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/api/auth/change-password", { currentPassword, newPassword });
      toast.success("Password updated");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card title="Change password" hint="Pick something you don't use elsewhere">
      <form onSubmit={(e) => void handleSubmit(e)} className="flex max-w-md flex-col gap-4">
        <div>
          <label htmlFor="currentPassword" className="stamp mb-1.5 block">
            Current password
          </label>
          <input
            id="currentPassword"
            type="password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            autoComplete="current-password"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="newPassword" className="stamp mb-1.5 block">
            New password
          </label>
          <input
            id="newPassword"
            type="password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
            autoComplete="new-password"
            minLength={8}
            maxLength={72}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="confirmPassword" className="stamp mb-1.5 block">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            className={inputClass}
          />
        </div>
        <div>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </Card>
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
