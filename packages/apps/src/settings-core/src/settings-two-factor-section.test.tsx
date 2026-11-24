import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockAppPasswordOperations,
  MOCK_ACCOUNT_PASSWORD,
} from "@/lib/api/mock/app-passwords";
import { MOCK_SIGN_IN } from "@/lib/api/mock/sign-in";
import { createMockTwoFactorOperations } from "@/lib/api/mock/two-factor-settings";
import { AppPasswordThrottledError } from "@/lib/api/wgw/app-passwords";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { twoFactorStateFromMe, type TwoFactorState } from "@/lib/api/wgw/two-factor-settings";
import { appPasswordLabels } from "@/settings-core/src/settings-app-passwords-labels";
import { SettingsSecurityPane } from "@/settings-core/src/settings-security-pane";
import { twoFactorSettingsLabels as labels } from "@/settings-core/src/settings-two-factor-labels";
import { twoFactorFailure } from "@/settings-core/src/settings-two-factor-model";
import { twoFactorLabels } from "@/two-factor-ui/src/two-factor-labels";
import { TooltipProvider } from "@/ui/tooltip";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ showSuccess: toast.success, showError: toast.error }),
}));

class FakeResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function renderPane(
  initial?: TwoFactorState,
  options: { davPasswordUsedAt?: string | null; unsynced?: number } = {},
) {
  const operations = createMockTwoFactorOperations(initial, {
    davPasswordUsedAt: options.davPasswordUsedAt,
  });
  vi.spyOn(operations, "start");
  vi.spyOn(operations, "confirm");
  vi.spyOn(operations, "disable");
  vi.spyOn(operations, "replaceRecoveryCodes");
  const signOut = vi.fn(async () => {});
  render(
    <TooltipProvider>
      <SettingsSecurityPane
        operations={createMockAppPasswordOperations()}
        twoFactor={{
          operations,
          signOut,
          countUnsyncedChanges: async () => options.unsynced ?? 0,
        }}
      />
    </TooltipProvider>,
  );
  return { operations, signOut };
}

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function click(name: string | RegExp): void {
  fireEvent.click(screen.getByRole("button", { name }));
}

/** Turn on → account password → Next, up to the QR code. */
async function startSetup(): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: labels.turnOn }));
  await screen.findByRole("dialog");
  type(labels.currentPasswordLabel, MOCK_ACCOUNT_PASSWORD);
  click(labels.next);
  await screen.findByRole("img", { name: twoFactorLabels.qrLabel });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("two-factor state", () => {
  it("reads mfa from GET /me", () => {
    expect(twoFactorStateFromMe({ mfa: { enabled: true, recoveryCodesRemaining: 4 } })).toEqual({
      enabled: true,
      recoveryCodesRemaining: 4,
    });
    expect(twoFactorStateFromMe({ username: "a" })).toEqual({
      enabled: false,
      recoveryCodesRemaining: null,
    });
  });

  it("shows off with Turn on, and on with the recovery codes left", async () => {
    renderPane();
    expect(await screen.findByText(labels.statusOff)).toBeTruthy();
    expect(screen.queryByText(labels.codesLabel)).toBeNull();
    cleanup();
    renderPane({ enabled: true, recoveryCodesRemaining: 7 });
    expect(await screen.findByText(labels.statusOn)).toBeTruthy();
    expect(screen.getByText(labels.codesLeft(7, 10))).toBeTruthy();
    expect(screen.getByRole("button", { name: labels.turnOff })).toBeTruthy();
  });
});

