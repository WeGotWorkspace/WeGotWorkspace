import { useCallback, useRef, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import type { MailboxFolder } from "@/lib/api/wgw/calendar-reply-mailbox";
import { calendarReplyFolderLabels as labels } from "@/settings-core/src/settings-calendar-reply-folder-labels";
import {
  defaultIncomingMailboxOperations,
  mailboxFolderUpdate,
  type IncomingMailbox,
  type IncomingMailboxOperations,
} from "@/settings-core/src/settings-incoming-email-source";
import type { ServerSettingsPhase } from "@/settings-core/src/settings-server-load";
import {
  mailboxFailureSentence,
  useIncomingMailboxLoad,
} from "@/settings-core/src/use-settings-incoming-email";

export type ReplyFolderList =
  | { status: "idle" | "loading" }
  | { status: "ready"; folders: MailboxFolder[] }
  | { status: "error"; failure: string };

export type SettingsCalendarReplyFolderController = {
  phase: ServerSettingsPhase;
  /** The connected mailbox; null when the user has not connected one in Incoming email. */
  mailbox: IncomingMailbox | null;
  /** The mailbox's folders, listed once the dropdown first opens. */
  folderList: ReplyFolderList;
  loadFolders: () => void;
  /** The folder being saved, while it is. */
  savingFolderId: string | null;
  chooseFolder: (folderId: string) => void;
  /** Why the last save failed, shown under the folder. */
  failure: string | null;
  retry: () => void;
};

const FOLDER_ERRORS = { folder_missing: labels.folderMissing };

/**
 * The folder Calendar reads invitation replies from (#1589), in Settings → Calendar. The
 * mailbox itself is connected in Settings → Incoming email. Listing the folders and saving one
 * each log in to the mail server, so the list loads only when the dropdown first opens.
 */
export function useSettingsCalendarReplyFolder(
  operations: IncomingMailboxOperations = defaultIncomingMailboxOperations(),
): SettingsCalendarReplyFolderController {
  const { showSuccess } = useAppToast();
  const [mailbox, setMailbox] = useState<IncomingMailbox | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [folderList, setFolderList] = useState<ReplyFolderList>({ status: "idle" });
  const [savingFolderId, setSavingFolderId] = useState<string | null>(null);
  const listing = useRef(false);

  const apply = useCallback((next: IncomingMailbox | null) => setMailbox(next), []);
  const { phase, requestRef, operationsRef, retry } = useIncomingMailboxLoad(
    operations,
    apply,
    () => false,
  );

  const loadFolders = () => {
    if (listing.current || folderList.status === "loading" || folderList.status === "ready") {
      return;
    }
    listing.current = true;
    setFolderList({ status: "loading" });
    operationsRef.current
      .folders()
      .then((folders) => setFolderList({ status: "ready", folders }))
      .catch((error: unknown) =>
        setFolderList({ status: "error", failure: mailboxFailureSentence(error, FOLDER_ERRORS) }),
      )
      .finally(() => {
        listing.current = false;
      });
  };

  const chooseFolder = (folderId: string) => {
    if (!mailbox || folderId === mailbox.folderId) return;
    requestRef.current += 1;
    setSavingFolderId(folderId);
    setFailure(null);
    operationsRef.current
      .save(mailboxFolderUpdate(mailbox, folderId))
      .then((next) => {
        setMailbox(next.mailbox);
        showSuccess(labels.folderSaved);
      })
      .catch((error: unknown) => setFailure(mailboxFailureSentence(error, FOLDER_ERRORS)))
      .finally(() => setSavingFolderId(null));
  };

  return {
    phase,
    mailbox,
    folderList,
    loadFolders,
    savingFolderId,
    chooseFolder,
    failure,
    retry,
  };
}
