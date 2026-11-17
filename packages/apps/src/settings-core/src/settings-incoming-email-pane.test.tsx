import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockCalendarReplyMailboxOperations,
  mockCalendarReplyMailbox,
} from "@/lib/api/mock/calendar-reply-mailbox";
import { MailboxLoginsLimitedError } from "@/lib/api/wgw/calendar-reply-mailbox";
import { incomingEmailLabels as labels } from "@/settings-core/src/settings-incoming-email-labels";
import { SettingsIncomingEmailPane } from "@/settings-core/src/settings-incoming-email-pane";
import { TooltipProvider } from "@/ui/tooltip";
import type { CalendarReplyMailbox } from "@wgw/openapi-types/calendars-types";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ showSuccess: toast.success, showError: toast.error }),
}));

function setOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

function spiedOperations(seed: CalendarReplyMailbox | null = null) {
  const operations = createMockCalendarReplyMailboxOperations(seed);
  vi.spyOn(operations, "save");
  vi.spyOn(operations, "test");
  vi.spyOn(operations, "disconnect");
  return operations;
}

function renderSection(operations = spiedOperations()) {
  render(
    <TooltipProvider>
      <SettingsIncomingEmailPane operations={operations} />
    </TooltipProvider>,
  );
  return operations;
}

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** The connection tag (in the card title here; the Settings page puts it in its title row). */
function tag(): string {
  return screen.getByRole("status").textContent ?? "";
}

/** What the tag's tooltip says. */
function tagDetail(): string | null {
  return screen.getByRole("status").getAttribute("aria-description");
}

/** A connected mailbox; Test connection gets it back unchanged. */
function seeded(overrides: Parameters<typeof mockCalendarReplyMailbox>[0] = {}) {
  const seed = mockCalendarReplyMailbox(overrides);
  const operations = spiedOperations(seed);
  vi.mocked(operations.test).mockResolvedValue({ mailbox: seed });
  return operations;
}

function fillNewMailbox(password: string): void {
  type(labels.host, "imap.example.org");
  type(labels.username, "me@example.org");
  type(labels.password, password);
}

