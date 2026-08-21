import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordScreen } from "@/login-core/src/forgot-password-screen";

const requestReset = vi.fn().mockResolvedValue(undefined);

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/login/forgot" } }),
  Link: ({ to, children }: { to: string; children: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwRequestPasswordReset: (...args: unknown[]) => requestReset(...args),
}));

describe("ForgotPasswordScreen", () => {
  beforeEach(() => {
    requestReset.mockReset();
    requestReset.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a generic success message after submit", async () => {
    render(<ForgotPasswordScreen />);

    fireEvent.change(screen.getByLabelText("Username or email"), {
      target: { value: "alice@example.test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() => {
      expect(requestReset).toHaveBeenCalledWith("alice@example.test");
    });
    expect(
      screen.getByText(
        /if an account matches that username or email, a reset message was submitted/i,
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/reached an inbox/i)).toBeTruthy();
  });
});
