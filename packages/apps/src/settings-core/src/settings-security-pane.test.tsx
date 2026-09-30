// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MfaRequestError } from "@/lib/api/wgw/mfa-client";
import { SettingsSecurityPane } from "@/settings-core/src/settings-security-pane";
import { TooltipProvider } from "@/ui/tooltip";

const toast = vi.hoisted(() => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => toast,
}));

const off = {
  enabled: false,
  required: false,
  recoveryCodesRemaining: 0,
  suggest: false,
};

function renderPane(preview: Parameters<typeof SettingsSecurityPane>[0]["preview"]) {
  return render(
    <TooltipProvider delayDuration={0}>
      <div className="settings-workspace">
        <SettingsSecurityPane preview={preview} />
      </div>
    </TooltipProvider>,
  );
}

describe("SettingsSecurityPane", () => {
  afterEach(() => cleanup());

  it("starts setup from the two-factor switch and can open turn off", async () => {
    renderPane({ account: off, appPasswords: [] });
    const toggle = screen.getByRole("switch", { name: "Two-factor authentication" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.queryByLabelText("Code from the app")).toBeNull();

    cleanup();
    renderPane({
      account: { ...off, enabled: true, required: true, recoveryCodesRemaining: 10 },
      appPasswords: [],
    });
    const enabledToggle = screen.getByRole("switch", { name: "Two-factor authentication" });
    expect(enabledToggle.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(enabledToggle);
    expect(
      (await screen.findByRole("dialog", { name: "Turn off two-factor authentication" }))
        .textContent,
    ).toContain("Enter the code from your authenticator app.");
    expect(enabledToggle.getAttribute("aria-checked")).toBe("true");
  });

  it("copies recovery codes from the setup step", async () => {
    renderPane({ account: off, appPasswords: [] });
    fireEvent.click(screen.getByRole("switch", { name: "Two-factor authentication" }));
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    fireEvent.change(await screen.findByLabelText("Code from the app"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    const copy = await screen.findByRole("button", { name: "Copy recovery codes" });
    expect(screen.queryByRole("button", { name: "Copy" })).toBeNull();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    toast.showSuccess.mockClear();
    fireEvent.click(copy);
    await waitFor(() => {
      expect(toast.showSuccess).toHaveBeenCalledWith("Recovery codes copied");
    });
  });

  it("asks for one authenticator code inside the create dialog", async () => {
    renderPane({
      account: { ...off, enabled: true, recoveryCodesRemaining: 10 },
      appPasswords: [],
      onCreateAppPassword: async () => {
        throw new MfaRequestError("Wait for the next code.", 401, "totp_step_reused");
      },
    });
    expect(screen.queryByLabelText("Authenticator code")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create app password" }));
    const dialog = await screen.findByRole("dialog", { name: "Create app password" });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Phone" } });
    fireEvent.change(screen.getByLabelText("Authenticator code"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Wait for the next code.");
    expect(dialog).toBeTruthy();
  });
});
