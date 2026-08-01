import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { AppShell, Card } from "@/components/app-shell";
import { api } from "@/lib/api";

export const Route = createFileRoute("/roster")({
  head: () => ({
    meta: [
      { title: "Roster — ScoreCheck" },
      { name: "description", content: "Manage gamertag to display name mappings for your crew." },
    ],
  }),
  component: RosterPage,
});

interface PlayerMapping {
  id: string;
  gamertag: string;
  displayName: string;
}

interface MappingMutationResult {
  mapping: PlayerMapping;
  retroactiveCount: number;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

const mappingSchema = z.object({
  gamertag: z.string().min(1, "Required").max(50, "Max 50 characters"),
  displayName: z.string().min(1, "Required").max(50, "Max 50 characters"),
});
type MappingForm = z.infer<typeof mappingSchema>;

function RosterPage() {
  const qc = useQueryClient();

  const { data: mappings = [], isLoading } = useQuery({
    queryKey: ["mappings"],
    queryFn: () => api.get<ApiResponse<PlayerMapping[]>>("/api/mappings").then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (body: MappingForm) =>
      api.post<ApiResponse<MappingMutationResult>>("/api/mappings", body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
      const n = res.data.retroactiveCount;
      toast.success(
        n > 0 ? `Mapping added — ${n} game record${n === 1 ? "" : "s"} renamed` : "Mapping added",
      );
      reset();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & MappingForm) =>
      api.put<ApiResponse<MappingMutationResult>>(`/api/mappings/${id}`, body),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
      const n = res.data.retroactiveCount;
      toast.success(
        n > 0 ? `Mapping saved — ${n} game record${n === 1 ? "" : "s"} renamed` : "Mapping saved",
      );
      setEditingId(null);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/mappings/${id}`),
    // Optimistic: the row goes immediately and comes back if the server refuses.
    //
    // Safe to predict here because a delete has exactly one possible successful outcome.
    // The create and update mutations above are deliberately NOT optimistic: the server
    // decides the new id and reports how many past games a mapping renamed, and guessing
    // either would show the user a number the server never produced.
    onMutate: async (id: string) => {
      await qc.cancelQueries({ queryKey: ["mappings"] });
      const previous = qc.getQueryData<PlayerMapping[]>(["mappings"]);
      qc.setQueryData<PlayerMapping[]>(["mappings"], (old) => old?.filter((m) => m.id !== id));
      setConfirmDeleteId(null);
      return { previous };
    },
    onSuccess: () => {
      toast.success("Mapping deleted");
    },
    onError: (err: Error, _id, context) => {
      // Without this the row stays gone after a refusal and the user believes it worked.
      if (context?.previous) qc.setQueryData(["mappings"], context.previous);
      toast.error(err.message);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["mappings"] });
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<MappingForm>({
    resolver: zodResolver(mappingSchema),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<MappingForm>({ gamertag: "", displayName: "" });
  const [editErrors, setEditErrors] = useState<Partial<Record<keyof MappingForm, string>>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  function startEdit(m: PlayerMapping) {
    setEditingId(m.id);
    setEditValues({ gamertag: m.gamertag, displayName: m.displayName });
    setEditErrors({});
    setConfirmDeleteId(null);
  }

  function saveEdit(id: string) {
    const parsed = mappingSchema.safeParse(editValues);
    if (!parsed.success) {
      const errs: Partial<Record<keyof MappingForm, string>> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as keyof MappingForm;
        errs[key] = issue.message;
      }
      setEditErrors(errs);
      return;
    }
    updateMutation.mutate({ id, ...parsed.data });
  }

  return (
    <AppShell
      eyebrow="Settings"
      title="Player Roster"
      description="Map gamertags to real display names. Set them before uploading and OCR applies them automatically, or add them after and existing records are renamed retroactively."
    >
      <div className="space-y-8">
        {/* Existing mappings table */}
        <Card
          title="Your crew"
          hint="These gamertags are replaced with display names before the review table is shown."
        >
          {isLoading ? (
            <div className="flex h-24 items-center justify-center">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            </div>
          ) : mappings.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No mappings yet — add one below.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-strong bg-secondary/40 text-left">
                    <th className="stamp px-4 py-3 font-normal">Gamertag</th>
                    <th className="stamp px-4 py-3 font-normal">Display Name</th>
                    <th className="stamp px-4 py-3 font-normal" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {mappings.map((m) =>
                    editingId === m.id ? (
                      <tr key={m.id} className="bg-secondary/20">
                        <td className="px-4 py-2">
                          <input
                            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                            value={editValues.gamertag}
                            onChange={(e) =>
                              setEditValues((v) => ({ ...v, gamertag: e.target.value }))
                            }
                            placeholder="Gamertag"
                          />
                          {editErrors.gamertag && (
                            <p className="mt-1 text-xs text-destructive">{editErrors.gamertag}</p>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <input
                            className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                            value={editValues.displayName}
                            onChange={(e) =>
                              setEditValues((v) => ({ ...v, displayName: e.target.value }))
                            }
                            placeholder="Display name"
                          />
                          {editErrors.displayName && (
                            <p className="mt-1 text-xs text-destructive">
                              {editErrors.displayName}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => saveEdit(m.id)}
                              disabled={updateMutation.isPending}
                              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="rounded-md border border-border px-3 py-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      <tr key={m.id} className="hover:bg-secondary/20">
                        <td className="px-4 py-3 font-mono text-xs">{m.gamertag}</td>
                        <td className="px-4 py-3 font-medium">{m.displayName}</td>
                        <td className="px-4 py-3 text-right">
                          {confirmDeleteId === m.id ? (
                            <div className="flex items-center justify-end gap-2 text-xs">
                              <span className="text-muted-foreground">Delete?</span>
                              <button
                                onClick={() => deleteMutation.mutate(m.id)}
                                disabled={deleteMutation.isPending}
                                className="font-medium text-destructive hover:underline disabled:opacity-50"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setConfirmDeleteId(null)}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-3 text-xs">
                              <button
                                onClick={() => startEdit(m)}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                Edit
                              </button>
                              <span className="text-border">·</span>
                              <button
                                onClick={() => {
                                  setConfirmDeleteId(m.id);
                                  setEditingId(null);
                                }}
                                className="text-muted-foreground hover:text-destructive"
                              >
                                Delete
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        {/* Add new mapping form */}
        <Card
          title="Add new mapping"
          hint="Gamertags are matched case-insensitively with substring fallback."
        >
          <form
            onSubmit={handleSubmit((data) => createMutation.mutate(data))}
            className="flex flex-col gap-4 sm:flex-row sm:items-start"
          >
            <div className="flex-1">
              <label className="stamp mb-1.5 block">Gamertag</label>
              <input
                {...register("gamertag")}
                placeholder="e.g. GRIM_AR15"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {errors.gamertag && (
                <p className="mt-1 text-xs text-destructive">{errors.gamertag.message}</p>
              )}
            </div>
            <div className="flex-1">
              <label className="stamp mb-1.5 block">Display Name</label>
              <input
                {...register("displayName")}
                placeholder="e.g. Akif"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {errors.displayName && (
                <p className="mt-1 text-xs text-destructive">{errors.displayName.message}</p>
              )}
            </div>
            <div className="pt-0 sm:pt-[22px]">
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="w-full rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 sm:w-auto"
              >
                {createMutation.isPending ? "Adding…" : "Add"}
              </button>
            </div>
          </form>
        </Card>
      </div>
    </AppShell>
  );
}
