import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMockCalendarReplyMailboxOperations,
  mockCalendarReplyMailbox,
} from "@/lib/api/mock/calendar-reply-mailbox";
import { WgwRequestError } from "@/lib/api/wgw/request-error";
import { calendarReplyFolderLabels as labels } from "@/settings-core/src/settings-calendar-reply-folder-labels";
import { SettingsCalendarReplyFolderSection } from "@/settings-core/src/settings-calendar-reply-folder-section";
import {
  SettingsDialogContext,
  type SettingsDialogApi,
} from "@/settings-core/src/settings-dialog-context";
import type { IncomingMailbox } from "@/settings-core/src/settings-incoming-email-source";
import { REPLY_FOLDER_AUTOSAVE_DELAY_MS } from "@/settings-core/src/use-settings-calendar-reply-folder";
import { TooltipProvider } from "@/ui/tooltip";

function renderSection(seed: IncomingMailbox | null) {
  const operations = createMockCalendarReplyMailboxOperations(seed);
  vi.spyOn(operations, "save");
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

function typeFolder(value: string): void {
  fireEvent.change(screen.getByLabelText(labels.folder), { target: { value } });
}

async function waitForAutosave(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(REPLY_FOLDER_AUTOSAVE_DELAY_MS + 50);
  });
}

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("SettingsCalendarReplyFolderSection", () => {
  it("links to Incoming email when no mailbox is connected", async () => {
    const { dialog } = renderSection(null);

    fireEvent.click(await screen.findByRole("button", { name: labels.openIncomingEmail }));

    expect(screen.getByText(labels.notConnected)).toBeTruthy();
    expect(screen.queryByLabelText(labels.folder)).toBeNull();
    expect(dialog.showPanel).toHaveBeenCalledWith("incoming-email");
  });

  it("saves the folder by itself, keeping the rest of the connection", async () => {
    const { operations } = renderSection(mockCalendarReplyMailbox());
    const input = (await screen.findByLabelText(labels.folder)) as HTMLInputElement;
    expect(input.value).toBe("INBOX");
    vi.useFakeTimers({ shouldAdvanceTime: true });

    typeFolder("Calendar replies");
    await waitForAutosave();

    await waitFor(() =>
      expect(operations.save).toHaveBeenCalledWith({
        host: "imap.example.com",
        security: "ssl",
        port: 993,
        username: "me@example.com",
        folder: "Calendar replies",
      }),
    );
    expect(operations.save).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when the folder does not exist and keeps what was typed", async () => {
    const { operations } = renderSection(mockCalendarReplyMailbox());
    await screen.findByLabelText(labels.folder);
    vi.mocked(operations.save).mockRejectedValueOnce(
      new WgwRequestError("PUT failed (422)", 422, "folder_missing"),
    );
    vi.useFakeTimers({ shouldAdvanceTime: true });

    typeFolder("Nope");
    await waitForAutosave();

    expect((await screen.findByRole("alert")).textContent).toBe(labels.folderMissing);
    expect((screen.getByLabelText(labels.folder) as HTMLInputElement).value).toBe("Nope");
  });
});
