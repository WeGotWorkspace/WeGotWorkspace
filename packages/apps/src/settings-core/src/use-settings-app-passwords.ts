import { useCallback, useEffect, useRef, useState, type BaseSyntheticEvent } from "react";
import { useForm, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useOnReconnect } from "@/hooks/use-connectivity";
import { useAppToast } from "@/hooks/use-app-toast";
import { isApiError } from "@/lib/api/api-error";
import {
  createWorkspaceSource,
  mocksInBuild,
  mocksNotInBuild,
} from "@/lib/api/create-workspace-source";
import { createMockAppPasswordOperations } from "@/lib/api/mock/app-passwords";
import {
  APP_PASSWORD_LIMIT,
  APP_PASSWORD_NAME_MAX,
  AppPasswordThrottledError,
  createWgwAppPasswordOperations,
  type AppPassword,
  type AppPasswordOperations,
} from "@/lib/api/wgw/app-passwords";
import { isCompleteTotpCode, normalizeTotpCode } from "@/lib/api/wgw/auth-sign-in";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { isFetchNetworkError } from "@/lib/offline/core/browser-online";
import { appPasswordLabels as labels } from "@/settings-core/src/settings-app-passwords-labels";
import { twoFactorSettingsLabels } from "@/settings-core/src/settings-two-factor-labels";
import { twoFactorFailure } from "@/settings-core/src/settings-two-factor-model";
import {
  loadServerSettings,
  type ServerSettingsPhase,
} from "@/settings-core/src/settings-server-load";

/** Live REST with an API; an in-memory list otherwise. */
export function defaultAppPasswordOperations(): AppPasswordOperations {
  return createWorkspaceSource<AppPasswordOperations>({
    isLive: wgwLiveApiEnabled(),
    createLiveSource: createWgwAppPasswordOperations,
    createMockSource: mocksInBuild ? () => createMockAppPasswordOperations() : mocksNotInBuild,
  });
}

export const appPasswordFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, labels.nameRequired)
    .max(APP_PASSWORD_NAME_MAX, labels.nameTooLong(APP_PASSWORD_NAME_MAX)),
  /** Asked when two-factor is off. */
  currentPassword: z.string().min(1, labels.currentPasswordRequired),
  /** Not asked when two-factor is off. */
  code: z.string(),
});

/** With two-factor on (#2275): a current code instead of the account password. */
export const appPasswordCodeFormSchema = appPasswordFormSchema.extend({
  currentPassword: z.string(),
  code: z.string().refine(isCompleteTotpCode, twoFactorSettingsLabels.codeRequired),
});

export type AppPasswordFormValues = z.infer<typeof appPasswordFormSchema>;

/** What the remove confirm is about: one row, or every row. */
export type AppPasswordRemoval = { kind: "one"; row: AppPassword } | { kind: "all" };

/** The inline message under the account password for a failed create; null when it is not one. */
export function appPasswordCreateFieldError(error: unknown, now = Date.now()): string | null {
  if (error instanceof AppPasswordThrottledError && error.retryAfterSeconds !== null) {
    return labels.throttled(formatTime(now + error.retryAfterSeconds * 1000));
  }
  if (isApiError(error) && error.status === 429) return labels.throttled(null);
  if (isApiError(error) && error.status === 403) return labels.wrongPassword;
  return null;
}

function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(ms);
}

export type SettingsAppPasswordsController = {
  phase: ServerSettingsPhase;
  rows: AppPassword[];
  retry: () => void;
  form: UseFormReturn<AppPasswordFormValues>;
  createOpen: boolean;
  openCreate: () => void;
  /** Closes the dialog and forgets the plaintext. */
  closeCreate: () => void;
  submitCreate: (event?: BaseSyntheticEvent) => Promise<void>;
  /** Two-factor is on: the dialog asks for a code instead of the account password. */
  asksCode: boolean;
  /** The last code was wrong: the field adds the phone-clock hint. */
  wrongCode: boolean;
  /** The new plaintext while the dialog shows it; null otherwise. */
  created: string | null;
  removal: AppPasswordRemoval | null;
  askRemove: (removal: AppPasswordRemoval | null) => void;
  confirmRemove: () => Promise<void>;
  removing: boolean;
};

const EMPTY_FORM: AppPasswordFormValues = { name: "", currentPassword: "", code: "" };

