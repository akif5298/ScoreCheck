/**
 * Account settings and the change-password form.
 *
 * The password form validates client-side before calling the server, and both checks matter:
 * the length rule mirrors what signup enforces, and the confirm-match check exists because a
 * typo there would otherwise lock the user out of an account they can still see.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const { navigate, logout, toastError, toastSuccess } = vi.hoisted(() => ({
  navigate: vi.fn(),
  logout: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

let authUser: { name?: string | null; email: string; role: string; createdAt: string } | null;

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  useNavigate: () => navigate,
}));

vi.mock("sonner", () => ({ toast: { error: toastError, success: toastSuccess } }));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Card: ({ title, children }: { title?: string; children: ReactNode }) => (
    <section aria-label={title}>{children}</section>
  ),
  Badge: ({ children }: { children: ReactNode }) => <span data-testid="badge">{children}</span>,
}));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ user: authUser, logout }),
}));

vi.mock("@/lib/api", () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), del: vi.fn() },
  ACTIVE_SQUAD_KEY: "activeSquadId",
}));

import { Route } from "@/routes/settings";
import { api } from "@/lib/api";

const SettingsPage = (Route as unknown as { component: () => ReactNode }).component;
const post = vi.mocked(api.post);

/** Fills all three password fields and submits. */
async function changePassword(current = "old-password", next = "new-password", confirm = next) {
  await userEvent.type(screen.getByLabelText("Current password"), current);
  await userEvent.type(screen.getByLabelText("New password"), next);
  await userEvent.type(screen.getByLabelText("Confirm new password"), confirm);
  await userEvent.click(screen.getByRole("button", { name: "Update password" }));
}

beforeEach(() => {
  navigate.mockReset();
  logout.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
  post.mockReset().mockResolvedValue({ success: true });
  authUser = {
    name: "Akif Rahman",
    email: "akif@test.local",
    role: "USER",
    createdAt: "2026-01-15T00:00:00.000Z",
  };
});

describe("the route definition", () => {
  it("sets a title and description", () => {
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();

    expect(head.meta[0]).toEqual({ title: "Settings — ScoreCheck" });
  });
});

describe("without a user", () => {
  it("renders nothing and leaves the redirect to the shell", () => {
    authUser = null;

    const { container } = render(<SettingsPage />);

    // AppShell already redirects; doing it here too would fire navigate twice.
    expect(container).toBeEmptyDOMElement();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("the account card", () => {
  it("shows the name and email", () => {
    render(<SettingsPage />);

    expect(screen.getByText("Akif Rahman")).toBeInTheDocument();
    expect(screen.getByText("akif@test.local")).toBeInTheDocument();
  });

  it("shows a dash when the account has no name", () => {
    authUser = { ...authUser!, name: null };

    render(<SettingsPage />);

    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("builds initials from the name", () => {
    render(<SettingsPage />);

    expect(screen.getByText("AR")).toBeInTheDocument();
  });

  it("builds initials from the email when there is no name", () => {
    authUser = { ...authUser!, name: null, email: "akif.rahman@test.local" };

    render(<SettingsPage />);

    // Splits on the separators an email actually uses, so "akif.rahman" gives AR.
    expect(screen.getByText("AR")).toBeInTheDocument();
  });

  it("falls back to a question mark when nothing yields a letter", () => {
    authUser = { ...authUser!, name: null, email: "..." };

    render(<SettingsPage />);

    // An avatar rendering as empty looks like a broken image.
    expect(screen.getByText("?")).toBeInTheDocument();
  });

  it.each([
    ["USER", "Member"],
    ["ADMIN", "Admin"],
  ])("labels a %s as %s", (role, label) => {
    authUser = { ...authUser!, role };

    render(<SettingsPage />);

    expect(screen.getByTestId("badge")).toHaveTextContent(label);
  });

  it("shows when the account was created", () => {
    render(<SettingsPage />);

    // Month and year only — the exact day is noise here.
    expect(screen.getByText("Member since")).toBeInTheDocument();
    expect(screen.getByText(/Jan 2026/)).toBeInTheDocument();
  });

  it("names the sign-in method", () => {
    render(<SettingsPage />);

    expect(screen.getByText("Email + password")).toBeInTheDocument();
  });

  it("signs out and returns to login", async () => {
    render(<SettingsPage />);

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(logout).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({ to: "/login" });
  });
});

describe("changing the password", () => {
  it("posts the current and new password", async () => {
    render(<SettingsPage />);

    await changePassword("old-password", "new-password");

    expect(post).toHaveBeenCalledWith("/api/auth/change-password", {
      currentPassword: "old-password",
      newPassword: "new-password",
    });
  });

  it("confirms success", async () => {
    render(<SettingsPage />);

    await changePassword();

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Password updated"));
  });

  it("clears all three fields afterwards", async () => {
    render(<SettingsPage />);

    await changePassword();

    // Leaving a password sitting in a form field is both a re-submit hazard and a shoulder-
    // surfing one on a shared machine.
    await waitFor(() => expect(screen.getByLabelText("Current password")).toHaveValue(""));
    expect(screen.getByLabelText("New password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm new password")).toHaveValue("");
  });

  it("rejects a new password under 8 characters before calling the server", async () => {
    render(<SettingsPage />);

    await changePassword("old-password", "short");

    // Mirrors the signup rule; the server enforces it too, but failing locally is instant.
    expect(toastError).toHaveBeenCalledWith("New password must be at least 8 characters");
    expect(post).not.toHaveBeenCalled();
  });

  it("rejects a mismatched confirmation", async () => {
    render(<SettingsPage />);

    await changePassword("old-password", "new-password", "new-passwrod");

    // A typo here would set a password the user does not know, on an account they are still
    // logged into — recoverable only by an admin.
    expect(toastError).toHaveBeenCalledWith("New passwords don't match");
    expect(post).not.toHaveBeenCalled();
  });

  it("checks the length before the match, so the clearer error wins", async () => {
    render(<SettingsPage />);

    await changePassword("old-password", "short", "different");

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith("New password must be at least 8 characters");
  });

  it("surfaces a wrong current password", async () => {
    post.mockRejectedValue(new Error("Current password is incorrect"));
    render(<SettingsPage />);

    await changePassword();

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Current password is incorrect"));
  });

  it("keeps what was typed after a failure", async () => {
    post.mockRejectedValue(new Error("Current password is incorrect"));
    render(<SettingsPage />);

    await changePassword("wrong-password", "new-password");

    // Only success clears the form — retyping a new password twice to fix one wrong field
    // is pure friction.
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByLabelText("New password")).toHaveValue("new-password");
  });

  it("falls back to a generic message for a non-Error rejection", async () => {
    post.mockRejectedValue("just a string");
    render(<SettingsPage />);

    await changePassword();

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Failed to update password"));
  });

  it("shows progress and blocks a second submit", async () => {
    let release!: () => void;
    post.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    render(<SettingsPage />);

    await changePassword();

    const busy = await screen.findByRole("button", { name: "Updating…" });
    expect(busy).toBeDisabled();

    release();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });

  it("hints the browser correctly on each field", () => {
    render(<SettingsPage />);

    // Wrong hints here make password managers offer to save the old password.
    expect(screen.getByLabelText("Current password")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    expect(screen.getByLabelText("New password")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByLabelText("Confirm new password")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });

  it("bounds the new password to what bcrypt can hash", () => {
    render(<SettingsPage />);

    // bcrypt silently truncates past 72 bytes, so anything longer is a password the user
    // thinks they set and did not.
    expect(screen.getByLabelText("New password")).toHaveAttribute("maxlength", "72");
  });
});
