/**
 * The roster page — gamertag to display-name mappings.
 *
 * These mappings are what turn OCR's raw gamertags into people, and adding one renames
 * existing game records retroactively. That retroactive count is the only signal the user
 * gets that historical data changed, so reporting it accurately matters more than it looks:
 * an unmapped name accrues no stats at all until it is mapped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
}));

vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Card: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
}));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

import { Route } from "@/routes/roster";
import { api } from "@/lib/api";

const RosterPage = (Route as unknown as { component: () => ReactNode }).component;
const get = vi.mocked(api.get);
const post = vi.mocked(api.post);
const put = vi.mocked(api.put);
const del = vi.mocked(api.del);

const MAPPINGS = [
  { id: "m1", gamertag: "GRIM_AR15", displayName: "Akif" },
  { id: "m2", gamertag: "nilly23", displayName: "Nillan" },
];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RosterPage />
    </QueryClientProvider>,
  );
}

/**
 * Renders and waits for the query to settle. Waiting on the fetch *call* is not enough — the
 * table only exists after the promise resolves and React re-renders, so a synchronous
 * getByText immediately afterwards finds the spinner instead.
 */
async function renderLoaded() {
  const result = renderPage();
  await waitFor(() => expect(result.container.querySelector(".animate-spin")).toBeNull());
  return result;
}

/** The add-mapping form's two inputs, found by placeholder — the labels are not associated. */
function addForm() {
  return {
    gamertag: screen.getByPlaceholderText("e.g. GRIM_AR15"),
    displayName: screen.getByPlaceholderText("e.g. Akif"),
    submit: screen.getByRole("button", { name: "Add" }),
  };
}

/** The row for a given display name. */
function rowFor(displayName: string): HTMLElement {
  return screen.getByText(displayName).closest("tr") as HTMLElement;
}

beforeEach(() => {
  toastError.mockReset();
  toastSuccess.mockReset();
  get.mockReset().mockResolvedValue({ success: true, data: MAPPINGS });
  post.mockReset().mockResolvedValue({
    success: true,
    data: { mapping: { id: "m3", gamertag: "x", displayName: "y" }, retroactiveCount: 0 },
  });
  put.mockReset().mockResolvedValue({
    success: true,
    data: { mapping: MAPPINGS[0], retroactiveCount: 0 },
  });
  del.mockReset().mockResolvedValue({ success: true });
});

describe("the route definition", () => {
  it("sets a title and description", () => {
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();

    expect(head.meta[0]).toEqual({ title: "Roster — ScoreCheck" });
  });
});

