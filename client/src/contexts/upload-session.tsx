import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";

export interface ExtractedPlayer {
  id?: string;
  name: string;
  team: string;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  fgMade: number;
  fgAttempted: number;
  threeMade: number;
  threeAttempted: number;
  ftMade: number;
  ftAttempted: number;
}

export interface UploadResponse {
  extractedData: {
    homeTeam: string;
    awayTeam: string;
    homeScore: number;
    awayScore: number;
    players: ExtractedPlayer[];
  };
  originalImageUrl: string;
  originalFileName: string;
}

export interface GameData {
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
}

export type ItemStatus = "queued" | "extracting" | "ready" | "saving" | "saved" | "error";

export interface UploadItem {
  id: string;
  file: File;
  filename: string;
  previewUrl: string;
  status: ItemStatus;
  errorMsg?: string;
  uploadData?: UploadResponse;
  players: ExtractedPlayer[];
  gameData: GameData;
}

// How many screenshots extract at once. The extraction host is a single scale-to-zero GPU
// with a daily quota, so a small cap keeps a couple moving without flooding one cold start.
const CONCURRENCY = 2;

interface UploadSessionValue {
  items: UploadItem[];
  selectedId: string | null;
  selectedItem: UploadItem | null;
  counts: { pending: number; ready: number; saved: number; error: number };
  allSaved: boolean;
  select: (id: string) => void;
  /** Appends valid image files to the batch. Returns how many were added. */
  addFiles: (files: FileList | File[] | null) => number;
  updatePlayerName: (idx: number, name: string) => void;
  updateStat: (idx: number, key: keyof ExtractedPlayer, value: number) => void;
  updateGameField: (key: keyof GameData, value: string | number) => void;
  retryItem: (id: string) => void;
  removeItem: (id: string) => void;
  startOver: () => void;
  save: () => Promise<void>;
}

const UploadSessionContext = createContext<UploadSessionValue | null>(null);

export function useUploadSession(): UploadSessionValue {
  const ctx = useContext(UploadSessionContext);
  if (!ctx) throw new Error("useUploadSession must be used within an UploadSessionProvider");
  return ctx;
}

/**
 * Holds one upload batch — files, their extraction status, and the review edits —
 * so the state survives navigation between the dropzone (/upload) and the review
 * workspace (/upload/review). Mounted by the /upload layout route, which stays
 * mounted across its children, so a drop on the dropzone and the subsequent hop to
 * the review page share the same in-flight extractions. The batch is intentionally
 * ephemeral: leaving the /upload flow entirely unmounts this provider and frees the
 * object URLs (File objects can't survive a reload anyway).
 */
