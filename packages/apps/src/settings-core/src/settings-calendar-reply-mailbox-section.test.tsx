import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMockCalendarReplyMailboxOperations,
  mockCalendarReplyMailbox,
} from "@/lib/api/mock/calendar-reply-mailbox";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { calendarReplyMailboxLabels as labels } from "@/settings-core/src/settings-calendar-reply-mailbox-labels";
import { SettingsCalendarReplyMailboxSection } from "@/settings-core/src/settings-calendar-reply-mailbox-section";
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
      <SettingsCalendarReplyMailboxSection operations={operations} />
    </TooltipProvider>,
  );
  return operations;
}

function type(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
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

describe("SettingsCalendarReplyMailboxSection", () => {
  it("connects a mailbox after the login succeeds and shows that replies are read", async () => {
    const operations = renderSection();
    await screen.findByLabelText(labels.host);
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
    expect(screen.getByRole("status").textContent).toContain(labels.statusReading);
    expect((screen.getByLabelText(labels.password) as HTMLInputElement).value).toBe("");
    expect(screen.getByText(labels.passwordKeep)).toBeTruthy();
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

  it("says when too many logins were tried", async () => {
    const operations = spiedOperations();
    vi.mocked(operations.save).mockRejectedValueOnce(
      new WgwRequestError("PUT failed (429)", 429, "rate_limited"),
    );
    renderSection(operations);
    await screen.findByLabelText(labels.host);

    fillNewMailbox("app-password");
    fireEvent.click(screen.getByRole("button", { name: labels.connect }));

    expect((await screen.findByRole("alert")).textContent).toBe(labels.tooMany);
  });

  it("saves a connected mailbox only after a change and keeps the saved password", async () => {
    const operations = renderSection(spiedOperations(mockCalendarReplyMailbox()));
    const save = await screen.findByRole("button", { name: labels.save });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    type(labels.folder, "Replies");
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(labels.saved));
    expect(operations.save).toHaveBeenCalledWith({
      host: "imap.example.com",
      security: "ssl",
      username: "me@example.com",
      folder: "Replies",
    });
  });

  it("checks and disconnects a connected mailbox", async () => {
    const operations = renderSection(spiedOperations(mockCalendarReplyMailbox()));
    fireEvent.click(await screen.findByRole("button", { name: labels.check }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(labels.checked));
    expect(operations.test).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: labels.disconnect }));

    await screen.findByRole("button", { name: labels.connect });
    expect(operations.disconnect).toHaveBeenCalledTimes(1);
    expect((screen.getByLabelText(labels.host) as HTMLInputElement).value).toBe("");
  });

  it.each([
    [{ active: false, lastError: "auth_failed" as const }, labels.statusPaused],
    [{ trustedServer: null }, labels.statusWaiting],
    [{ lastError: "connect_failed" as const }, labels.errors.connect_failed],
  ])("shows how reading goes (%o)", async (overrides, expected) => {
    renderSection(spiedOperations(mockCalendarReplyMailbox(overrides)));
    await screen.findByRole("button", { name: labels.disconnect });
    expect(screen.getByRole("status").textContent).toContain(expected);
  });

  it("resumes a paused mailbox with Check now", async () => {
    renderSection(
      spiedOperations(mockCalendarReplyMailbox({ active: false, lastError: "auth_failed" })),
    );
    const check = await screen.findByRole("button", { name: labels.check });
    expect(screen.getByRole("status").textContent).toContain("Check now");
    expect((check as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(check);

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(labels.statusReading),
    );
  });

  it("explains the Gmail app password step before connecting", async () => {
    renderSection();
    await screen.findByLabelText(labels.host);
    expect(screen.getByText(labels.passwordHint)).toBeTruthy();
    expect(labels.passwordHint).toContain("app password");
    expect(labels.passwordHint).toContain("2-Step Verification");
  });

  it("says it needs a connection while offline", async () => {
    setOnline(false);
    renderSection();
    expect((await screen.findByRole("status")).textContent).toBe(labels.offline);
  });
});
