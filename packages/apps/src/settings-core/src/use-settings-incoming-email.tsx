import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { useOnReconnect } from "@/hooks/use-connectivity";
import { useAppToast } from "@/hooks/use-app-toast";
import { isApiError } from "@/lib/api/api-error";
import { isFetchNetworkError } from "@/lib/offline/core/browser-online";
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

export type IncomingEmailBusy = "save" | "check" | "disconnect" | null;

export type SettingsIncomingEmailController = {
  phase: ServerSettingsPhase;
  /** The connected mailbox as the server last returned it; null when none is connected. */
  mailbox: IncomingMailbox | null;
  form: UseFormReturn<IncomingEmailFormValues>;
  busy: IncomingEmailBusy;
  /** Why the last save or check failed, shown next to the buttons. */
  failure: string | null;
  save: () => void;
  check: () => void;
  disconnect: () => void;
  retry: () => void;
};

/** One sentence for a failed mailbox request; `errors` overrides the copy per error code. */
export function mailboxFailureSentence(
  error: unknown,
  errors: Record<string, string> = labels.errors,
): string {
  if (isFetchNetworkError(error)) return labels.offline;
  if (!isApiError(error)) return labels.failed;
  if (error.status === 429) return labels.tooMany;
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
 * Settings → Incoming email (#1589). Not autosaved: saving logs in to the mailbox, so the
 * connection goes to the server when the user presses Connect or Save, and a failed login keeps
 * the form as typed with the reason next to the buttons.
 */
export function useSettingsIncomingEmail(
  operations: IncomingMailboxOperations = defaultIncomingMailboxOperations(),
): SettingsIncomingEmailController {
  const { showSuccess } = useAppToast();
  const [mailbox, setMailbox] = useState<IncomingMailbox | null>(null);
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

  const run = async (kind: Exclude<IncomingEmailBusy, null>, action: () => Promise<void>) => {
    setBusy(kind);
    setFailure(null);
    requestRef.current += 1;
    try {
      await action();
    } catch (error) {
      setFailure(mailboxFailureSentence(error));
    } finally {
      setBusy(null);
    }
  };

  const save = form.handleSubmit((values) => {
    if (!/^\d*$/.test(values.port.trim())) {
      setFailure(labels.invalid);
      return;
    }
    const update = incomingEmailUpdateFromForm(values, mailbox);
    if (update && incomingEmailNeedsPasswordAgain(values, mailbox)) {
      setFailure(labels.passwordAgain);
      return;
    }
    if (!update) {
      setFailure(labels.required);
      return;
    }
    const connected = mailbox !== null;
    return run("save", async () => {
      const next = await operationsRef.current.save(update);
      applyReady(next.mailbox);
      if (connected) showSuccess(labels.saved);
      // Only the connection test learns the receiving server; without it nothing is read yet.
      else showSuccess(next.mailbox?.trustedServer ? labels.connected : labels.connectedWaiting);
    });
  });

  const check = () =>
    void run("check", async () => {
      const next = await operationsRef.current.test();
      applyReady(next.mailbox);
      showSuccess(labels.checked);
    });

  const disconnect = () =>
    void run("disconnect", async () => {
      await operationsRef.current.disconnect();
      applyReady(null);
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
    retry,
  };
}
