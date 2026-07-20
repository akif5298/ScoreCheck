import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useSquads } from "@/contexts/squad-context";
import { api, ACTIVE_SQUAD_KEY } from "@/lib/api";

/**
 * The active-squad switcher, pinned above the sidebar's Workspace label.
 *
 * Load-bearing, not decorative: uploads target the active squad, so the current scope must
 * be unmissable. Switching reloads the app (see squad-context) so every page re-scopes.
 */
export function SquadSwitcher() {
  const { squads, activeSquad, loading, switchSquad } = useSquads();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  if (loading) {
    return (
      <div className="mx-3 mt-3 h-14 animate-pulse rounded-md border border-border bg-secondary/40" />
    );
  }

  // No squads loaded (e.g. request failed): render nothing rather than a broken control.
  if (!activeSquad) return null;

  const initials = activeSquad.name.slice(0, 2).toUpperCase();

  const createSquad = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await api.post<{ success: boolean; data: { id: string } }>("/api/squads", {
        name: trimmed,
      });
      // Switch into the new squad. switchSquad persists + reloads, landing on the overview.
      localStorage.setItem(ACTIVE_SQUAD_KEY, res.data.id);
      await api.post(`/api/squads/${res.data.id}/activate`);
      window.location.assign("/squad");
    } catch (err) {
      setBusy(false);
      toast.error((err as Error).message || "Could not create squad");
    }
  };

  return (
    <div className="px-3 pt-3">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2.5 rounded-md border border-border bg-card px-3 py-2.5 text-left hover:bg-secondary/60">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-[11px] font-semibold text-primary-foreground">
              {initials}
            </span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-medium">{activeSquad.name}</span>
              <span className="block text-[11px] text-muted-foreground">
                {activeSquad.isPersonal
                  ? "Personal"
                  : `${activeSquad.memberCount} member${activeSquad.memberCount === 1 ? "" : "s"}`}
              </span>
            </span>
            <span className="font-mono text-[10px] text-muted-foreground">▼</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="stamp">Your squads</DropdownMenuLabel>
          {squads.map((s) => (
            <DropdownMenuItem
              key={s.id}
              onSelect={() => {
                if (s.id !== activeSquad.id) void switchSquad(s.id);
              }}
              className="flex items-center justify-between gap-2"
            >
              <span className="min-w-0 flex-1 truncate">
                {s.name}
                {s.isPersonal && (
                  <span className="ml-1 text-[10px] text-muted-foreground">personal</span>
                )}
              </span>
              {s.id === activeSquad.id ? (
                <span className="text-primary">✓</span>
              ) : (
                <span className="font-mono text-[10px] text-muted-foreground">{s.gameCount}g</span>
              )}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          {!activeSquad.isPersonal && (
            <DropdownMenuItem onSelect={() => void navigate({ to: "/squad" })}>
              Manage this squad
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setCreating(true)}>+ Create squad</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={creating} onOpenChange={(o) => !busy && setCreating(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create a squad</DialogTitle>
            <DialogDescription>
              A squad is a shared pool of games and analytics. You can invite friends and move your
              existing games in afterwards.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            placeholder="Squad name (e.g. Tuesday Run)"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void createSquad();
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreating(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void createSquad()} disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
