import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell, Card, Badge } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { useSquads } from "@/contexts/squad-context";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/squad")({
  head: () => ({
    meta: [
      { title: "Squad — ScoreCheck" },
      {
        name: "description",
        content: "Manage your squad: members, invites, and your roster identity.",
      },
    ],
  }),
  component: SquadPage,
});

interface Member {
  userId: string;
  name: string | null;
  email: string;
  role: "OWNER" | "MEMBER";
  joinedAt: string;
  displayName: string | null;
  gamertag: string | null;
  uploadedGames: number;
}

interface Invite {
  id: string;
  token: string;
  expiresAt: string;
  maxUses: number;
  usedCount: number;
  revokedAt: string | null;
  createdAt: string;
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

function initials(name: string | null, email: string): string {
  const base = name?.trim() || email;
  return base
    .split(/[\s@.]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function SquadPage() {
  const { activeSquad, loading } = useSquads();

  if (loading) {
    return (
      <AppShell eyebrow="Squad" title="Squad">
        <div className="flex h-48 items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        </div>
      </AppShell>
    );
  }

  if (!activeSquad) {
    return (
      <AppShell eyebrow="Squad" title="Squad">
        <Card>
          <p className="text-sm text-muted-foreground">No squad selected.</p>
        </Card>
      </AppShell>
    );
  }

  if (activeSquad.isPersonal) {
    return (
      <AppShell
        eyebrow="Squad"
        title="Personal space"
        description="This is your private scope — only you can see these games."
      >
        <Card title="Play with friends">
          <p className="text-sm text-muted-foreground">
            Create a squad from the switcher in the sidebar to share a pool of games and analytics
            with your crew. Once it exists you can invite people and move your existing games into
            it.
          </p>
        </Card>
      </AppShell>
    );
  }

  return (
    <SharedSquad
      squadId={activeSquad.id}
      name={activeSquad.name}
      isOwner={activeSquad.role === "OWNER"}
    />
  );
}

function SharedSquad({
  squadId,
  name,
  isOwner,
}: {
  squadId: string;
  name: string;
  isOwner: boolean;
}) {
  const qc = useQueryClient();

  const { data: members = [], isLoading: membersLoading } = useQuery({
    queryKey: ["squad-members", squadId],
    queryFn: () =>
      api.get<ApiResponse<Member[]>>(`/api/squads/${squadId}/members`).then((r) => r.data),
  });

  const { data: roster = [] } = useQuery({
    queryKey: ["squad-roster", squadId],
    queryFn: () =>
      api.get<ApiResponse<RosterEntry[]>>(`/api/squads/${squadId}/roster`).then((r) => r.data),
  });

  // Invite tokens are credentials, so only the owner may list them.
  const { data: invites = [] } = useQuery({
    queryKey: ["squad-invites", squadId],
    queryFn: () =>
      api.get<ApiResponse<Invite[]>>(`/api/squads/${squadId}/invites`).then((r) => r.data),
    enabled: isOwner,
  });

  const createInvite = useMutation({
    mutationFn: () => api.post<ApiResponse<Invite>>(`/api/squads/${squadId}/invites`, {}),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["squad-invites", squadId] });
      void copyLink(res.data.token);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const revokeInvite = useMutation({
    mutationFn: (inviteId: string) => api.del(`/api/squads/${squadId}/invites/${inviteId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["squad-invites", squadId] });
      toast.success("Invite revoked");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const claim = useMutation({
    mutationFn: (mappingId: string) =>
      api.post<ApiResponse<RosterEntry>>(`/api/squads/${squadId}/roster/claim`, { mappingId }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["squad-roster", squadId] });
      qc.invalidateQueries({ queryKey: ["squad-members", squadId] });
      toast.success(`You're now ${res.data.displayName} on this roster`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const inviteUrl = (token: string) => `${window.location.origin}/join/${token}`;

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl(token));
      toast.success("Invite link copied to clipboard");
    } catch {
      toast.message("Invite link", { description: inviteUrl(token) });
    }
  }

  const activeInvites = invites.filter((i) => !i.revokedAt && new Date(i.expiresAt) > new Date());
  const youClaimed = roster.find((r) => r.isYou);

  return (
    <AppShell
      eyebrow="Squad"
      title={name}
      description={`${members.length} member${members.length === 1 ? "" : "s"} sharing games and analytics.`}
    >
      <div className="space-y-8">
        {/* Members */}
        <Card title="Members" hint="Everyone here sees the squad's shared games.">
          {membersLoading ? (
            <div className="flex h-20 items-center justify-center">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-strong bg-secondary/40 text-left">
                    <th className="stamp px-4 py-3 font-normal">Member</th>
                    <th className="stamp px-4 py-3 font-normal">Roster identity</th>
                    <th className="stamp px-4 py-3 text-right font-normal">Uploads</th>
                    <th className="stamp px-4 py-3 text-right font-normal">Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members.map((m) => (
                    <tr key={m.userId} className="hover:bg-secondary/20">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">
                            {initials(m.name, m.email)}
                          </span>
                          <div className="leading-tight">
                            <div className="font-medium">{m.name ?? m.email}</div>
                            <div className="text-[11px] text-muted-foreground">
                              joined {formatDate(m.joinedAt.slice(0, 10), { year: true })}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {m.displayName ? (
                          <span className="font-medium">{m.displayName}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                        {m.uploadedGames}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Badge tone={m.role === "OWNER" ? "primary" : "outline"}>
                          {m.role.toLowerCase()}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Identify yourself */}
        <Card
          title="Which player are you?"
          hint="Claiming your roster entry links these stats to you — it powers your cross-squad career view later."
        >
          {youClaimed ? (
            <p className="text-sm">
              You're identified as <span className="font-semibold">{youClaimed.displayName}</span>{" "}
              on this roster.{" "}
              <span className="text-muted-foreground">
                Claim a different entry below to change it.
              </span>
            </p>
          ) : (
            <p className="mb-4 text-sm text-muted-foreground">
              You haven't picked your player yet. Claim the entry that's you:
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {roster.length === 0 && (
              <span className="text-sm text-muted-foreground">
                No roster entries yet — they appear as games are added and mapped.
              </span>
            )}
            {roster.map((r) => (
              <button
                key={r.id}
                disabled={r.isYou || (r.linkedUserId !== null && !r.isYou) || claim.isPending}
                onClick={() => claim.mutate(r.id)}
                className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  r.isYou
                    ? "border-primary bg-primary/10 text-primary"
                    : r.linkedUserId
                      ? "cursor-not-allowed border-border text-muted-foreground/50"
                      : "border-border hover:bg-secondary"
                }`}
                title={r.linkedUserId && !r.isYou ? "Already claimed by another member" : undefined}
              >
                {r.displayName}
                {r.isYou && " ✓"}
              </button>
            ))}
          </div>
        </Card>

        {/* Invites — owner only */}
        {isOwner && (
          <Card
            title="Invite links"
            hint="Anyone with a link can join. Links last 7 days; revoke any time."
            action={
              <Button
                size="sm"
                onClick={() => createInvite.mutate()}
                disabled={createInvite.isPending}
              >
                {createInvite.isPending ? "Creating…" : "New invite link"}
              </Button>
            }
          >
            {activeInvites.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No active invite links. Create one to bring someone in.
              </p>
            ) : (
              <div className="space-y-2">
                {activeInvites.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center gap-3 rounded-md border border-border bg-secondary/20 px-3 py-2"
                  >
                    <code className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
                      {inviteUrl(inv.token)}
                    </code>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {inv.maxUses === 0 ? "unlimited" : `${inv.usedCount}/${inv.maxUses} used`} ·
                      expires {formatDate(inv.expiresAt.slice(0, 10), { year: true })}
                    </span>
                    <button
                      onClick={() => void copyLink(inv.token)}
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-secondary"
                    >
                      Copy
                    </button>
                    <button
                      onClick={() => revokeInvite.mutate(inv.id)}
                      disabled={revokeInvite.isPending}
                      className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-destructive disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  );
}
