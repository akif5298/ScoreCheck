import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { AppShell, Card, Badge } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/contexts/auth-context";
import { useSquads } from "@/contexts/squad-context";

export const Route = createFileRoute("/games/")({
  head: () => ({
    meta: [
      { title: "Games — ScoreCheck" },
      {
        name: "description",
        content: "Full game history with box scores for your NBA 2K26 league.",
      },
    ],
  }),
  component: GamesPage,
});

interface Game {
  id: string;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  uploadedByUserId: string;
  players: unknown[] | null;
}

interface Member {
  userId: string;
  name: string | null;
  email: string;
}

interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
  /** Present on paginated list endpoints only. */
  meta?: PaginationMeta;
}

interface MoveResult {
  moved: string[];
  duplicates: unknown[];
  renamed: unknown[];
  unmapped: string[];
}

function GamesPage() {
  const { user } = useAuth();
  const { activeSquad, squads } = useSquads();
  const qc = useQueryClient();

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<Game | null>(null);
  const [page, setPage] = useState(1);

  // Switching squads must not leave you on page 4 of a squad that has one page.
  useEffect(() => {
    setPage(1);
  }, [activeSquad?.id]);

  const isOwner = activeSquad?.role === "OWNER";
  const moveTargets = squads.filter((s) => s.id !== activeSquad?.id);

  const {
    data: gamesPage,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["games", activeSquad?.id, page],
    queryFn: () => api.get<ApiResponse<Game[]>>(`/api/screenshots/games?page=${page}`),
    // Keeps the current page on screen while the next one loads, instead of collapsing to
    // the empty/loading state on every page change.
    placeholderData: keepPreviousData,
  });
  const games = gamesPage?.data ?? [];
  const meta = gamesPage?.meta;

  // Attribution names, only meaningful in a shared squad.
  const { data: members = [] } = useQuery({
    queryKey: ["squad-members", activeSquad?.id],
    queryFn: () =>
      api.get<ApiResponse<Member[]>>(`/api/squads/${activeSquad!.id}/members`).then((r) => r.data),
    enabled: !!activeSquad && !activeSquad.isPersonal,
  });
  const nameFor = (userId: string): string | null => {
    const m = members.find((mm) => mm.userId === userId);
    return m ? (m.name ?? m.email) : null;
  };

  const move = useMutation({
    mutationFn: ({ targetId, gameIds }: { targetId: string; gameIds: string[] }) =>
      api.post<ApiResponse<MoveResult>>(`/api/squads/${targetId}/games/move`, { gameIds }),
    onSuccess: (res) => {
      const r = res.data;
      const parts = [`Moved ${r.moved.length} game${r.moved.length === 1 ? "" : "s"}.`];
      if (r.duplicates.length) parts.push(`${r.duplicates.length} already there.`);
      if (r.unmapped.length) parts.push(`${r.unmapped.length} name(s) need mapping.`);
      toast.success(parts.join(" "));
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["games"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const del = useMutation({
    mutationFn: (gameId: string) => api.del(`/api/screenshots/games/${gameId}`),
    // Optimistic: drop the row immediately, put it back if the server refuses.
    //
    // Every cached page is patched, not just the visible one, because the delete can be
    // confirmed from a dialog after paging around. The snapshot returned here is the whole
    // set of previous page caches, so a rollback restores all of them together.
    onMutate: async (gameId: string) => {
      await qc.cancelQueries({ queryKey: ["games"] });
      const previous = qc.getQueriesData<ApiResponse<Game[]>>({ queryKey: ["games"] });

      qc.setQueriesData<ApiResponse<Game[]>>({ queryKey: ["games"] }, (old) =>
        old
          ? {
              ...old,
              data: old.data.filter((g) => g.id !== gameId),
              // Keep the count honest while the request is in flight, or the footer reads
              // "25 of 60" against 24 visible rows.
              meta: old.meta ? { ...old.meta, total: Math.max(0, old.meta.total - 1) } : undefined,
            }
          : old,
      );

      setConfirmDelete(null);
      setSelected(new Set());
      return { previous };
    },
    onSuccess: () => {
      toast.success("Game deleted");
    },
    onError: (err: Error, _gameId, context) => {
      // Restore every page cache captured before the optimistic edit.
      context?.previous?.forEach(([key, data]) => qc.setQueryData(key, data));
      toast.error(err.message);
      setConfirmDelete(null);
    },
    // Reconcile with the server either way: an optimistic delete leaves the current page
    // one row short until the next page's first row is pulled up.
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["games"] });
    },
  });

  const canModify = (g: Game) => isOwner || g.uploadedByUserId === user?.id;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = games.length > 0 && selected.size === games.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(games.map((g) => g.id)));

  if (isLoading) {
    return (
      <AppShell eyebrow="History" title="Games" description="All uploaded box scores.">
        <div className="flex h-48 items-center justify-center">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
        </div>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell eyebrow="History" title="Games" description="All uploaded box scores.">
        <Card>
          <p className="text-sm text-destructive">{(error as Error).message}</p>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell
      eyebrow="History"
      title="Games"
      description="Every uploaded box score in reverse-chronological order."
    >
      {/* Bulk action bar — appears only with a selection and somewhere to move to. */}
      {selected.size > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-border bg-secondary/40 px-4 py-3">
          <span className="text-sm font-medium">
            {selected.size} selected
            <button
              onClick={() => setSelected(new Set())}
              className="ml-3 text-xs text-muted-foreground underline-offset-4 hover:underline"
            >
              Clear
            </button>
          </span>
          {moveTargets.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  disabled={move.isPending}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {move.isPending ? "Moving…" : "Move to squad"}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="stamp">Move selected into</DropdownMenuLabel>
                {moveTargets.map((s) => (
                  <DropdownMenuItem
                    key={s.id}
                    onSelect={() => move.mutate({ targetId: s.id, gameIds: [...selected] })}
                  >
                    {s.name}
                    {s.isPersonal && (
                      <span className="ml-1 text-[10px] text-muted-foreground">personal</span>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span className="text-xs text-muted-foreground">
              Create another squad to move games into it.
            </span>
          )}
        </div>
      )}

      <Card padding="none">
        {games.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No games yet — upload a box score screenshot to get started.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-strong bg-secondary/40 text-left">
                  <th className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      aria-label="Select all games"
                      className="h-4 w-4 rounded border-border accent-primary"
                    />
                  </th>
                  <th className="stamp py-3 pr-3 font-normal">Matchup</th>
                  <th className="stamp px-2 py-3 text-right font-normal">Score</th>
                  {activeSquad && !activeSquad.isPersonal && (
                    <th className="stamp px-4 py-3 font-normal">Uploaded by</th>
                  )}
                  <th className="stamp px-2 py-3 text-right font-normal">Players</th>
                  <th className="stamp px-4 py-3 text-right font-normal" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {games.map((g) => {
                  const winner = g.homeScore >= g.awayScore ? g.homeTeam : g.awayTeam;
                  const uploader = nameFor(g.uploadedByUserId);
                  return (
                    <tr
                      key={g.id}
                      className={selected.has(g.id) ? "bg-primary/5" : "hover:bg-secondary/40"}
                    >
                      <td className="px-4 py-4">
                        <input
                          type="checkbox"
                          checked={selected.has(g.id)}
                          onChange={() => toggle(g.id)}
                          aria-label={`Select ${g.homeTeam} vs ${g.awayTeam}`}
                          className="h-4 w-4 rounded border-border accent-primary"
                        />
                      </td>
                      <td className="py-4 pr-3">
                        <Link
                          to="/games/$gameId"
                          params={{ gameId: g.id }}
                          className="font-display font-semibold hover:text-primary"
                        >
                          {g.homeTeam} vs {g.awayTeam}
                        </Link>
                        <div className="mt-0.5 flex items-center gap-2">
                          <span className="stamp">
                            {g.date ? formatDate(g.date.slice(0, 10), { year: true }) : "—"}
                          </span>
                          <Badge tone="success">{winner} won</Badge>
                        </div>
                      </td>
                      <td className="px-2 text-right font-mono font-semibold tabular-nums">
                        {g.homeScore}–{g.awayScore}
                      </td>
                      {activeSquad && !activeSquad.isPersonal && (
                        <td className="px-4 py-4">
                          {uploader ? (
                            <div className="flex items-center gap-2">
                              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-secondary text-[10px] font-semibold">
                                {uploader.slice(0, 2).toUpperCase()}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {g.uploadedByUserId === user?.id ? "You" : uploader}
                              </span>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-2 text-right font-mono tabular-nums text-muted-foreground">
                        {g.players?.length ?? 0}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {canModify(g) ? (
                          <button
                            onClick={() => setConfirmDelete(g)}
                            className="text-xs text-muted-foreground hover:text-destructive"
                          >
                            Delete
                          </button>
                        ) : (
                          <span
                            className="text-xs text-muted-foreground/40"
                            title="Only the uploader or squad owner can delete this game"
                          >
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {meta && meta.totalPages > 1 && (
          <nav
            className="flex items-center justify-between gap-4 border-t border-border pt-4 mt-4"
            aria-label="Games pagination"
          >
            <p className="text-sm text-muted-foreground" aria-live="polite">
              Page {meta.page} of {meta.totalPages} · {meta.total} game
              {meta.total === 1 ? "" : "s"}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={meta.page <= 1}
                title="Go to the previous page of games"
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(meta.totalPages, p + 1))}
                disabled={meta.page >= meta.totalPages}
                title="Go to the next page of games"
              >
                Next
              </Button>
            </div>
          </nav>
        )}
      </Card>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this game?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && (
                <>
                  {confirmDelete.homeTeam} vs {confirmDelete.awayTeam} will be removed for everyone
                  in this squad, along with its players and screenshot. This can't be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={del.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (confirmDelete) del.mutate(confirmDelete.id);
              }}
              disabled={del.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {del.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
