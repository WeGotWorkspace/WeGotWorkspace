import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginScreen } from "@/login-core/src/login-screen";
import { loginLabels as labels } from "@/login-core/src/login-labels";
import { createMockSignInOperations, MOCK_SIGN_IN } from "@/lib/api/mock/sign-in";
import { SignInError, type SignInOperations } from "@/lib/api/wgw/auth-sign-in";
import { twoFactorLabels } from "@/two-factor-ui/src/two-factor-labels";
import { TooltipProvider } from "@/ui/tooltip";
import type { ReactElement } from "react";

const mockNavigate = vi.fn();

/** The app shell provides tooltips (copy buttons in the second step). */
function render(ui: ReactElement) {
  return rtlRender(<TooltipProvider>{ui}</TooltipProvider>);
}

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/login" } }),
  Link: ({ to, children }: { to: string; children: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/lib/api/wgw/http", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/wgw/http")>()),
  wgwFetchPasswordRecoveryEnabled: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ showSuccess: vi.fn(), showError: vi.fn() }),
}));

function okOperations(redirect: string | null = null): SignInOperations {
  return {
    signIn: vi.fn().mockResolvedValue({ status: "ok", redirect }),
    verify: vi.fn(),
    confirmReplacement: vi.fn(),
  };
}

function failing(error: unknown): SignInOperations {
  return { ...okOperations(), signIn: vi.fn().mockRejectedValue(error) };
}

function submitCredentials(username = "demo", password = "secret") {
  fireEvent.change(screen.getByPlaceholderText("yourname"), { target: { value: username } });
  fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

async function submitCode(value: string) {
  fireEvent.change(await screen.findByLabelText(twoFactorLabels.codeLabel), {
    target: { value },
  });
  fireEvent.click(screen.getByRole("button", { name: labels.verify }));
}

function signInAsTwoFactorUser() {
  submitCredentials(MOCK_SIGN_IN.twoFactorUser, MOCK_SIGN_IN.password);
}

/** Sends wrong codes one at a time, each answered before the next. */
async function sendWrongCodes(operations: SignInOperations, count: number) {
  const verify = vi.spyOn(operations, "verify");
  for (let i = 0; i < count; i++) {
    await submitCode("654321");
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(i + 1));
    await verify.mock.results[i]?.value.catch(() => undefined);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: labels.verify }).hasAttribute("disabled")).toBe(
        false,
      ),
    );
  }
  verify.mockRestore();
}

