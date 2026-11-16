import { useCallback, useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { useFormAutosave } from "@/hooks/use-form-autosave";
import { isApiError } from "@/lib/api/api-error";
import { calendarReplyFolderLabels as labels } from "@/settings-core/src/settings-calendar-reply-folder-labels";
import {
  DEFAULT_MAILBOX_FOLDER,
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

export type CalendarReplyFolderFormValues = { folder: string };

export type SettingsCalendarReplyFolderController = {
  phase: ServerSettingsPhase;
  /** The connected mailbox; null when the user has not connected one in Incoming email. */
  mailbox: IncomingMailbox | null;
  form: UseFormReturn<CalendarReplyFolderFormValues>;
  /** Why the last save failed, shown under the folder. */
  failure: string | null;
  retry: () => void;
};

/**
 * Saving the folder logs in to the mailbox (to check that the folder exists), and logins are
 * rate limited, so wait for a longer pause in typing than other preferences do.
 */
export const REPLY_FOLDER_AUTOSAVE_DELAY_MS = 1200;

function folderForm(mailbox: IncomingMailbox | null): CalendarReplyFolderFormValues {
  return { folder: mailbox?.folder ?? DEFAULT_MAILBOX_FOLDER };
}

/**
 * The folder Calendar reads invitation replies from (#1589), in Settings → Calendar. The
 * mailbox itself is connected in Settings → Incoming email. The folder saves itself.
 */
export function useSettingsCalendarReplyFolder(
  operations: IncomingMailboxOperations = defaultIncomingMailboxOperations(),
): SettingsCalendarReplyFolderController {
  const [mailbox, setMailbox] = useState<IncomingMailbox | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<CalendarReplyFolderFormValues>({ defaultValues: folderForm(null) });

  /** `submitted`: the folder a save sent. A folder typed since then stays, for the next save. */
  const apply = useCallback(
    (next: IncomingMailbox | null, submitted?: string) => {
      setMailbox(next);
      if (submitted === undefined || form.getValues("folder") === submitted) {
        form.reset(folderForm(next));
      }
    },
    [form],
  );
  const { phase, requestRef, operationsRef, retry } = useIncomingMailboxLoad(
    operations,
    apply,
    () => form.formState.isDirty,
  );

  const save = form.handleSubmit(async ({ folder }) => {
    if (!mailbox) return;
    requestRef.current += 1;
    try {
      const next = await operationsRef.current.save(mailboxFolderUpdate(mailbox, folder));
      setFailure(null);
      apply(next.mailbox, folder);
    } catch (error) {
      setFailure(
        isApiError(error) && error.status === 400
          ? labels.folderInvalid
          : mailboxFailureSentence(error, { folder_missing: labels.folderMissing }),
      );
    }
  });

  useFormAutosave(form, save, REPLY_FOLDER_AUTOSAVE_DELAY_MS);

  return { phase, mailbox, form, failure, retry };
}
