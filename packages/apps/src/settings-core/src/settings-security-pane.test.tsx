// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MfaRequestError } from "@/lib/api/wgw/mfa-client";
import { SettingsSecurityPane } from "@/settings-core/src/settings-security-pane";
import { TooltipProvider } from "@/ui/tooltip";

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

  it("keeps the password step hidden until Turn on", () => {
    renderPane({ account: off, appPasswords: [] });
    expect(screen.getByRole("button", { name: "Turn on" })).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    expect(screen.queryByLabelText("Authenticator code")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.queryByLabelText("Code from the app")).toBeNull();
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