describe("LoginScreen", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    window.history.replaceState({}, "", "/login");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("redirects to ?return destination after successful sign-in", async () => {
    window.history.replaceState({}, "", "/login?return=%2Fdocs");
    render(<LoginScreen operations={okOperations()} />);
    submitCredentials();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ href: "/docs" }));
  });

  it("keeps the query of the return path in the href (#1522)", async () => {
    render(<LoginScreen returnPath="/drive?view=uploads" operations={okOperations()} />);
    submitCredentials();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ href: "/drive?view=uploads" }));
  });

  it("prefers explicit returnPath prop over query string", async () => {
    window.history.replaceState({}, "", "/login?return=%2Fmail");
    render(<LoginScreen returnPath="/notes" operations={okOperations()} />);
    submitCredentials();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ href: "/notes" }));
  });

  it("shows Forgot password when recovery is enabled", () => {
    render(<LoginScreen passwordRecoveryEnabled operations={okOperations()} />);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toBeTruthy();
  });

  it("hides Forgot password when recovery is off", () => {
    render(<LoginScreen passwordRecoveryEnabled={false} operations={okOperations()} />);
    expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
  });

  it("falls back to home when no return is provided", async () => {
    render(<LoginScreen operations={okOperations()} />);
    submitCredentials();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ href: "/" }));
  });

  it("shows Connect Assistant title for oauth authorize return", () => {
    render(
      <LoginScreen
        returnPath="/oauth/authorize"
        passwordRecoveryEnabled={false}
        operations={okOperations()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Connect Assistant" })).toBeTruthy();
    expect(screen.queryByText("Welcome back.")).toBeNull();
  });

  it("shows a validation error and does not submit when fields are blank", async () => {
    const operations = okOperations();
    render(<LoginScreen operations={operations} />);
    submitCredentials("   ", "secret");
    expect((await screen.findByRole("alert")).textContent).toBe(labels.required);
    expect(operations.signIn).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows the invalid-credentials message on a 401", async () => {
    render(
      <LoginScreen
        operations={failing(new SignInError("x", 401, "unauthorized", "credentials", null))}
      />,
    );
    submitCredentials();
    expect((await screen.findByRole("alert")).textContent).toBe(labels.invalid);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("says when to try again when sign-in is throttled", async () => {
    render(
      <LoginScreen
        operations={failing(new SignInError("x", 429, "throttled", "throttled", 600))}
      />,
    );
    submitCredentials();
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /^Too many sign-in attempts\. Try again at /,
    );
  });

  it("shows the invalid-credentials message from the error query", () => {
    window.history.replaceState({}, "", "/login?error=invalid");
    render(<LoginScreen operations={okOperations()} />);
    expect(screen.getByRole("alert").textContent).toBe(labels.invalid);
  });

  it("shows the rate-limit message from the error query", () => {
    window.history.replaceState({}, "", "/login?error=throttled");
    render(<LoginScreen operations={okOperations()} />);
    expect(screen.getByRole("alert").textContent).toBe(labels.throttled(null));
  });

  it("assigns the return path after assistant connect", async () => {
    const returnPath = "/oauth/authorize?client_id=abc";
    window.history.replaceState({}, "", `/login?return=${encodeURIComponent(returnPath)}`);
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<LoginScreen operations={okOperations()} />);
    submitCredentials();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(returnPath));
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("assigns the full authorize URL the server returns for a bare return path", async () => {
    const serverTarget = "/oauth/authorize?client_id=abc&prompt=consent&state=s1";
    window.history.replaceState({}, "", "/login?return=%2Foauth%2Fauthorize");
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<LoginScreen operations={okOperations(serverTarget)} />);
    submitCredentials();
    await waitFor(() => expect(assign).toHaveBeenCalledWith(serverTarget));
  });

  it("ignores a server target that is not the authorize path", async () => {
    window.history.replaceState({}, "", "/login?return=%2Foauth%2Fauthorize");
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<LoginScreen operations={okOperations("/admin")} />);
    submitCredentials();
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/oauth/authorize"));
  });
});

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("LoginScreen second step", () => {
  beforeEach(() => {
    // The "I saved them" checkbox measures itself.
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
    mockNavigate.mockReset();
    window.history.replaceState({}, "", "/login?return=%2Fcalendar");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("asks for a code after the password, accepts `123 456`, then keeps the return path", async () => {
    render(<LoginScreen operations={createMockSignInOperations()} />);
    signInAsTwoFactorUser();
    expect(await screen.findByRole("heading", { name: labels.codeTitle })).toBeTruthy();
    const field = screen.getByLabelText(twoFactorLabels.codeLabel);
    expect(field.getAttribute("autocomplete")).toBe("one-time-code");
    expect(field.getAttribute("inputmode")).toBe("numeric");
    await waitFor(() => expect(document.activeElement).toBe(field));
    await submitCode("123 456");
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ href: "/calendar" }));
  });

  it("shows a wrong code with the phone-clock hint and stays on the code step", async () => {
    render(<LoginScreen operations={createMockSignInOperations()} />);
    signInAsTwoFactorUser();
    await submitCode("654321");
    expect((await screen.findByRole("alert")).textContent).toBe(labels.wrongCode);
    expect(screen.getByText(twoFactorLabels.clockHint)).toBeTruthy();
    expect(screen.getByLabelText(twoFactorLabels.codeLabel).getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("does not send an incomplete code", async () => {
    const operations = createMockSignInOperations();
    const verify = vi.spyOn(operations, "verify");
    render(<LoginScreen operations={operations} />);
    signInAsTwoFactorUser();
    await submitCode("1234");
    expect((await screen.findByRole("alert")).textContent).toBe(labels.codeRequired);
    expect(verify).not.toHaveBeenCalled();
  });

  it("says when to try again when code entry is throttled", async () => {
    render(<LoginScreen operations={createMockSignInOperations()} />);
    signInAsTwoFactorUser();
    await submitCode(MOCK_SIGN_IN.throttledCode);
    expect((await screen.findByRole("alert")).textContent).toMatch(
      /^Too many sign-in attempts\. Try again at /,
    );
  });

  it("goes back to the password when the challenge expired", async () => {
    render(<LoginScreen operations={createMockSignInOperations()} />);
    signInAsTwoFactorUser();
    await submitCode(MOCK_SIGN_IN.expiredCode);
    expect((await screen.findByRole("alert")).textContent).toBe(labels.expired);
    expect(screen.getByRole("heading", { name: labels.welcome })).toBeTruthy();
    expect(screen.getByPlaceholderText("yourname")).toBeTruthy();
  });

  it("says too many wrong codes when the challenge ends after the limit", async () => {
    const operations = createMockSignInOperations();
    render(<LoginScreen operations={operations} />);
    signInAsTwoFactorUser();
    await sendWrongCodes(operations, MOCK_SIGN_IN.wrongCodeLimit);
    expect(screen.getByRole("alert").textContent).toBe(labels.wrongCode);
    await submitCode("654321");
    expect((await screen.findByRole("alert")).textContent).toBe(labels.tooManyWrongCodes);
    expect(screen.getByPlaceholderText("yourname")).toBeTruthy();
  });

  it("does not blame wrong codes from an earlier challenge", async () => {
    const operations = createMockSignInOperations();
    render(<LoginScreen operations={operations} />);
    signInAsTwoFactorUser();
    await sendWrongCodes(operations, MOCK_SIGN_IN.wrongCodeLimit);
    fireEvent.click(screen.getByRole("button", { name: labels.startOver }));
    signInAsTwoFactorUser();
    await submitCode(MOCK_SIGN_IN.expiredCode);
    expect((await screen.findByRole("alert")).textContent).toBe(labels.expired);
  });

  it("starts over from the code step", async () => {
    render(<LoginScreen operations={createMockSignInOperations()} />);
    signInAsTwoFactorUser();
    fireEvent.click(await screen.findByRole("button", { name: labels.startOver }));
    expect(screen.getByPlaceholderText("yourname")).toBeTruthy();
  });

  it("walks through a recovery code, a new authenticator and the new recovery codes", async () => {
    render(<LoginScreen operations={createMockSignInOperations()} />);
    signInAsTwoFactorUser();
    fireEvent.click(await screen.findByRole("button", { name: labels.useRecovery }));
    const recovery = await screen.findByLabelText(twoFactorLabels.recoveryCodeLabel);
    expect(recovery.getAttribute("autocomplete")).toBe("off");
    fireEvent.change(recovery, { target: { value: " 3F9A c27e-81D4 0b6e " } });
    fireEvent.click(screen.getByRole("button", { name: labels.verify }));

    expect(await screen.findByRole("heading", { name: labels.replaceTitle })).toBeTruthy();
    expect(await screen.findByRole("img", { name: twoFactorLabels.qrLabel })).toBeTruthy();
    expect((screen.getByLabelText(twoFactorLabels.secretLabel) as HTMLInputElement).value).toBe(
      "JBSW Y3DP EHPK 3PXP",
    );
    await submitCode(MOCK_SIGN_IN.code);

    expect(await screen.findByRole("heading", { name: labels.codesTitle })).toBeTruthy();
    expect(screen.getByText(MOCK_SIGN_IN.recoveryCodes[0])).toBeTruthy();
    const next = screen.getByRole("button", { name: labels.continue });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(next);
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith({ href: "/calendar" }));
  });

  it("returns to consent after the code on assistant connect", async () => {
    const serverTarget = "/oauth/authorize?client_id=abc&state=s1";
    window.history.replaceState({}, "", "/login?return=%2Foauth%2Fauthorize");
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    render(<LoginScreen operations={createMockSignInOperations({ redirect: serverTarget })} />);
    expect(screen.getByRole("heading", { name: labels.connect })).toBeTruthy();
    signInAsTwoFactorUser();
    await submitCode(MOCK_SIGN_IN.code);
    await waitFor(() => expect(assign).toHaveBeenCalledWith(serverTarget));
  });
});
