import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResetPasswordScreen } from "@/login-core/src/reset-password-screen";

const resetPassword = vi.fn().mockResolvedValue(undefined);

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown;
  }) => select({ location: { pathname: "/login/reset" } }),
  Link: ({ to, children }: { to: string; children: string }) => <a href={to}>{children}</a>,
}));

vi.mock("@/lib/api/wgw/http", () => ({
  wgwResetPasswordWithToken: (...args: unknown[]) => resetPassword(...args),
}));

describe("ResetPasswordScreen", () => {
  beforeEach(() => {
    resetPassword.mockReset();
    resetPassword.mockResolvedValue(undefined);
    window.history.replaceState({}, "", "/login/reset");
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the reset form when a token is present", () => {
    render(<ResetPasswordScreen token="abc123" />);

    expect(screen.getByLabelText("New password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Update password" })).toBeTruthy();
  });

  it("shows an invalid-token message when the token is missing", () => {
    render(<ResetPasswordScreen token="" />);

    expect(screen.getByRole("alert").textContent).toMatch(/invalid or has expired/i);
    expect(screen.getByRole("button", { name: "Update password" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("submits a new password for a valid token", async () => {
    render(<ResetPasswordScreen token="deadbeef" />);

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "newpassword12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      expect(resetPassword).toHaveBeenCalledWith("deadbeef", "newpassword12");
    });
    expect(screen.getByText(/your password was updated/i)).toBeTruthy();
  });

  it("surfaces an invalid token error from the API", async () => {
    resetPassword.mockRejectedValue(new Error("This reset link is invalid or has expired."));
    render(<ResetPasswordScreen token="expired" />);

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "newpassword12" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toMatch(/invalid or has expired/i);
    });
  });
});