/**
 * Settings → Security → App passwords: the list, read fresh when the pane opens and when the
 * connection returns; the create dialog (name + account password, then the plaintext once);
 * removing one or all after a confirm.
 */
export function useSettingsAppPasswords(
  operations?: AppPasswordOperations,
  /** With two-factor on, creating one asks for a current code, like replacing recovery codes. */
  twoFactorOn = false,
): SettingsAppPasswordsController {
  // Fixed for the pane's life: a new list source would need a new pane.
  const [ops] = useState(() => operations ?? defaultAppPasswordOperations());
  const twoFactorRef = useRef(twoFactorOn);
  twoFactorRef.current = twoFactorOn;
  const { showSuccess, showError } = useAppToast();
  const [phase, setPhase] = useState<ServerSettingsPhase>("loading");
  const [rows, setRows] = useState<AppPassword[]>([]);
  const requestRef = useRef(0);
  const form = useForm<AppPasswordFormValues>({
    // Read per submit: two-factor can be turned on or off while the pane is open.
    resolver: (values, context, options) =>
      zodResolver(twoFactorRef.current ? appPasswordCodeFormSchema : appPasswordFormSchema)(
        values,
        context,
        options,
      ),
    defaultValues: EMPTY_FORM,
  });
  const [createOpen, setCreateOpen] = useState(false);
  const [wrongCode, setWrongCode] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [removal, setRemoval] = useState<AppPasswordRemoval | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(
    (quiet: boolean) =>
      loadServerSettings({
        quiet,
        requestRef,
        read: () => ops.list(),
        isDirty: () => false,
        isOffline: isFetchNetworkError,
        setPhase,
        apply: (next) => {
          setRows(next);
          setPhase("ready");
        },
      }),
    [],
  );

  useEffect(() => {
    void load(false);
  }, [load]);
  useOnReconnect(() => void load(phase === "ready"));

  const openCreate = () => {
    form.reset(EMPTY_FORM);
    setWrongCode(false);
    setCreated(null);
    setCreateOpen(true);
  };

  const closeCreate = () => {
    setCreateOpen(false);
    setWrongCode(false);
    setCreated(null);
    form.reset(EMPTY_FORM);
  };

  const submitCreate = form.handleSubmit(async (values) => {
    const name = values.name.trim();
    try {
      const result = await ops.create(
        twoFactorOn
          ? { name, code: normalizeTotpCode(values.code) }
          : { name, currentPassword: values.currentPassword },
      );
      setRows((current) => [
        result.appPassword,
        ...current.filter((row) => row.id !== result.appPassword.id),
      ]);
      // Neither the name nor the password or code is needed any more.
      form.reset(EMPTY_FORM);
      setWrongCode(false);
      setCreated(result.password);
    } catch (error) {
      if (isApiError(error) && error.code === "app_password_limit") {
        showError(labels.limitReached(APP_PASSWORD_LIMIT));
        return;
      }
      if (twoFactorOn) {
        // Same errors as replacing recovery codes: a wrong code is 403 `mfa_code_invalid`.
        const failure = twoFactorFailure(error, "code");
        if (failure.field) {
          setWrongCode(failure.wrongCode);
          form.setError("code", { message: failure.message });
        } else showError(failure.message);
        return;
      }
      const fieldError = appPasswordCreateFieldError(error);
      if (fieldError) {
        form.setError("currentPassword", { message: fieldError });
        return;
      }
      showError(isFetchNetworkError(error) ? labels.offlineAction : labels.createFailed);
    }
  });

  const confirmRemove = async () => {
    if (!removal) return;
    setRemoving(true);
    try {
      if (removal.kind === "all") {
        await ops.revokeAll();
        setRows([]);
        showSuccess(labels.removedAll);
      } else {
        await ops.revoke(removal.row.id);
        setRows((current) => current.filter((row) => row.id !== removal.row.id));
        showSuccess(labels.removed);
      }
      setRemoval(null);
    } catch (error) {
      showError(isFetchNetworkError(error) ? labels.offlineAction : labels.removeFailed);
    } finally {
      setRemoving(false);
    }
  };

  return {
    phase,
    rows,
    retry: () => void load(false),
    form,
    createOpen,
    openCreate,
    closeCreate,
    submitCreate,
    asksCode: twoFactorOn,
    wrongCode,
    created,
    removal,
    askRemove: setRemoval,
    confirmRemove,
    removing,
  };
}
