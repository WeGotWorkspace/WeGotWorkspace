import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { useOnReconnect } from "@/hooks/use-connectivity";
import { useAppToast } from "@/hooks/use-app-toast";
import { isApiError } from "@/lib/api/api-error";
import type { CalendarReplyMailboxOperations } from "@/lib/api/wgw/calendar-reply-mailbox";
import { isFetchNetworkError } from "@/lib/offline/browser-online";
import { calendarReplyMailboxLabels as labels } from "@/settings-core/src/settings-calendar-reply-mailbox-labels";
import {
  defaultCalendarReplyMailboxOperations,
  replyMailboxToForm,
  replyMailboxUpdateFromForm,
  type CalendarReplyMailboxFormValues,
} from "@/settings-core/src/settings-calendar-reply-mailbox-source";
import { loadServerSettings } from "@/settings-core/src/settings-server-load";
import type { CalendarReplyMailbox } from "@wgw/openapi-types/calendars-types";

export type CalendarReplyMailboxPhase = "loading" | "offline" | "error" | "ready";

export type CalendarReplyMailboxBusy = "save" | "check" | "disconnect" | null;

export type SettingsCalendarReplyMailboxController = {
  phase: CalendarReplyMailboxPhase;
  /** The connected mailbox as the server last returned it; null when none is connected. */
  mailbox: CalendarReplyMailbox | null;
  form: UseFormReturn<CalendarReplyMailboxFormValues>;
  busy: CalendarReplyMailboxBusy;
  /** Why the last save or check failed, shown next to the buttons. */
  failure: string | null;
  save: () => void;
  check: () => void;
  disconnect: () => void;
  retry: () => void;
};

function failureSentence(error: unknown): string {
  if (isFetchNetworkError(error)) return labels.offline;
  if (!isApiError(error)) return labels.failed;
  if (error.status === 429) return labels.tooMany;
  if (error.status === 400) return labels.invalid;
  return (error.code && labels.errors[error.code]) || labels.failed;
}

/**
 * The reply mailbox in Settings → Calendar (#1589). Not autosaved: saving logs in to the
 * mailbox, so the settings go to the server when the user presses Connect or Save, and a
 * failed login keeps the form as typed with the reason next to the buttons.
 */
export function useSettingsCalendarReplyMailbox(
  operations: CalendarReplyMailboxOperations = defaultCalendarReplyMailboxOperations(),
): SettingsCalendarReplyMailboxController {
  const { showSuccess } = useAppToast();
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const [phase, setPhase] = useState<CalendarReplyMailboxPhase>("loading");
  const [mailbox, setMailbox] = useState<CalendarReplyMailbox | null>(null);
  const [busy, setBusy] = useState<CalendarReplyMailboxBusy>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<CalendarReplyMailboxFormValues>({ defaultValues: replyMailboxToForm(null) });
  const requestRef = useRef(0);

  const apply = useCallback(
    (next: CalendarReplyMailbox | null) => {
      setMailbox(next);
      form.reset(replyMailboxToForm(next));
      setPhase("ready");
    },
    [form],
  );

  const load = useCallback(
    (quiet: boolean) =>
      loadServerSettings({
        quiet,
        requestRef,
        read: () => operationsRef.current.load(),
        isDirty: () => form.formState.isDirty,
        isOffline: isFetchNetworkError,
        setPhase,
        apply: (next) => apply(next.mailbox),
      }),
    [apply, form],
  );

  useEffect(() => {
    void load(false);
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  useOnReconnect(
    useCallback(() => {
      void load(phase === "ready");
    }, [load, phase]),
  );

  const run = useCallback(
    async (kind: Exclude<CalendarReplyMailboxBusy, null>, action: () => Promise<void>) => {
      setBusy(kind);
      setFailure(null);
      requestRef.current += 1;
      try {
        await action();
      } catch (error) {
        setFailure(failureSentence(error));
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const save = form.handleSubmit((values) => {
    const connected = mailbox !== null;
    const update = replyMailboxUpdateFromForm(values, connected);
    if (!update) {
      setFailure(labels.required);
      return;
    }
    return run("save", async () => {
      const next = await operationsRef.current.save(update);
      apply(next.mailbox);
      if (connected) showSuccess(labels.saved);
      // Only the connection test learns the receiving server; without it no reply is read yet.
      else showSuccess(next.mailbox?.trustedServer ? labels.connected : labels.connectedWaiting);
    });
  });

  const check = () =>
    void run("check", async () => {
      const next = await operationsRef.current.test();
      apply(next.mailbox);
      showSuccess(labels.checked);
    });

  const disconnect = () =>
    void run("disconnect", async () => {
      await operationsRef.current.disconnect();
      apply(null);
      showSuccess(labels.disconnected);
    });

  return {
    phase,
    mailbox,
    form,
    busy,
    failure,
    save: () => void save(),
    check,
    disconnect,
    retry: () => void load(false),
  };
}
