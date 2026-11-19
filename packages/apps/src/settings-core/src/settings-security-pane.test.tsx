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
import { appPasswordLabels as labels } from "@/settings-core/src/settings-app-passwords-labels";
import { SettingsSecurityPane } from "@/settings-core/src/settings-security-pane";
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

function renderPane(rows: AppPassword[] = MOCK_APP_PASSWORDS, options = {}) {
  const operations = createMockAppPasswordOperations(rows, options);
  vi.spyOn(operations, "create");
  vi.spyOn(operations, "revoke");
  vi.spyOn(operations, "revokeAll");
  render(
    <TooltipProvider>
      <SettingsSecurityPane operations={operations} />
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
  it("lists app passwords with name, app, last used and created", async () => {
    renderPane();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("iPhone calendar")).toBeTruthy();
    expect(within(table).getByText("Thunderbird/128.4")).toBeTruthy();
    expect(within(table).getByText(labels.neverUsed)).toBeTruthy();
    expect(within(table).getAllByRole("row")).toHaveLength(MOCK_APP_PASSWORDS.length + 1);
  });

  it("shows the empty state without a Remove all button", async () => {
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
    expect(within(await screen.findByRole("table")).getByText("Phone")).toBeTruthy();

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

  it("says to try again later when the sign-in limit is reached", async () => {
    renderPane([]);
    const dialog = await openCreate();
    type(labels.nameLabel, "Phone");
    type(labels.currentPasswordLabel, "throttled");
    fireEvent.click(within(dialog).getByRole("button", { name: labels.create }));
    expect(await within(dialog).findByText(labels.throttled(null))).toBeTruthy();
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

  it("removes one app password after a confirm", async () => {
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

  it("removes all after a confirm", async () => {
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