describe("turning it on", () => {
  it("asks for the account password, then a code, then shows the recovery codes", async () => {
    const { operations, signOut } = renderPane();
    await startSetup();
    expect(operations.start).toHaveBeenCalledWith(MOCK_ACCOUNT_PASSWORD);
    expect(screen.getByDisplayValue("JBSW Y3DP EHPK 3PXP")).toBeTruthy();
    type(twoFactorLabels.codeLabel, "123 456");
    const codes = await screen.findByRole("alertdialog");
    expect(operations.confirm).toHaveBeenCalledWith(MOCK_ACCOUNT_PASSWORD, "123456");
    expect(within(codes).getByText(MOCK_SIGN_IN.recoveryCodes[0])).toBeTruthy();
    const done = within(codes).getByRole("button", { name: labels.done });
    expect((done as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(codes).getByRole("checkbox", { name: twoFactorLabels.codesSaved }));
    expect((done as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(done);
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("does not let Escape close the recovery codes", async () => {
    renderPane();
    await startSetup();
    type(twoFactorLabels.codeLabel, MOCK_SIGN_IN.code);
    const codes = await screen.findByRole("alertdialog");
    fireEvent.keyDown(codes, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("marks a wrong account password on the field", async () => {
    renderPane();
    fireEvent.click(await screen.findByRole("button", { name: labels.turnOn }));
    await screen.findByRole("dialog");
    type(labels.currentPasswordLabel, "wrong");
    click(labels.next);
    expect(await screen.findByText(labels.wrongPassword)).toBeTruthy();
    expect(screen.getByLabelText(labels.currentPasswordLabel).getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  it("asks for the password before calling the server", async () => {
    const { operations } = renderPane();
    fireEvent.click(await screen.findByRole("button", { name: labels.turnOn }));
    await screen.findByRole("dialog");
    click(labels.next);
    expect(await screen.findByText(labels.currentPasswordRequired)).toBeTruthy();
    expect(operations.start).not.toHaveBeenCalled();
  });

  it("shows the phone-clock hint after a wrong code", async () => {
    renderPane();
    await startSetup();
    type(twoFactorLabels.codeLabel, "000000");
    expect(await screen.findByText(labels.wrongCode)).toBeTruthy();
    expect(screen.getByText(twoFactorLabels.clockHint)).toBeTruthy();
  });

  it("refuses an incomplete code without a request", async () => {
    const { operations } = renderPane();
    await startSetup();
    type(twoFactorLabels.codeLabel, "123");
    click(labels.turnOnConfirm);
    expect(await screen.findByText(labels.codeRequired)).toBeTruthy();
    expect(operations.confirm).not.toHaveBeenCalled();
  });

  it("warns about unsynced changes on this device", async () => {
    renderPane(undefined, { unsynced: 2 });
    fireEvent.click(await screen.findByRole("button", { name: labels.turnOn }));
    expect(await screen.findByText(labels.unsyncedNote(2))).toBeTruthy();
  });

  it("warns when a calendar app used the account password and opens app passwords", async () => {
    renderPane(undefined, { davPasswordUsedAt: "2026-11-18T21:40:00Z" });
    await startSetup();
    expect(screen.getByText(labels.davWarningTitle)).toBeTruthy();
    click(labels.davWarningAction);
    expect(
      await screen.findByRole("heading", { name: appPasswordLabels.createTitle }),
    ).toBeTruthy();
  });
});

describe("when it is on", () => {
  it("turns off with a code", async () => {
    const { operations } = renderPane({ enabled: true, recoveryCodesRemaining: 9 });
    fireEvent.click(await screen.findByRole("button", { name: labels.turnOff }));
    await screen.findByRole("dialog");
    type(twoFactorLabels.codeLabel, MOCK_SIGN_IN.code);
    expect(await screen.findByText(labels.statusOff)).toBeTruthy();
    expect(operations.disable).toHaveBeenCalledWith(MOCK_SIGN_IN.code);
    expect(toast.success).toHaveBeenCalledWith(labels.turnedOff);
  });

  it("replaces the recovery codes with a code and stays signed in", async () => {
    const { signOut } = renderPane({ enabled: true, recoveryCodesRemaining: 2 });
    fireEvent.click(await screen.findByRole("button", { name: labels.replaceCodes }));
    await screen.findByRole("dialog");
    type(twoFactorLabels.codeLabel, MOCK_SIGN_IN.code);
    const codes = await screen.findByRole("alertdialog");
    fireEvent.click(within(codes).getByRole("checkbox", { name: twoFactorLabels.codesSaved }));
    fireEvent.click(within(codes).getByRole("button", { name: labels.done }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(screen.getByText(labels.codesLeft(10, 10))).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("says when code entry may run again", async () => {
    renderPane({ enabled: true, recoveryCodesRemaining: 9 });
    fireEvent.click(await screen.findByRole("button", { name: labels.turnOff }));
    await screen.findByRole("dialog");
    type(twoFactorLabels.codeLabel, MOCK_SIGN_IN.throttledCode);
    expect(await screen.findByText(/^Too many tries\. Try again at /)).toBeTruthy();
  });
});

describe("twoFactorFailure", () => {
  const now = Date.UTC(2026, 10, 19, 12, 0);

  it("reads status and code, never the message", () => {
    expect(
      twoFactorFailure(new WgwRequestError("x", 403, "current_password_invalid"), "password", now),
    ).toMatchObject({ field: "password", message: labels.wrongPassword });
    // Settings answers a wrong code with 403 too; the code decides.
    expect(
      twoFactorFailure(new WgwRequestError("x", 403, "mfa_code_invalid"), "code", now),
    ).toMatchObject({ field: "code", wrongCode: true });
    expect(
      twoFactorFailure(new WgwRequestError("x", 409, "mfa_already_enabled"), "code", now),
    ).toMatchObject({ field: null, message: labels.alreadyOn });
    expect(
      twoFactorFailure(new WgwRequestError("x", 409, "mfa_not_enabled"), "code", now),
    ).toMatchObject({ field: null, message: labels.alreadyOff });
    expect(
      twoFactorFailure(new AppPasswordThrottledError("x", 60, "throttled"), "password", now),
    ).toMatchObject({ field: "password" });
    expect(twoFactorFailure(new WgwRequestError("x", 500), "code", now)).toMatchObject({
      field: null,
      message: labels.failed,
    });
  });
});
