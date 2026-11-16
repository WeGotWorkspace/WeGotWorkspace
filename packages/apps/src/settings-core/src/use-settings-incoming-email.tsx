import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { useOnReconnect } from "@/hooks/use-connectivity";
import { useAppToast } from "@/hooks/use-app-toast";
import { isApiError } from "@/lib/api/api-error";
import { isFetchNetworkError } from "@/lib/offline/browser-online";
import { MailboxLoginsLimitedError } from "@/lib/api/wgw/calendar-reply-mailbox";
import { incomingEmailLabels as labels } from "@/settings-core/src/settings-incoming-email-labels";
import {
  defaultIncomingMailboxOperations,
  incomingEmailNeedsPasswordAgain,
  incomingEmailToForm,
  incomingEmailUpdateFromForm,
  type IncomingEmailFormValues,
  type IncomingMailbox,
  type IncomingMailboxOperations,
} from "@/settings-core/src/settings-incoming-email-source";
import {
  loadServerSettings,
  type ServerSettingsPhase,
} from "@/settings-core/src/settings-server-load";

export type IncomingEmailBusy = "connect" | "save" | "test" | "disconnect" | null;

export type SettingsIncomingEmailController = {
  phase: ServerSettingsPhase;
  /** The connected mailbox as the server last returned it; null when none is connected. */
  mailbox: IncomingMailbox | null;
  form: UseFormReturn<IncomingEmailFormValues>;
  busy: IncomingEmailBusy;
  /** Why the last connect, save or check failed. */
  failure: string | null;
  /** First connect: logs in with the form as typed. */
  connect: () => void;
  /** Test connection: saves unsaved edits with a login, or logs in again to check the saved ones. */
  check: () => void;
  /** A new password for the connected mailbox; resolves to why it failed, or null. */
  changePassword: (password: string) => Promise<string | null>;
  disconnect: () => Promise<void>;
  retry: () => void;
};

/** One sentence for a failed mailbox request; `errors` overrides the copy per error code. */
export function mailboxFailureSentence(
  error: unknown,
  errors: Record<string, string> = labels.errors,
): string {
  if (isFetchNetworkError(error)) return labels.offline;
  if (error instanceof MailboxLoginsLimitedError) {
    return labels.loginsLimited(formatTime(Date.now() + error.retryAfterSeconds * 1000));
  }
  if (!isApiError(error)) return labels.failed;
  if (error.status === 429) return labels.loginsLimited(formatTime(Date.now() + 60_000));
  if (error.status === 400) return labels.invalid;
  return (error.code && (errors[error.code] ?? labels.errors[error.code])) || labels.failed;
}

