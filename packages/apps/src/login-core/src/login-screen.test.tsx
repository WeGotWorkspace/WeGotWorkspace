import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthLoginChallenge } from "@/lib/api/wgw/auth-login";
import { LoginScreen } from "@/login-core/src/login-screen";
import { wgwEstablishMcpWebSession, wgwLoginWithCredentials } from "@/lib/api/wgw/http";

const mockNavigate = vi.fn();
const harness = vi.hoisted(() => ({
  challengeWizardSource: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/login" } }),
  Link: ({ to, children }: { to: string; children: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/lib/api/wgw/mfa-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/wgw/mfa-client")>(
    "@/lib/api/wgw/mfa-client",
  );
  return { ...actual, challengeWizardSource: harness.challengeWizardSource };
});

vi.mock("@/lib/api/wgw/http", () => ({
  wgwLoginWithCredentials: vi.fn().mockResolvedValue(undefined),
  wgwEstablishMcpWebSession: vi.fn().mockResolvedValue("/oauth/authorize"),
  wgwFetchPasswordRecoveryEnabled: vi.fn().mockResolvedValue(false),
  wgwLogout: vi.fn().mockResolvedValue(undefined),
  wgwLiveApiEnabled: () => false,
  wgwApiBaseUrl: () => "/api/v1",
  wgwOAuthSessionUrl: () => "/oauth/session",
  wgwApplyTokenResponse: vi.fn(),
  wgwFetch: vi.fn(),
  wgwReadJson: vi.fn(),
}));

describe("LoginScreen return path", () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    harness.challengeWizardSource.mockReset();
    vi.mocked(wgwEstablishMcpWebSession).mockClear();
    vi.mocked(wgwLoginWithCredentials).mockClear();
    window.history.replaceState({}, "", "/login");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("redirects to ?return destination after successful sign-in", async () => {
    window.history.replaceState({}, "", "/login?return=%2Fdocs");

    render(<LoginScreen />);

    fireEvent.change(screen.getByPlaceholderText("yourname"), { target: { value: "demo" } });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/docs" });
    });
  });

  it("prefers explicit returnPath prop over query string", async () => {
    window.history.replaceState({}, "", "/login?return=%2Fmail");

    render(<LoginScreen returnPath="/notes" />);

    fireEvent.change(screen.getByPlaceholderText("yourname"), { target: { value: "demo" } });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/notes" });
    });
  });

  it("shows Forgot password when recovery is enabled", () => {
    render(<LoginScreen passwordRecoveryEnabled />);
    expect(screen.getByRole("link", { name: "Forgot password?" })).toBeTruthy();
  });

  it("hides Forgot password when recovery is off", () => {
    render(<LoginScreen passwordRecoveryEnabled={false} />);
    expect(screen.queryByRole("link", { name: "Forgot password?" })).toBeNull();
  });

  it("does not render a copyright year footer", () => {
    render(<LoginScreen />);
    expect(screen.queryByText(/© .*WeGotWorkspace/)).toBeNull();
  });

  it("falls back to home when no return is provided", async () => {
    render(<LoginScreen />);

    fireEvent.change(screen.getByPlaceholderText("yourname"), { target: { value: "demo" } });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
    });
  });

  it("shows Connect Assistant title for oauth authorize return", () => {
    render(<LoginScreen returnPath="/oauth/authorize" passwordRecoveryEnabled={false} />);
    expect(screen.getByRole("heading", { name: "Connect Assistant" })).toBeTruthy();
    expect(screen.queryByText("Welcome back.")).toBeNull();
  });

  it("establishes a web session and assigns the authorize URL", async () => {
    const returnPath = "/oauth/authorize?client_id=abc";
    window.history.replaceState(
      {},
      "",
      `/login?return=${encodeURIComponent(returnPath)}&intent=intent-token`,
    );
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });

    render(<LoginScreen />);

    fireEvent.change(screen.getByPlaceholderText("yourname"), { target: { value: "demo" } });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(wgwEstablishMcpWebSession).toHaveBeenCalledWith("demo", "secret", "intent-token");
      expect(assign).toHaveBeenCalledWith(returnPath);
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("reuses the sign-in password for required authenticator setup", async () => {
    const start = vi.fn().mockResolvedValue({
      secret: "ABCDEFGHIJKLMNOP",
      otpauthUri: "otpauth://totp/WeGotWorkspace:demo?secret=ABCDEFGHIJKLMNOP",
      davWarning: false,
    });
    harness.challengeWizardSource.mockImplementation(
      (login: { status: string }, username: string, knownPassword?: string) => ({
        mode: "enroll" as const,
        username,
        presentation: "challenge" as const,
        forced: true,
        knownPassword: login.status === "mfa_setup_required" ? knownPassword : undefined,
        start,
        confirm: vi.fn(),
      }),
    );
    vi.mocked(wgwLoginWithCredentials).mockRejectedValueOnce(
      new AuthLoginChallenge({
        status: "mfa_setup_required",
        challenge: "abc",
        client: "spa",
      }),
    );

    render(<LoginScreen />);
    fireEvent.change(screen.getByPlaceholderText("yourname"), { target: { value: "demo" } });
    fireEvent.change(screen.getByPlaceholderText("••••••••"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => {
      expect(harness.challengeWizardSource).toHaveBeenCalledWith(
        expect.objectContaining({ status: "mfa_setup_required", challenge: "abc" }),
        "demo",
        "secret",
      );
      expect(start).toHaveBeenCalledWith("secret");
    });
    expect(screen.queryByText("Enter your account password to start setup.")).toBeNull();
    expect(await screen.findByText("ABCD EFGH IJKL MNOP")).toBeTruthy();
  });
});
