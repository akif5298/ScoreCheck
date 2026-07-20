import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { api, ACTIVE_SQUAD_KEY } from "@/lib/api";
import { useAuth } from "@/contexts/auth-context";

export interface Squad {
  id: string;
  name: string;
  isPersonal: boolean;
  role: "OWNER" | "MEMBER";
  memberCount: number;
  gameCount: number;
  isActive: boolean;
}

interface SquadContextValue {
  squads: Squad[];
  activeSquad: Squad | null;
  loading: boolean;
  /** Switches scope and reloads the app into it. Never returns on success. */
  switchSquad: (squadId: string) => Promise<void>;
  refresh: () => Promise<void>;
}

const SquadContext = createContext<SquadContextValue | undefined>(undefined);

export function useSquads(): SquadContextValue {
  const ctx = useContext(SquadContext);
  if (!ctx) throw new Error("useSquads must be used within SquadProvider");
  return ctx;
}

function readStoredActive(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem(ACTIVE_SQUAD_KEY);
}

/**
 * Active-squad state for the switcher.
 *
 * The active squad is persisted in localStorage (same mechanism as the auth token) and read
 * directly by buildHeaders, so every request carries X-Squad-Id. Because that key is shared
 * across tabs, all tabs share one active squad — switching in one switches them all. That is
 * deliberate: uploads target the active squad, and a per-tab scope would make it too easy to
 * upload into the wrong one.
 *
 * Data pages fetch imperatively (useEffect) or via React Query, so the only way to guarantee
 * every page re-scopes on a switch — with no stale cross-squad data left rendered — is a full
 * reload. switchSquad therefore reloads rather than updating state in place.
 */
export function SquadProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [squads, setSquads] = useState<Squad[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await api.get<{ success: boolean; data: Squad[] }>("/api/squads");
    const list = res.data ?? [];
    setSquads(list);

    // Seed the header key from the server's active squad when the switcher has not written
    // one yet (fresh login, or a new device). Keeps client and server agreeing on scope.
    if (list.length > 0 && typeof localStorage !== "undefined") {
      const stored = readStoredActive();
      const storedIsValid = stored && list.some((s) => s.id === stored);
      if (!storedIsValid) {
        const active = list.find((s) => s.isActive) ?? list[0];
        localStorage.setItem(ACTIVE_SQUAD_KEY, active.id);
      }
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setSquads([]);
      setLoading(false);
      return;
    }
    load()
      .catch(() => setSquads([]))
      .finally(() => setLoading(false));
  }, [user, authLoading, load]);

  const switchSquad = useCallback(async (squadId: string) => {
    // Persist server-side (so a new device starts here) before reloading. The reload is what
    // re-scopes every already-mounted page; state alone would leave stale data on screen.
    await api.post(`/api/squads/${squadId}/activate`);
    localStorage.setItem(ACTIVE_SQUAD_KEY, squadId);
    window.location.assign("/");
  }, []);

  const storedActive = readStoredActive();
  const activeSquad =
    squads.find((s) => s.id === storedActive) ??
    squads.find((s) => s.isActive) ??
    squads[0] ??
    null;

  return (
    <SquadContext.Provider value={{ squads, activeSquad, loading, switchSquad, refresh: load }}>
      {children}
    </SquadContext.Provider>
  );
}