describe("the mappings table", () => {
  it("shows a spinner while loading", () => {
    get.mockReturnValue(new Promise(() => {}));

    const { container } = renderPage();

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("prompts for a first mapping when there are none", async () => {
    get.mockResolvedValue({ success: true, data: [] });

    await renderLoaded();

    expect(await screen.findByText(/No mappings yet — add one below\./)).toBeInTheDocument();
  });

  it("lists each gamertag against its display name", async () => {
    await renderLoaded();

    const row = rowFor("Akif");
    expect(within(row).getByText("GRIM_AR15")).toBeInTheDocument();
  });
});

describe("adding a mapping", () => {
  it("requires both fields", async () => {
    await renderLoaded();

    await userEvent.click(addForm().submit);

    // Both come from the same zod schema the server validates against.
    expect(await screen.findAllByText("Required")).toHaveLength(2);
    expect(post).not.toHaveBeenCalled();
  });

  it("rejects a gamertag over 50 characters", async () => {
    await renderLoaded();
    const form = addForm();

    await userEvent.type(form.gamertag, "g".repeat(51));
    await userEvent.type(form.displayName, "Akif");
    await userEvent.click(form.submit);

    expect(await screen.findByText("Max 50 characters")).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("posts a valid mapping", async () => {
    await renderLoaded();
    const form = addForm();

    await userEvent.type(form.gamertag, "xxakifxx");
    await userEvent.type(form.displayName, "Akif");
    await userEvent.click(form.submit);

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/mappings", {
        gamertag: "xxakifxx",
        displayName: "Akif",
      }),
    );
  });

  it("reports how many existing records were renamed", async () => {
    post.mockResolvedValue({
      success: true,
      data: { mapping: MAPPINGS[0], retroactiveCount: 12 },
    });
    await renderLoaded();
    const form = addForm();

    await userEvent.type(form.gamertag, "xxakifxx");
    await userEvent.type(form.displayName, "Akif");
    await userEvent.click(form.submit);

    // Historical data just changed; saying only "Mapping added" hides that entirely.
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Mapping added — 12 game records renamed"),
    );
  });

  it("uses the singular for one renamed record", async () => {
    post.mockResolvedValue({ success: true, data: { mapping: MAPPINGS[0], retroactiveCount: 1 } });
    await renderLoaded();
    const form = addForm();

    await userEvent.type(form.gamertag, "x");
    await userEvent.type(form.displayName, "y");
    await userEvent.click(form.submit);

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Mapping added — 1 game record renamed"),
    );
  });

  it("says nothing about renaming when nothing was renamed", async () => {
    await renderLoaded();
    const form = addForm();

    await userEvent.type(form.gamertag, "x");
    await userEvent.type(form.displayName, "y");
    await userEvent.click(form.submit);

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Mapping added"));
  });

  it("clears the form after a successful add", async () => {
    await renderLoaded();
    const form = addForm();

    await userEvent.type(form.gamertag, "xxakifxx");
    await userEvent.type(form.displayName, "Akif");
    await userEvent.click(form.submit);

    // Leaving the values in place invites an accidental duplicate submit.
    await waitFor(() => expect(addForm().gamertag).toHaveValue(""));
    expect(addForm().displayName).toHaveValue("");
  });

  it("surfaces a rejected duplicate", async () => {
    post.mockRejectedValue(new Error("A mapping for that gamertag already exists"));
    await renderLoaded();
    const form = addForm();

    await userEvent.type(form.gamertag, "GRIM_AR15");
    await userEvent.type(form.displayName, "Akif");
    await userEvent.click(form.submit);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("A mapping for that gamertag already exists"),
    );
  });

  it("shows progress while adding", async () => {
    post.mockReturnValue(new Promise(() => {}));
    await renderLoaded();
    const form = addForm();

    await userEvent.type(form.gamertag, "x");
    await userEvent.type(form.displayName, "y");
    await userEvent.click(form.submit);

    expect(await screen.findByRole("button", { name: "Adding…" })).toBeDisabled();
  });
});

