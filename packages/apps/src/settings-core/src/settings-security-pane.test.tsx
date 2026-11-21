import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockAppPasswordOperations,
  MOCK_ACCOUNT_PASSWORD,
  MOCK_APP_PASSWORDS,
} from "@/lib/api/mock/app-passwords";
import {
  AppPasswordThrottledError,
  formatAppPassword,
  type AppPassword,
} from "@/lib/api/wgw/app-passwords";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { MOCK_SIGN_IN } from "@/lib/api/mock/sign-in";
import { createMockTwoFactorOperations } from "@/lib/api/mock/two-factor-settings";
import { twoFactorLabels } from "@/two-factor-ui/src/two-factor-labels";
import { twoFactorSettingsLabels } from "@/settings-core/src/settings-two-factor-labels";
import { appPasswordLabels as labels } from "@/settings-core/src/settings-app-passwords-labels";
import {
  appPasswordDescription,
  SettingsSecurityPane,
} from "@/settings-core/src/settings-security-pane";
import { appPasswordCreateFieldError } from "@/settings-core/src/use-settings-app-passwords";
import { TooltipProvider } from "@/ui/tooltip";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ showSuccess: toast.success, showError: toast.error }),
}));

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

function renderPane(rows: AppPassword[] = MOCK_APP_PASSWORDS, options = {}, twoFactorOn = false) {
  const operations = createMockAppPasswordOperations(rows, options);
  vi.spyOn(operations, "create");
  vi.spyOn(operations, "revoke");
  vi.spyOn(operations, "revokeAll");
  render(
    <TooltipProvider>
      <SettingsSecurityPane
        operations={operations}
        twoFactor={{
          operations: createMockTwoFactorOperations({
            enabled: twoFactorOn,
            recoveryCodesRemaining: twoFactorOn ? 10 : null,
          }),
        }}
      />
    </TooltipProvider>,
  );
  return operations;
}

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function openCreate(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: labels.newButton }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  setOnline(true);
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("appPasswordDescription", () => {
  const now = new Date(2026, 10, 20, 12, 0);
  const row: AppPassword = {
    id: 1,
    name: "Phone",
    createdAt: new Date(2026, 10, 20, 9, 0).toISOString(),
    lastUsedAt: null,
    lastUsedClient: null,
  };

  it("says when it was made and that it was not used yet", () => {
    expect(appPasswordDescription(row, now)).toMatch(/^Created (20 Nov|Nov 20) · Not used yet$/);
  });

  it("adds when and by which app it was last used", () => {
    const used = {
      ...row,
      lastUsedAt: new Date(2026, 10, 18, 9, 0).toISOString(),
      lastUsedClient: "Thunderbird/128.4",
    };
    expect(appPasswordDescription(used, now)).toMatch(
      /^Created (20 Nov|Nov 20) · Last used 2 days ago · Thunderbird\/128\.4$/,
    );
  });

  it("shows the year of an older one", () => {
    const old = { ...row, createdAt: new Date(2025, 5, 3).toISOString() };
    expect(appPasswordDescription(old, now)).toMatch(/2025/);
  });
});

describe("formatAppPassword", () => {
  it("groups sixteen letters in fours and ignores spaces already there", () => {
    expect(formatAppPassword("abcdefghijklmnop")).toBe("abcd efgh ijkl mnop");
    expect(formatAppPassword("abcd efgh ijkl mnop")).toBe("abcd efgh ijkl mnop");
    expect(formatAppPassword("")).toBe("");
  });
});

describe("appPasswordCreateFieldError", () => {
  it("says the account password is wrong on a 403", () => {
    expect(
      appPasswordCreateFieldError(new WgwRequestError("x", 403, "current_password_invalid")),
    ).toBe(labels.wrongPassword);
  });

  it("says when to try again on a 429, from Retry-After", () => {
    const now = new Date(2026, 10, 19, 22, 0).getTime();
    const message = appPasswordCreateFieldError(
      new AppPasswordThrottledError("x", 15 * 60, "throttled"),
      now,
    );
    const at = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
      now + 15 * 60 * 1000,
    );
    expect(message).toBe(labels.throttled(at));
  });

  it("says to try later on a 429 without Retry-After", () => {
    expect(appPasswordCreateFieldError(new AppPasswordThrottledError("x", null, "throttled"))).toBe(
      labels.throttled(null),
    );
  });

  it("leaves other failures to the toast", () => {
    expect(appPasswordCreateFieldError(new WgwRequestError("x", 500))).toBeNull();
    expect(appPasswordCreateFieldError(new TypeError("Failed to fetch"))).toBeNull();
  });
});

