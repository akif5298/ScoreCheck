import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell, Card, Metric, Badge } from "@/components/app-shell";
import { useAuth } from "@/contexts/auth-context";
import { api } from "@/lib/api";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin — ScoreCheck" },
      {
        name: "description",
        content: "Manage users and games across the whole instance.",
      },
    ],
  }),
  component: Admin,
});

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface AdminUser {
  id: string;
  email: string;
  name: string | null;
  role: "USER" | "ADMIN";
  createdAt: string;
  _count: { uploadedGames: number };
}

interface AdminGameUser {
  id: string;
  email: string;
  name: string | null;
}

interface AdminDashboard {
  totalUsers: number;
  totalGames: number;
  totalPlayers: number;
  recentGames: Array<{
    id: string;
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    createdAt: string;
    uploadedBy: AdminGameUser;
  }>;
  topUsers: Array<{
    id: string;
    email: string;
    name: string | null;
    _count: { uploadedGames: number };
  }>;
}

function Admin() {
  const { user, loading } = useAuth();

  if (!loading && user && user.role !== "ADMIN") {
    return (
      <AppShell eyebrow="Admin" title="Admin" description="Restricted area.">
        <Card title="Not authorized" hint="Admins only">
          <p className="text-sm text-muted-foreground">
            Your account doesn't have admin access. If you think it should, ask the instance owner.
          </p>
        </Card>
      </AppShell>
    );
  }

  return <AdminDashboardView selfId={user?.id ?? ""} />;
}

function AdminDashboardView({ selfId }: { selfId: string }) {
  const qc = useQueryClient();
  const [confirmDeleteUser, setConfirmDeleteUser] = useState<string | null>(null);
  const [confirmDeleteGame, setConfirmDeleteGame] = useState<string | null>(null);

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ["admin", "dashboard"],
    queryFn: () => api.get<ApiResponse<AdminDashboard>>("/api/admin/dashboard").then((r) => r.data),
  });

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ["admin", "users"],
    queryFn: () => api.get<ApiResponse<AdminUser[]>>("/api/admin/users").then((r) => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["admin"] });
  };

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: "USER" | "ADMIN" }) =>
      api.patch<ApiResponse<AdminUser>>(`/api/admin/users/${userId}/role`, { role }),
    onSuccess: (res) => {
      invalidate();
      toast.success(
        `${res.data.email} is now ${res.data.role === "ADMIN" ? "an admin" : "a member"}`,
      );
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) => api.del(`/api/admin/users/${userId}`),
    onSuccess: () => {
      invalidate();
      toast.success("User deleted");
      setConfirmDeleteUser(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteGameMutation = useMutation({
    mutationFn: (gameId: string) => api.del(`/api/admin/games/${gameId}`),
    onSuccess: () => {
      invalidate();
      toast.success("Game deleted");
      setConfirmDeleteGame(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <AppShell
      eyebrow="Instance owner"
      title="Admin"
      description="Manage users and games across the whole instance."
    >
      <section className="grid gap-4 sm:grid-cols-3">
        <Metric label="Users" value={dashboardLoading ? "…" : (dashboard?.totalUsers ?? 0)} />
        <Metric label="Games" value={dashboardLoading ? "…" : (dashboard?.totalGames ?? 0)} />
        <Metric
          label="Player rows"
          value={dashboardLoading ? "…" : (dashboard?.totalPlayers ?? 0)}
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card title="Users" hint="Everyone with an account" padding="none">
          {usersLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-strong bg-secondary/40 text-left">
                  <th className="stamp px-6 py-3 font-normal">User</th>
                  <th className="stamp pr-3 font-normal">Role</th>
                  <th className="stamp px-2 text-right font-normal">Games</th>
                  <th className="stamp px-6 text-right font-normal">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {users.map((u) => {
                  const isSelf = u.id === selfId;
                  return (
                    <tr key={u.id} className="hover:bg-secondary/40">
                      <td className="px-6 py-3.5">
                        <div className="font-medium">{u.name ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{u.email}</div>
                      </td>
                      <td className="pr-3">
                        {u.role === "ADMIN" ? (
                          <Badge tone="primary">Admin</Badge>
                        ) : (
                          <Badge tone="outline">Member</Badge>
                        )}
                      </td>
                      <td className="px-2 text-right font-mono tabular-nums">
                        {u._count.uploadedGames}
                      </td>
                      <td className="px-6 py-3.5 text-right">
                        {isSelf ? (
                          <span className="text-xs text-muted-foreground">you</span>
                        ) : confirmDeleteUser === u.id ? (
                          <span className="inline-flex gap-2">
                            <button
                              onClick={() => deleteUserMutation.mutate(u.id)}
                              disabled={deleteUserMutation.isPending}
                              className="rounded-md bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => setConfirmDeleteUser(null)}
                              className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-secondary"
                            >
                              Cancel
                            </button>
                          </span>
                        ) : (
                          <span className="inline-flex gap-2">
                            <button
                              onClick={() =>
                                roleMutation.mutate({
                                  userId: u.id,
                                  role: u.role === "ADMIN" ? "USER" : "ADMIN",
                                })
                              }
                              disabled={roleMutation.isPending}
                              className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-secondary disabled:opacity-50"
                            >
                              {u.role === "ADMIN" ? "Demote" : "Make admin"}
                            </button>
                            <button
                              onClick={() => setConfirmDeleteUser(u.id)}
                              className="rounded-md border border-destructive/40 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
                            >
                              Delete
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Recent games" hint="Latest uploads, any user">
          {dashboardLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : !dashboard || dashboard.recentGames.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">
              No games yet.
            </div>
          ) : (
            <ul className="space-y-3">
              {dashboard.recentGames.map((g) => (
                <li key={g.id} className="rounded-md border border-border bg-background p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-sm font-semibold">
                      {g.awayTeam} {g.awayScore} @ {g.homeTeam} {g.homeScore}
                    </span>
                    {confirmDeleteGame === g.id ? (
                      <span className="inline-flex gap-2">
                        <button
                          onClick={() => deleteGameMutation.mutate(g.id)}
                          disabled={deleteGameMutation.isPending}
                          className="rounded-md bg-destructive px-2.5 py-1 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmDeleteGame(null)}
                          className="rounded-md border border-border px-2.5 py-1 text-xs hover:bg-secondary"
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setConfirmDeleteGame(g.id)}
                        className="rounded-md border border-destructive/40 px-2.5 py-1 text-xs text-destructive hover:bg-destructive/10"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                  <div className="stamp mt-1">
                    {g.uploadedBy.name ?? g.uploadedBy.email} ·{" "}
                    {new Date(g.createdAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