describe("editing a mapping", () => {
  async function startEditing() {
    await renderLoaded();
    await userEvent.click(within(rowFor("Akif")).getByRole("button", { name: "Edit" }));
    return screen.getByPlaceholderText("Gamertag").closest("tr") as HTMLElement;
  }

  it("pre-fills the current values", async () => {
    const row = await startEditing();

    expect(within(row).getByPlaceholderText("Gamertag")).toHaveValue("GRIM_AR15");
    expect(within(row).getByPlaceholderText("Display name")).toHaveValue("Akif");
  });

  it("saves the edited values", async () => {
    const row = await startEditing();

    const gamertag = within(row).getByPlaceholderText("Gamertag");
    await userEvent.clear(gamertag);
    await userEvent.type(gamertag, "GRIM_AR16");
    await userEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(put).toHaveBeenCalledWith("/api/mappings/m1", {
        gamertag: "GRIM_AR16",
        displayName: "Akif",
      }),
    );
  });

  it("reports retroactive renames on save too", async () => {
    put.mockResolvedValue({ success: true, data: { mapping: MAPPINGS[0], retroactiveCount: 3 } });
    const row = await startEditing();

    await userEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Mapping saved — 3 game records renamed"),
    );
  });

  it("leaves edit mode after saving", async () => {
    const row = await startEditing();

    await userEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByPlaceholderText("Gamertag")).not.toBeInTheDocument());
  });

  it("validates before sending anything", async () => {
    const row = await startEditing();

    await userEvent.clear(within(row).getByPlaceholderText("Display name"));
    await userEvent.click(within(row).getByRole("button", { name: "Save" }));

    // The inline editor runs the same schema by hand, since it is not a react-hook-form.
    expect(await within(row).findByText("Required")).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
  });

  it("stays in edit mode when validation fails", async () => {
    const row = await startEditing();

    await userEvent.clear(within(row).getByPlaceholderText("Gamertag"));
    await userEvent.click(within(row).getByRole("button", { name: "Save" }));

    expect(screen.getByPlaceholderText("Gamertag")).toBeInTheDocument();
  });

  it("discards changes on cancel", async () => {
    const row = await startEditing();

    await userEvent.type(within(row).getByPlaceholderText("Display name"), "-edited");
    await userEvent.click(within(row).getByRole("button", { name: "Cancel" }));

    expect(put).not.toHaveBeenCalled();
    expect(screen.getByText("Akif")).toBeInTheDocument();
  });

  it("surfaces a rejected save", async () => {
    put.mockRejectedValue(new Error("Mapping not found"));
    const row = await startEditing();

    await userEvent.click(within(row).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Mapping not found"));
  });

  it("edits only one row at a time", async () => {
    await renderLoaded();

    await userEvent.click(within(rowFor("Akif")).getByRole("button", { name: "Edit" }));
    await userEvent.click(within(rowFor("Nillan")).getByRole("button", { name: "Edit" }));

    // Two open editors would let one row's Save write the other's values.
    expect(screen.getAllByPlaceholderText("Gamertag")).toHaveLength(1);
  });
});

describe("deleting a mapping", () => {
  async function askToDelete() {
    await renderLoaded();
    const row = rowFor("Akif");
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
    return row;
  }

  it("asks inline before deleting", async () => {
    const row = await askToDelete();

    expect(within(row).getByText("Delete?")).toBeInTheDocument();
    expect(del).not.toHaveBeenCalled();
  });

  it("deletes on confirmation", async () => {
    const row = await askToDelete();

    await userEvent.click(within(row).getByRole("button", { name: "Yes" }));

    expect(del).toHaveBeenCalledWith("/api/mappings/m1");
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Mapping deleted"));
  });

  it("backs out on No", async () => {
    const row = await askToDelete();

    await userEvent.click(within(row).getByRole("button", { name: "No" }));

    expect(del).not.toHaveBeenCalled();
    expect(within(row).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("surfaces a rejected delete", async () => {
    del.mockRejectedValue(new Error("Mapping not found"));
    const row = await askToDelete();

    await userEvent.click(within(row).getByRole("button", { name: "Yes" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Mapping not found"));
  });

  it("confirms for one row at a time", async () => {
    await renderLoaded();

    await userEvent.click(within(rowFor("Akif")).getByRole("button", { name: "Delete" }));
    await userEvent.click(within(rowFor("Nillan")).getByRole("button", { name: "Delete" }));

    expect(screen.getAllByText("Delete?")).toHaveLength(1);
  });
});

describe("the two row modes are mutually exclusive", () => {
  it("closes the delete prompt when editing starts", async () => {
    await renderLoaded();
    const row = rowFor("Akif");
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));

    await userEvent.click(within(rowFor("Nillan")).getByRole("button", { name: "Edit" }));

    // Otherwise a stray "Yes" click deletes a row the user is no longer looking at.
    expect(screen.queryByText("Delete?")).not.toBeInTheDocument();
  });

  it("closes the editor when a delete prompt opens", async () => {
    await renderLoaded();
    await userEvent.click(within(rowFor("Akif")).getByRole("button", { name: "Edit" }));

    await userEvent.click(within(rowFor("Nillan")).getByRole("button", { name: "Delete" }));

    expect(screen.queryByPlaceholderText("Gamertag")).not.toBeInTheDocument();
  });
});