beforeEach(() => {
  setOnline(true);
  toast.success.mockClear();
  toast.error.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("SettingsIncomingEmailPane", () => {
  it("connects a mailbox after the login succeeds, then offers Test connection and Disconnect", async () => {
    const operations = renderSection();
    await screen.findByLabelText(labels.host);
    expect(tag()).toBe(labels.tag.notConnected);
    expect(screen.queryByRole("button", { name: labels.disconnect })).toBeNull();

    fillNewMailbox("app-password");
    fireEvent.click(screen.getByRole("button", { name: labels.connect }));

    await screen.findByRole("button", { name: labels.disconnect });
    expect(operations.save).toHaveBeenCalledWith({
      host: "imap.example.org",
      security: "ssl",
      username: "me@example.org",
      password: "app-password",
      folder: "INBOX",
    });
    expect(toast.success).toHaveBeenCalledWith(labels.connected);
    expect(tag()).toBe(labels.tag.connected);
    expect(screen.queryByRole("button", { name: labels.connect })).toBeNull();
    expect(screen.getByRole("button", { name: labels.check })).toBeTruthy();
    expect((screen.getByLabelText(labels.passwordHidden) as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByRole("button", { name: labels.passwordChange })).toBeTruthy();
  });

  it("shows Connecting while the first login runs", async () => {
    const operations = spiedOperations();
    let finish: () => void = () => {};
    vi.mocked(operations.save).mockImplementationOnce(
      (update) =>
        new Promise((resolve) => {
          finish = () => resolve({ mailbox: mockCalendarReplyMailbox({ host: update.host }) });
        }),
    );
    renderSection(operations);
    await screen.findByLabelText(labels.host);

    fillNewMailbox("app-password");
    fireEvent.click(screen.getByRole("button", { name: labels.connect }));

    const pending = await screen.findByRole("button", { name: labels.connecting });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect(tag()).toBe(labels.tag.connecting);

    finish();
    await screen.findByRole("button", { name: labels.disconnect });
  });

  it("shows Connected when signing in works, even before any sender can be verified", async () => {
    const operations = spiedOperations();
    vi.mocked(operations.save).mockImplementation(async (update) => ({
      mailbox: mockCalendarReplyMailbox({ host: update.host, trustedServer: null }),
    }));
    renderSection(operations);
    await screen.findByLabelText(labels.host);

    fillNewMailbox("app-password");
    fireEvent.click(screen.getByRole("button", { name: labels.connect }));

    await screen.findByRole("button", { name: labels.disconnect });
    expect(toast.success).toHaveBeenCalledWith(labels.connected);
    expect(tag()).toBe(labels.tag.connected);
    expect(screen.queryByText(/calendar|invitation/i)).toBeNull();
  });

  it("keeps the form as typed and says why when the login fails", async () => {
    const operations = renderSection();
    await screen.findByLabelText(labels.host);

    fillNewMailbox("wrong");
    fireEvent.click(screen.getByRole("button", { name: labels.connect }));

    expect((await screen.findByRole("alert")).textContent).toBe(labels.errors.auth_failed);
    expect(operations.save).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(labels.host) as HTMLInputElement).value).toBe("imap.example.org");
    expect(screen.getByRole("button", { name: labels.connect })).toBeTruthy();
  });

  it("asks for the password before the first connect", async () => {
    const operations = renderSection();
    await screen.findByLabelText(labels.host);

    type(labels.host, "imap.example.org");
    type(labels.username, "me@example.org");
    fireEvent.click(screen.getByRole("button", { name: labels.connect }));

    expect((await screen.findByRole("alert")).textContent).toBe(labels.required);
    expect(operations.save).not.toHaveBeenCalled();
  });

  it("rejects a port that is not a number instead of sending it", async () => {
    const operations = renderSection();
    await screen.findByLabelText(labels.host);

    fillNewMailbox("app-password");
    type(labels.port, "99a");
    fireEvent.click(screen.getByRole("button", { name: labels.connect }));

    expect((await screen.findByRole("alert")).textContent).toBe(labels.invalid);
    expect(operations.save).not.toHaveBeenCalled();
  });

  it("says when the mail server can be checked again after too many logins", async () => {
    const operations = seeded();
    vi.mocked(operations.test).mockRejectedValueOnce(
      new MailboxLoginsLimitedError("POST failed (429)", 120, "rate_limited"),
    );
    renderSection(operations);
    fireEvent.click(await screen.findByRole("button", { name: labels.check }));

    const alert = (await screen.findByRole("alert")).textContent ?? "";
    expect(alert).toMatch(/^The mail server was tested several times in a row\. Test again after /);
    expect(operations.test).toHaveBeenCalledTimes(1);
  });

  it("checks a saved mailbox only when asked", async () => {
    const operations = renderSection(
      spiedOperations(mockCalendarReplyMailbox({ active: false, lastError: "auth_failed" })),
    );
    await screen.findByRole("button", { name: labels.disconnect });
    expect(tag()).toBe(labels.tag.paused);
    expect(operations.test).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: labels.check }));

    await waitFor(() => expect(tag()).toBe(labels.tag.connected));
    expect(operations.test).toHaveBeenCalledTimes(1);
    expect(operations.save).not.toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith(labels.checked);
  });

  it("marks edits Unsaved and saves them with Test connection, keeping the password and the folder", async () => {
    const operations = renderSection(seeded({ folder: "Calendar replies" }));
    await screen.findByRole("button", { name: labels.disconnect });
    expect(screen.queryByLabelText("Folder")).toBeNull();

    type(labels.username, "me+cal@example.com");

    await waitFor(() => expect(tag()).toBe(labels.tag.unsaved));
    expect(tagDetail()).toBe(labels.unsavedDetail);
    expect(operations.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: labels.check }));

    await waitFor(() =>
      expect(operations.save).toHaveBeenCalledWith({
        host: "imap.example.com",
        security: "ssl",
        username: "me+cal@example.com",
        folder: "Calendar replies",
      }),
    );
    expect(operations.save).toHaveBeenCalledTimes(1);
    expect(operations.test).not.toHaveBeenCalled();
    await waitFor(() => expect(tag()).toBe(labels.tag.connected));
    expect(toast.success).toHaveBeenCalledWith(labels.saved);
  });

  it("needs the password again for a new port, given in the Change dialog", async () => {
    const operations = renderSection(seeded());
    await screen.findByRole("button", { name: labels.disconnect });

    type(labels.port, "1993");
    fireEvent.click(screen.getByRole("button", { name: labels.check }));

    expect((await screen.findByRole("alert")).textContent).toBe(labels.passwordAgain);
    expect(operations.save).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: labels.passwordChange }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(labels.passwordNew), {
      target: { value: "app-password" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: labels.passwordSubmit }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(labels.passwordChanged));
    expect(operations.save).toHaveBeenCalledWith(
      expect.objectContaining({ port: 1993, password: "app-password" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps the Change dialog open with the reason when the new password fails", async () => {
    renderSection(seeded());
    fireEvent.click(await screen.findByRole("button", { name: labels.passwordChange }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: labels.passwordSubmit }));
    expect(await within(dialog).findByText(labels.passwordRequired)).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText(labels.passwordNew), {
      target: { value: "wrong" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: labels.passwordSubmit }));

    expect(await within(dialog).findByText(labels.errors.auth_failed)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBe(dialog);
  });

  it("asks before it disconnects a mailbox", async () => {
    const operations = renderSection(seeded());
    fireEvent.click(await screen.findByRole("button", { name: labels.disconnect }));

    const confirm = await screen.findByRole("alertdialog");
    expect(confirm.textContent).toContain(labels.disconnectDescription);
    fireEvent.click(within(confirm).getByRole("button", { name: labels.cancel }));
    expect(operations.disconnect).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: labels.disconnect }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: labels.disconnect,
      }),
    );

    await screen.findByRole("button", { name: labels.connect });
    expect(operations.disconnect).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(labels.host) as HTMLInputElement).value).toBe("");
    expect(tag()).toBe(labels.tag.notConnected);
  });

  it.each([
    [{ active: false, lastError: "auth_failed" as const }, labels.tag.paused, labels.statusPaused],
    [{ lastError: "connect_failed" as const }, labels.tag.failed, labels.errors.connect_failed],
    [
      { lastError: "dns_unavailable" as const },
      labels.tag.connected,
      labels.errors.dns_unavailable,
    ],
  ])("shows how reading goes (%o)", async (overrides, tagLabel, detail) => {
    renderSection(seeded(overrides));
    await screen.findByRole("button", { name: labels.disconnect });
    expect(tag()).toBe(tagLabel);
    expect(tagDetail()).toContain(detail);
  });

  it("shows a mailbox without a trusted receiving server as Connected, with no error", async () => {
    renderSection(seeded({ trustedServer: null, lastError: "untrusted_server_unknown" as const }));
    await screen.findByRole("button", { name: labels.disconnect });
    expect(tag()).toBe(labels.tag.connected);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("explains what is read and the Gmail app password step behind the info button", async () => {
    renderSection();
    await screen.findByLabelText(labels.host);
    expect(screen.getByRole("button", { name: labels.about })).toBeTruthy();
    expect(screen.queryByText(labels.reading)).toBeNull();
    expect(labels.reading).toContain("Nothing is marked, moved or deleted");
    expect(labels.providers).toContain("Outlook.com, Hotmail and Microsoft 365 cannot connect yet");
    expect(labels.providers).toContain("app password");
    expect(labels.providers).toContain("2-Step Verification");
  });

  it("says it needs a connection while offline", async () => {
    setOnline(false);
    renderSection();
    expect(await screen.findByText(labels.offline)).toBeTruthy();
  });
});
