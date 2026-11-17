import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createMockCalendarReplyMailboxOperations,
  MOCK_MAILBOX_FOLDERS,
  mockCalendarReplyMailbox,
} from "@/lib/api/mock/calendar-reply-mailbox";
import { MailboxLoginsLimitedError } from "@/lib/api/wgw/calendar-reply-mailbox";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { calendarReplyFolderLabels as labels } from "@/settings-core/src/settings-calendar-reply-folder-labels";
import { SettingsCalendarReplyFolderSection } from "@/settings-core/src/settings-calendar-reply-folder-section";
import {
  SettingsDialogContext,
  type SettingsDialogApi,
} from "@/settings-core/src/settings-dialog-context";
import type { IncomingMailbox } from "@/settings-core/src/settings-incoming-email-source";
import { TooltipProvider } from "@/ui/tooltip";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/hooks/use-app-toast", () => ({
  useAppToast: () => ({ showSuccess: toast.success, showError: toast.error }),
}));

function renderSection(seed: IncomingMailbox | null) {
  const operations = createMockCalendarReplyMailboxOperations(seed);
  vi.spyOn(operations, "save");
  vi.spyOn(operations, "folders");
  const dialog: SettingsDialogApi = {
    openPanel: vi.fn(),
    openRegisteredPanel: vi.fn(),
    showPanel: vi.fn(),
  };
  render(
    <SettingsDialogContext.Provider value={dialog}>
      <TooltipProvider>
        <SettingsCalendarReplyFolderSection operations={operations} />
      </TooltipProvider>
    </SettingsDialogContext.Provider>,
  );
  return { operations, dialog };
}

/** Radix Select opens on pointer down. */
function openFolders(): void {
  const trigger = screen.getByRole("combobox", { name: labels.folder });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
}

beforeAll(() => {
  // Radix Select needs pointer capture and scrolling, which jsdom lacks.
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  toast.success.mockClear();
});

describe("SettingsCalendarReplyFolderSection", () => {
  it("links to Incoming email when no mailbox is connected", async () => {
    const { dialog } = renderSection(null);

    fireEvent.click(await screen.findByRole("button", { name: labels.openIncomingEmail }));

    expect(screen.getByText(labels.notConnected)).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: labels.folder })).toBeNull();
    expect(dialog.showPanel).toHaveBeenCalledWith("incoming-email");
  });

  it("lists the folders only when the dropdown opens, and saves a pick by its id", async () => {
    const { operations } = renderSection(mockCalendarReplyMailbox());
    const trigger = await screen.findByRole("combobox", { name: labels.folder });
    expect(trigger.textContent).toContain("INBOX");
    expect(operations.folders).not.toHaveBeenCalled();

    openFolders();
    const replies = await screen.findByRole("option", { name: "INBOX / Calendar replies" });
    expect(operations.folders).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(
      MOCK_MAILBOX_FOLDERS.map((folder) => folder.label),
    );
    fireEvent.click(replies);

    await waitFor(() =>
      expect(operations.save).toHaveBeenCalledWith({
        host: "imap.example.com",
        security: "ssl",
        port: 993,
        username: "me@example.com",
        folder: "INBOX",
        folderId: "M-replies",
      }),
    );
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(labels.folderSaved));
    expect(screen.getByRole("combobox", { name: labels.folder }).textContent).toContain(
      "INBOX / Calendar replies",
    );
  });

  it("says why the folders could not be listed", async () => {
    const { operations } = renderSection(mockCalendarReplyMailbox());
    await screen.findByRole("combobox", { name: labels.folder });
    vi.mocked(operations.folders).mockRejectedValueOnce(
      new MailboxLoginsLimitedError("Mailbox/get failed", 120, "rate_limited"),
    );

    openFolders();

    expect((await screen.findByRole("alert")).textContent).toMatch(/Test again after/);
  });

  it("says when the picked folder no longer exists", async () => {
    const { operations } = renderSection(mockCalendarReplyMailbox());
    await screen.findByRole("combobox", { name: labels.folder });
    vi.mocked(operations.save).mockRejectedValueOnce(
      new WgwRequestError("PUT failed (422)", 422, "folder_missing"),
    );

    openFolders();
    fireEvent.click(await screen.findByRole("option", { name: "Archive" }));

    expect((await screen.findByRole("alert")).textContent).toBe(labels.folderMissing);
  });
});