export function UploadSessionProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Ids whose extraction has been kicked off — guards the pump against starting the
  // same file twice across re-renders (and React StrictMode's double-invoked effects).
  const processingRef = useRef<Set<string>>(new Set());
  // Mirror of items for the unmount cleanup, so that effect need not depend on items.
  const itemsRef = useRef<UploadItem[]>([]);
  itemsRef.current = items;

  // Revoke every preview object URL when the whole upload flow unmounts so a big
  // batch doesn't leak. Individual removals/startOver revoke as they go (below).
  useEffect(() => {
    return () => {
      for (const it of itemsRef.current) URL.revokeObjectURL(it.previewUrl);
    };
  }, []);

  // Poke the extraction host the moment the upload flow opens, so Modal's ~70-85s cold
  // start (container boot + loading the models into VRAM) overlaps with the user picking
  // and reviewing files rather than stalling the first extraction. Fire-and-forget: a
  // failure is a non-event (the upload's own preflight still waits out a cold start), and
  // the server throttles repeat pokes.
  useEffect(() => {
    api.post("/api/screenshots/warmup").catch(() => {});
  }, []);

  const extractItem = useCallback(async (id: string, file: File) => {
    try {
      const form = new FormData();
      form.append("screenshot", file);
      const result = await api.post<UploadResponse>("/api/screenshots/upload", form);
      setItems((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                status: "ready",
                uploadData: result,
                players: result.extractedData.players ?? [],
                gameData: {
                  homeTeam: result.extractedData.homeTeam ?? "",
                  awayTeam: result.extractedData.awayTeam ?? "",
                  homeScore: result.extractedData.homeScore ?? 0,
                  awayScore: result.extractedData.awayScore ?? 0,
                },
              }
            : i,
        ),
      );
    } catch (err) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === id
            ? {
                ...i,
                status: "error",
                errorMsg: err instanceof Error ? err.message : "Extraction failed",
              }
            : i,
        ),
      );
    } finally {
      processingRef.current.delete(id);
    }
  }, []);

  // Pump: whenever a slot frees up and files are queued, start the next one(s).
  useEffect(() => {
    const inflight = items.filter((i) => i.status === "extracting").length;
    const slots = CONCURRENCY - inflight;
    if (slots <= 0) return;
    const toStart = items
      .filter((i) => i.status === "queued" && !processingRef.current.has(i.id))
      .slice(0, slots);
    if (toStart.length === 0) return;
    for (const it of toStart) processingRef.current.add(it.id);
    setItems((prev) =>
      prev.map((i) => (toStart.some((t) => t.id === i.id) ? { ...i, status: "extracting" } : i)),
    );
    for (const it of toStart) void extractItem(it.id, it.file);
  }, [items, extractItem]);

  // Keep a sensible selection. Select the first file immediately — even while it's still
  // queued/extracting — so its screenshot shows the moment you land on the review page,
  // rather than a placeholder until extraction finishes. Then, once a file is saved, advance
  // to the next one that's ready to review.
  useEffect(() => {
    if (items.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    const selected = items.find((i) => i.id === selectedId);
    if (!selected) {
      setSelectedId(items[0].id);
      return;
    }
    if (selected.status === "saved") {
      const nextReady = items.find((i) => i.status === "ready");
      if (nextReady && nextReady.id !== selectedId) setSelectedId(nextReady.id);
    }
  }, [items, selectedId]);

  const addFiles = useCallback((files: FileList | File[] | null): number => {
    if (!files) return 0;
    const arr = Array.from(files).filter((f) => /image\/(png|jpe?g)/.test(f.type));
    if (arr.length === 0) return 0;
    const newItems: UploadItem[] = arr.map((file) => ({
      id: crypto.randomUUID(),
      file,
      filename: file.name,
      previewUrl: URL.createObjectURL(file),
      status: "queued",
      players: [],
      gameData: { homeTeam: "", awayTeam: "", homeScore: 0, awayScore: 0 },
    }));
    setItems((prev) => [...prev, ...newItems]);
    return newItems.length;
  }, []);

  const patchSelected = (patch: (item: UploadItem) => UploadItem) => {
    setItems((prev) => prev.map((i) => (i.id === selectedId ? patch(i) : i)));
  };

  const updatePlayerName = (idx: number, name: string) =>
    patchSelected((i) => ({
      ...i,
      players: i.players.map((p, k) => (k === idx ? { ...p, name } : p)),
    }));

  const updateStat = (idx: number, key: keyof ExtractedPlayer, value: number) =>
    patchSelected((i) => ({
      ...i,
      players: i.players.map((p, k) => (k === idx ? { ...p, [key]: value } : p)),
    }));

  const updateGameField = (key: keyof GameData, value: string | number) =>
    patchSelected((i) => ({ ...i, gameData: { ...i.gameData, [key]: value } }));

  const retryItem = (id: string) => {
    processingRef.current.delete(id);
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status: "queued", errorMsg: undefined } : i)),
    );
  };

  const removeItem = (id: string) => {
    processingRef.current.delete(id);
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((i) => i.id !== id);
    });
  };

  const startOver = () => {
    for (const it of items) URL.revokeObjectURL(it.previewUrl);
    processingRef.current.clear();
    setItems([]);
    setSelectedId(null);
  };

  const save = async () => {
    const item = items.find((i) => i.id === selectedId);
    if (!item || !item.uploadData) return;
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "saving" } : i)));
    try {
      await api.post("/api/screenshots/save", {
        gameData: item.gameData,
        playersData: item.players.map((p) => ({
          name: p.name,
          team: p.team,
          points: p.points,
          rebounds: p.rebounds,
          assists: p.assists,
          steals: p.steals,
          blocks: p.blocks,
          turnovers: p.turnovers,
          fouls: p.fouls,
          fgMade: p.fgMade,
          fgAttempted: p.fgAttempted,
          threeMade: p.threeMade,
          threeAttempted: p.threeAttempted,
          ftMade: p.ftMade,
          ftAttempted: p.ftAttempted,
        })),
        imageUrl: item.uploadData.originalImageUrl,
        originalFileName: item.uploadData.originalFileName,
      });
      setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, status: "saved" } : i)));
    } catch (err) {
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? {
                ...i,
                status: "error",
                errorMsg: err instanceof Error ? err.message : "Save failed",
              }
            : i,
        ),
      );
    }
  };

  const selectedItem = items.find((i) => i.id === selectedId) ?? null;
  const counts = {
    pending: items.filter((i) => i.status === "queued" || i.status === "extracting").length,
    ready: items.filter((i) => i.status === "ready").length,
    saved: items.filter((i) => i.status === "saved").length,
    error: items.filter((i) => i.status === "error").length,
  };
  const allSaved = items.length > 0 && counts.saved === items.length;

  const value: UploadSessionValue = {
    items,
    selectedId,
    selectedItem,
    counts,
    allSaved,
    select: (id: string) => setSelectedId(id),
    addFiles,
    updatePlayerName,
    updateStat,
    updateGameField,
    retryItem,
    removeItem,
    startOver,
    save,
  };

  return <UploadSessionContext.Provider value={value}>{children}</UploadSessionContext.Provider>;
}