/** The server's mailbox, read fresh when a pane opens and again when the connection returns. */
export function useIncomingMailboxLoad(
  operations: IncomingMailboxOperations,
  apply: (mailbox: IncomingMailbox | null) => void,
  isDirty: () => boolean,
) {
  const operationsRef = useRef(operations);
  operationsRef.current = operations;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const [phase, setPhase] = useState<ServerSettingsPhase>("loading");
  const requestRef = useRef(0);

  const load = useCallback(
    (quiet: boolean) =>
      loadServerSettings({
        quiet,
        requestRef,
        read: () => operationsRef.current.load(),
        isDirty: () => isDirtyRef.current(),
        isOffline: isFetchNetworkError,
        setPhase,
        apply: (next) => {
          applyRef.current(next.mailbox);
          setPhase("ready");
        },
      }),
    [],
  );

  useEffect(() => {
    void load(false);
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useOnReconnect(
    useCallback(() => {
      void load(phaseRef.current === "ready");
    }, [load]),
  );

  return { phase, setPhase, requestRef, operationsRef, retry: () => void load(false) };
}

/**
 * Settings → Incoming email (#1589). Connect logs in with what was typed; a failed login keeps
 * the form as typed with the reason. A connected mailbox saves itself: each save logs in again,
 * so an edit is checked as the user goes. The password changes in its own dialog. Opening the
 * pane checks a mailbox that is not being read, so it can resume or learn its mail server.
 */
export function useSettingsIncomingEmail(
  operations: IncomingMailboxOperations = defaultIncomingMailboxOperations(),
): SettingsIncomingEmailController {
  const { showSuccess } = useAppToast();
  const [mailbox, setMailbox] = useState<IncomingMailbox | null>(null);
  const mailboxRef = useRef<IncomingMailbox | null>(null);
  mailboxRef.current = mailbox;
  const [busy, setBusy] = useState<IncomingEmailBusy>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<IncomingEmailFormValues>({ defaultValues: incomingEmailToForm(null) });

  const apply = useCallback(
    (next: IncomingMailbox | null) => {
      setMailbox(next);
      form.reset(incomingEmailToForm(next));
    },
    [form],
  );
  const { phase, setPhase, requestRef, operationsRef, retry } = useIncomingMailboxLoad(
    operations,
    apply,
    () => form.formState.isDirty,
  );
  const applyReady = (next: IncomingMailbox | null) => {
    apply(next);
    setPhase("ready");
  };

  /** Runs one request; the failure sentence is set, and also returned for a dialog. */
  const run = async (
    kind: Exclude<IncomingEmailBusy, null>,
    action: () => Promise<void>,
  ): Promise<string | null> => {
    setBusy(kind);
    setFailure(null);
    requestRef.current += 1;
    try {
      await action();
      return null;
    } catch (error) {
      const sentence = mailboxFailureSentence(error);
      setFailure(sentence);
      return sentence;
    } finally {
      setBusy(null);
    }
  };

  const connect = () => {
    const update = incomingEmailUpdateFromForm(form.getValues(), null);
    if (!update) {
      setFailure(labels.required);
      return;
    }
    void run("connect", async () => {
      const next = await operationsRef.current.save(update);
      applyReady(next.mailbox);
      showSuccess(labels.connected);
    });
  };

  // Each check is one login, and the server allows only a few in a row: nothing checks by
  // itself, only this button.
  const check = () => {
    const saved = mailboxRef.current;
    if (!saved) return;
    const values = form.getValues();
    // Read from the values, not formState: that only updates where a component subscribes.
    if (sameFormValues(values, incomingEmailToForm(saved))) {
      void run("test", async () => {
        const next = await operationsRef.current.test();
        applyReady(next.mailbox);
        showSuccess(labels.checked);
      });
      return;
    }
    if (incomingEmailNeedsPasswordAgain(values, saved)) {
      setFailure(labels.passwordAgain);
      return;
    }
    const update = incomingEmailUpdateFromForm(values, saved);
    if (!update) {
      setFailure(labels.requiredConnected);
      return;
    }
    void run("save", async () => {
      const next = await operationsRef.current.save(update);
      applyReady(next.mailbox);
      showSuccess(labels.saved);
    });
  };

  const changePassword = async (password: string) => {
    const saved = mailboxRef.current;
    if (!saved) return labels.failed;
    // The rows as they stand go along: a new mail server is saved with its password.
    const update = incomingEmailUpdateFromForm({ ...form.getValues(), password }, saved);
    if (!update) return labels.requiredConnected;
    const failed = await run("save", async () => {
      const next = await operationsRef.current.save(update);
      applyReady(next.mailbox);
      showSuccess(labels.passwordChanged);
    });
    // The dialog shows its own failure; the row keeps none.
    if (failed) setFailure(null);
    return failed;
  };

  const disconnect = async () => {
    await run("disconnect", async () => {
      await operationsRef.current.disconnect();
      applyReady(null);
      showSuccess(labels.disconnected);
    });
  };

  return { phase, mailbox, form, busy, failure, connect, check, changePassword, disconnect, retry };
}

function sameFormValues(a: IncomingEmailFormValues, b: IncomingEmailFormValues): boolean {
  return (
    a.host === b.host &&
    a.security === b.security &&
    a.port === b.port &&
    a.username === b.username &&
    a.password === b.password
  );
}

/** "14:32", in the user's own clock. */
function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(ms);
}