describe("SettingsSecurityPane", () => {
  it("lists app passwords as rows: name, when made, when and by which app last used", async () => {
    renderPane();
    expect(await screen.findByText("iPhone calendar")).toBeTruthy();
    expect(screen.getByText(/Last used .* · Thunderbird\/128\.4$/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    for (const row of MOCK_APP_PASSWORDS) {
      expect(screen.getByRole("button", { name: labels.remove(row.name) })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: labels.removeAllButton })).toBeTruthy();
  });

  it("says Not used yet for an app password that was never used", async () => {
    renderPane();
    expect(await screen.findByText(/^Created .* · Not used yet$/)).toBeTruthy();
  });

  it("offers Revoke all only from two app passwords", async () => {
    renderPane(MOCK_APP_PASSWORDS.slice(0, 1));
    expect(
      await screen.findByRole("button", { name: labels.remove(MOCK_APP_PASSWORDS[0]!.name) }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: labels.removeAllButton })).toBeNull();
  });

  it("shows the empty state without a Revoke all button", async () => {
    renderPane([]);
    expect(await screen.findByText(labels.empty)).toBeTruthy();
    expect(screen.queryByRole("button", { name: labels.removeAllButton })).toBeNull();
  });

  it("shows a retry when the list cannot load", async () => {
    renderPane([], { failList: true });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText(labels.loadFailed)).toBeTruthy();
  });

  it("creates one, shows the password once in groups of four, and forgets it on Done", async () => {
    const operations = renderPane([]);
    const dialog = await openCreate();
    type(labels.nameLabel, "  Phone  ");
    type(labels.currentPasswordLabel, MOCK_ACCOUNT_PASSWORD);
    fireEvent.click(within(dialog).getByRole("button", { name: labels.create }));

    const secret = (await screen.findByLabelText(labels.createdLabel)) as HTMLInputElement;
    expect(secret.value).toMatch(/^[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}$/);
    expect(operations.create).toHaveBeenCalledWith({
      name: "Phone",
      currentPassword: MOCK_ACCOUNT_PASSWORD,
    });

    fireEvent.click(screen.getByRole("button", { name: labels.done }));
    await waitFor(() => expect(screen.queryByLabelText(labels.createdLabel)).toBeNull());
    expect(await screen.findByText("Phone")).toBeTruthy();

    // Opening again starts empty: the plaintext is gone.
    const again = await openCreate();
    expect(within(again).queryByLabelText(labels.createdLabel)).toBeNull();
    expect((screen.getByLabelText(labels.nameLabel) as HTMLInputElement).value).toBe("");
  });

  it("copies the password without spaces", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    renderPane([]);
    const dialog = await openCreate();
    type(labels.nameLabel, "Phone");
    type(labels.currentPasswordLabel, MOCK_ACCOUNT_PASSWORD);
    fireEvent.click(within(dialog).getByRole("button", { name: labels.create }));
    fireEvent.click(await screen.findByRole("button", { name: labels.copy }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(labels.copied));
    expect(writeText.mock.calls[0]?.[0]).toMatch(/^[a-z]{16}$/);
  });

  it("asks for a name and the account password before calling the server", async () => {
    const operations = renderPane([]);
    const dialog = await openCreate();
    fireEvent.click(within(dialog).getByRole("button", { name: labels.create }));
    expect(await screen.findByText(labels.nameRequired)).toBeTruthy();
    expect(screen.getByText(labels.currentPasswordRequired)).toBeTruthy();
    expect(operations.create).not.toHaveBeenCalled();
  });

  it("shows a wrong account password inline and keeps the dialog open", async () => {
    renderPane([]);
    const dialog = await openCreate();
    type(labels.nameLabel, "Phone");
    type(labels.currentPasswordLabel, "wrong");
    fireEvent.click(within(dialog).getByRole("button", { name: labels.create }));
    expect(await within(dialog).findByText(labels.wrongPassword)).toBeTruthy();
    expect(screen.queryByLabelText(labels.createdLabel)).toBeNull();
  });

  it("says when to try again when the sign-in limit is reached", async () => {
    renderPane([]);
    const dialog = await openCreate();
    type(labels.nameLabel, "Phone");
    type(labels.currentPasswordLabel, "throttled");
    fireEvent.click(within(dialog).getByRole("button", { name: labels.create }));
    expect(await within(dialog).findByText(/^Too many tries\. Try again at .+\.$/)).toBeTruthy();
  });

  it("says to remove one first at the limit of 50", async () => {
    const operations = renderPane([]);
    vi.mocked(operations.create).mockRejectedValueOnce(
      new WgwRequestError("x", 422, "app_password_limit"),
    );
    const dialog = await openCreate();
    type(labels.nameLabel, "Phone");
    type(labels.currentPasswordLabel, MOCK_ACCOUNT_PASSWORD);
    fireEvent.click(within(dialog).getByRole("button", { name: labels.create }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(labels.limitReached(50)));
  });

  describe("with two-factor on", () => {
    async function openCreateWithCode(): Promise<HTMLElement> {
      await screen.findByText(twoFactorSettingsLabels.statusOn);
      const dialog = await openCreate();
      expect(within(dialog).queryByLabelText(labels.currentPasswordLabel)).toBeNull();
      type(labels.nameLabel, "Phone");
      return dialog;
    }

    it("asks for a current code instead of the account password", async () => {
      const operations = renderPane([], {}, true);
      const dialog = await openCreateWithCode();
      fireEvent.click(within(dialog).getByRole("button", { name: labels.create }));
      expect(await within(dialog).findByText(twoFactorSettingsLabels.codeRequired)).toBeTruthy();
      expect(operations.create).not.toHaveBeenCalled();

      type(twoFactorLabels.codeLabel, "123 456");
      fireEvent.click(within(dialog).getByRole("button", { name: labels.create }));
      expect(await screen.findByLabelText(labels.createdLabel)).toBeTruthy();
      expect(operations.create).toHaveBeenCalledWith({ name: "Phone", code: MOCK_SIGN_IN.code });
    });

    it("shows a wrong code with the phone-clock hint, like replacing recovery codes", async () => {
      renderPane([], {}, true);
      const dialog = await openCreateWithCode();
      type(twoFactorLabels.codeLabel, "654321");
      fireEvent.click(within(dialog).getByRole("button", { name: labels.create }));
      expect(await within(dialog).findByText(twoFactorSettingsLabels.wrongCode)).toBeTruthy();
      expect(within(dialog).getByText(twoFactorLabels.clockHint)).toBeTruthy();
      expect(screen.queryByLabelText(labels.createdLabel)).toBeNull();
    });

    it("says when to try again when codes are paused", async () => {
      renderPane([], {}, true);
      const dialog = await openCreateWithCode();
      type(twoFactorLabels.codeLabel, MOCK_SIGN_IN.throttledCode);
      fireEvent.click(within(dialog).getByRole("button", { name: labels.create }));
      expect(await within(dialog).findByText(/^Too many tries\. Try again at /)).toBeTruthy();
    });
  });

  it("revokes one app password after a confirm", async () => {
    const operations = renderPane();
    fireEvent.click(await screen.findByRole("button", { name: labels.remove("Old Android") }));
    const confirm = await screen.findByRole("alertdialog");
    expect(within(confirm).getByText(labels.removeTitle("Old Android"))).toBeTruthy();
    fireEvent.click(within(confirm).getByRole("button", { name: labels.removeConfirm }));
    await waitFor(() => expect(screen.queryByText("Old Android")).toBeNull());
    expect(operations.revoke).toHaveBeenCalledWith(1);
    expect(toast.success).toHaveBeenCalledWith(labels.removed);
  });

  it("keeps the row when Cancel is chosen", async () => {
    const operations = renderPane();
    fireEvent.click(await screen.findByRole("button", { name: labels.remove("Old Android") }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: labels.cancel }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(operations.revoke).not.toHaveBeenCalled();
    expect(screen.getByText("Old Android")).toBeTruthy();
  });

  it("revokes all after a confirm", async () => {
    const operations = renderPane();
    fireEvent.click(await screen.findByRole("button", { name: labels.removeAllButton }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: labels.removeAllConfirm }));
    expect(await screen.findByText(labels.empty)).toBeTruthy();
    expect(operations.revokeAll).toHaveBeenCalledTimes(1);
  });

  it("keeps the rows and says so when removing fails", async () => {
    const operations = renderPane();
    vi.mocked(operations.revoke).mockRejectedValueOnce(new WgwRequestError("x", 500));
    fireEvent.click(await screen.findByRole("button", { name: labels.remove("Old Android") }));
    const confirm = await screen.findByRole("alertdialog");
    fireEvent.click(within(confirm).getByRole("button", { name: labels.removeConfirm }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(labels.removeFailed));
    expect(screen.getByText("Old Android")).toBeTruthy();
  });
});
