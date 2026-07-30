/**
 * The sign-in / sign-up page.
 *
 * The only route a logged-out visitor is supposed to reach, and the one place the invite
 * code is entered. Two behaviours carry weight: an already-signed-in visitor must be pushed
 * off this page (otherwise the back button lands them on a login form while authenticated),
 * and a failed attempt must surface the server's message rather than a generic one — "Invalid
 * invite code" and "Invalid credentials" send the user to completely different next actions.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

const { navigate, login, signup, toastError } = vi.hoisted(() => ({
  navigate: vi.fn(),
  login: vi.fn(),
  signup: vi.fn(),
  toastError: vi.fn(),
}));

let authState: { user: unknown; loading: boolean } = { user: null, loading: false };

// createFileRoute is replaced with a pass-through so `Route` is just the options object —
// that is what makes the page component reachable without standing up a real router.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => opts,
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
  useNavigate: () => navigate,
}));

vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

vi.mock("@/contexts/auth-context", () => ({
  useAuth: () => ({ ...authState, login, signup }),
}));

import { Route } from "@/routes/login";

const LoginPage = (Route as unknown as { component: () => ReactNode }).component;

const USER = { id: "u1", email: "akif@test.local", role: "USER" };

function renderPage() {
  return render(<LoginPage />);
}

/** Fills the always-present fields so jsdom's constraint validation lets the form submit. */
async function fillCredentials(email = "akif@test.local", password = "hunter2000") {
  await userEvent.type(screen.getByLabelText("Email"), email);
  await userEvent.type(screen.getByLabelText("Password"), password);
}

async function switchToSignup() {
  await userEvent.click(screen.getByRole("button", { name: "Create an account" }));
}

beforeEach(() => {
  navigate.mockReset();
  login.mockReset().mockResolvedValue(undefined);
  signup.mockReset().mockResolvedValue(undefined);
  toastError.mockReset();
  authState = { user: null, loading: false };
});

describe("the route definition", () => {
  it("sets a page title and description", () => {
    const head = (Route as unknown as { head: () => { meta: { title?: string }[] } }).head();

    // This is the one page search engines and link previews ever see.
    expect(head.meta[0]).toEqual({ title: "Sign in — ScoreCheck" });
    expect(head.meta[1]).toMatchObject({ name: "description" });
  });
});

describe("an already-signed-in visitor", () => {
  it("is sent to the overview", async () => {
    authState = { user: USER, loading: false };

    renderPage();

    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/" }));
  });

  it("is not redirected while auth is still resolving", () => {
    authState = { user: null, loading: true };

    renderPage();

    expect(navigate).not.toHaveBeenCalled();
  });

  it("stays put when there is no user", () => {
    renderPage();

    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("login mode", () => {
  it("is the default", () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 2, name: "Sign in" })).toBeInTheDocument();
  });

  it("asks only for email and password", () => {
    renderPage();

    expect(screen.queryByLabelText(/Name/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Invite code")).not.toBeInTheDocument();
  });

  it("hints the browser to offer a saved password", () => {
    renderPage();

    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "current-password");
  });

  it("signs in and continues to the overview", async () => {
    renderPage();

    await fillCredentials();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(login).toHaveBeenCalledWith("akif@test.local", "hunter2000");
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/" }));
  });

  it("does not enforce a minimum length, so an old short password still works", () => {
    renderPage();

    // Signup requires 8 characters; applying that here would lock out anyone whose account
    // predates the rule.
    expect(screen.getByLabelText("Password")).toHaveAttribute("minlength", "1");
  });

  it("surfaces the server's rejection", async () => {
    login.mockRejectedValue(new Error("Invalid credentials"));
    renderPage();

    await fillCredentials();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Invalid credentials"));
    expect(navigate).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for a non-Error rejection", async () => {
    login.mockRejectedValue("just a string");
    renderPage();

    await fillCredentials();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Something went wrong"));
  });

  it("re-enables the form after a failure", async () => {
    login.mockRejectedValue(new Error("Invalid credentials"));
    renderPage();

    await fillCredentials();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    // Leaving it disabled would strand the user on a page whose only purpose is retrying.
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled());
  });
});

describe("signup mode", () => {
  it("asks for a name and an invite code", async () => {
    renderPage();

    await switchToSignup();

    expect(screen.getByLabelText(/Name/)).toBeInTheDocument();
    expect(screen.getByLabelText("Invite code")).toBeInTheDocument();
  });

  it("explains that the code comes from the league admin", async () => {
    renderPage();

    await switchToSignup();

    expect(screen.getByText(/invite code from your league admin/i)).toBeInTheDocument();
  });

  it("hints the browser to generate a new password", async () => {
    renderPage();

    await switchToSignup();

    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  });

  it("creates the account and continues to the overview", async () => {
    renderPage();
    await switchToSignup();

    await userEvent.type(screen.getByLabelText(/Name/), "Akif");
    await fillCredentials();
    await userEvent.type(screen.getByLabelText("Invite code"), "squad-invite-token");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(signup).toHaveBeenCalledWith({
      email: "akif@test.local",
      password: "hunter2000",
      name: "Akif",
      inviteCode: "squad-invite-token",
    });
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ to: "/" }));
  });

  it("omits an all-whitespace name rather than storing it", async () => {
    renderPage();
    await switchToSignup();

    await userEvent.type(screen.getByLabelText(/Name/), "   ");
    await fillCredentials();
    await userEvent.type(screen.getByLabelText("Invite code"), "token");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    // The sidebar falls back to the email when there is no name; a blank string would
    // render an empty avatar instead.
    expect(signup).toHaveBeenCalledWith(expect.objectContaining({ name: undefined }));
  });

  it("rejects a password under 8 characters before calling the server", async () => {
    renderPage();
    await switchToSignup();

    await fillCredentials("akif@test.local", "short");
    await userEvent.type(screen.getByLabelText("Invite code"), "token");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(toastError).toHaveBeenCalledWith("Password must be at least 8 characters");
    expect(signup).not.toHaveBeenCalled();
  });

  it("surfaces a rejected invite code", async () => {
    signup.mockRejectedValue(new Error("Invalid invite code"));
    renderPage();
    await switchToSignup();

    await fillCredentials();
    await userEvent.type(screen.getByLabelText("Invite code"), "wrong");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    // "Invalid invite code" and "Email already registered" need different next actions, so
    // the server's wording has to reach the user.
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Invalid invite code"));
  });
});

describe("switching modes", () => {
  it("goes to signup and back", async () => {
    renderPage();

    await switchToSignup();
    expect(screen.getByRole("heading", { level: 2, name: "Create account" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("heading", { level: 2, name: "Sign in" })).toBeInTheDocument();
  });

  it("keeps what was already typed", async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText("Email"), "akif@test.local");

    await switchToSignup();

    // Re-typing an email because you clicked the wrong link first is pure friction.
    expect(screen.getByLabelText("Email")).toHaveValue("akif@test.local");
  });
});

describe("submission state", () => {
  it("shows progress and blocks a second submit", async () => {
    let release!: () => void;
    login.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    renderPage();

    await fillCredentials();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));

    const busy = await screen.findByRole("button", { name: "Signing in…" });
    expect(busy).toBeDisabled();
    await userEvent.click(busy);
    // A double-submitted login is two sessions issued for one intent.
    expect(login).toHaveBeenCalledTimes(1);

    release();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });

  it("labels progress differently when creating an account", async () => {
    let release!: () => void;
    signup.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    renderPage();
    await switchToSignup();

    await fillCredentials();
    await userEvent.type(screen.getByLabelText("Invite code"), "token");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("button", { name: "Creating account…" })).toBeDisabled();

    release();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });

  it("ignores a programmatic re-submit while one is in flight", async () => {
    let release!: () => void;
    login.mockReturnValue(new Promise<void>((resolve) => (release = resolve)));
    renderPage();
    await fillCredentials();
    const form = screen.getByLabelText("Email").closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    await screen.findByRole("button", { name: "Signing in…" });

    // Clicking again is already blocked by the disabled button, so the guard only bites on
    // a submit that bypasses it — Enter on some browsers, or anything scripted.
    fireEvent.submit(form);

    expect(login).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(navigate).toHaveBeenCalled());
  });

  it("disables submit while auth is still resolving", () => {
    authState = { user: null, loading: true };

    renderPage();

    // Submitting mid-verify would race the token check that is already in flight.
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });
});
