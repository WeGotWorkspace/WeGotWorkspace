import { useCallback, useEffect, useRef, useState } from "react";
import { useOnReconnect } from "@/hooks/use-connectivity";
import { useAppToast } from "@/hooks/use-app-toast";
import { isCompleteTotpCode } from "@/lib/api/wgw/auth-sign-in";
import type { TwoFactorOperations, TwoFactorState } from "@/lib/api/wgw/two-factor-settings";
import { isFetchNetworkError } from "@/lib/offline/core/browser-online";
import { countDiscardedUnsyncedChanges } from "@/lib/offline/core/offline-wipe";
import {
  loadServerSettings,
  type ServerSettingsPhase,
} from "@/settings-core/src/settings-server-load";
import { twoFactorSettingsLabels as labels } from "@/settings-core/src/settings-two-factor-labels";
import {
  defaultTwoFactorOperations,
  signOutAfterTwoFactorOn,
  twoFactorFailure,
  type TwoFactorDialog,
} from "@/settings-core/src/settings-two-factor-model";

export type SettingsTwoFactorOptions = {
  /** Stories and tests; the app uses the live REST resource (mock without an API). */
  operations?: TwoFactorOperations;
  countUnsyncedChanges?: () => Promise<number>;
  /** Runs when the recovery codes of a new setup are saved; signs out by default. */
  signOut?: () => Promise<void>;
};

export type SettingsTwoFactorController = {
  phase: ServerSettingsPhase;
  state: TwoFactorState;
  retry: () => void;
  dialog: TwoFactorDialog | null;
  busy: boolean;
  password: string;
  setPassword: (value: string) => void;
  passwordError: string;
  code: string;
  setCode: (value: string) => void;
  codeError: string;
  wrongCode: boolean;
  codesSaved: boolean;
  setCodesSaved: (saved: boolean) => void;
  openSetup: () => void;
  openDisable: () => void;
  openReplace: () => void;
  /** Closes any dialog except the recovery codes, which close only once they are saved. */
  close: () => void;
  submit: () => Promise<void>;
};

const OFF: TwoFactorState = { enabled: false, recoveryCodesRemaining: null };

/**
 * Settings → Security → Two-factor sign-in (#2275): the state from `GET /me`, then one dialog
 * at a time. Setup asks for the account password, shows the QR code and asks for a code, then
 * shows the recovery codes; once they are saved this browser signs out. Turning it off and
 * replacing the recovery codes each ask for a code.
 */
export function useSettingsTwoFactor(
  options: SettingsTwoFactorOptions = {},
): SettingsTwoFactorController {
  const [ops] = useState(() => options.operations ?? defaultTwoFactorOperations());
  const countUnsynced = options.countUnsyncedChanges ?? countDiscardedUnsyncedChanges;
  const signOut = options.signOut ?? signOutAfterTwoFactorOn;
  const { showSuccess, showError } = useAppToast();
  const [phase, setPhase] = useState<ServerSettingsPhase>("loading");
  const [state, setState] = useState<TwoFactorState>(OFF);
  const requestRef = useRef(0);
  const [dialog, setDialog] = useState<TwoFactorDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [password, setPasswordValue] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [code, setCodeValue] = useState("");
  const [codeError, setCodeError] = useState("");
  const [wrongCode, setWrongCode] = useState(false);
  const [codesSaved, setCodesSaved] = useState(false);

  const load = useCallback(
    (quiet: boolean) =>
      loadServerSettings({
        quiet,
        requestRef,
        read: () => ops.state(),
        isDirty: () => false,
        isOffline: isFetchNetworkError,
        setPhase,
        apply: (next) => {
          setState(next);
          setPhase("ready");
        },
      }),
    [ops],
  );
  useEffect(() => {
    void load(false);
  }, [load]);
  useOnReconnect(() => void load(phase === "ready"));

  const clearErrors = () => {
    setPasswordError("");
    setCodeError("");
    setWrongCode(false);
  };
  const open = (next: TwoFactorDialog) => {
    clearErrors();
    setPasswordValue("");
    setCodeValue("");
    setCodesSaved(false);
    setDialog(next);
  };

  const fail = (error: unknown, step: "password" | "code") => {
    const failure = twoFactorFailure(error, step);
    if (failure.field === "password") setPasswordError(failure.message);
    else if (failure.field === "code") setCodeError(failure.message);
    else showError(failure.message);
    setWrongCode(failure.wrongCode);
  };

  const run = async (work: () => Promise<void>, step: "password" | "code") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    clearErrors();
    try {
      await work();
    } catch (error) {
      fail(error, step);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const needsCode = (): boolean => {
    if (isCompleteTotpCode(code)) return true;
    setCodeError(labels.codeRequired);
    return false;
  };

  const submit = async () => {
    const current = dialog;
    if (!current) return;
    if (current.kind === "setup-password") {
      if (!password) {
        setPasswordError(labels.currentPasswordRequired);
        return;
      }
      await run(
        async () => setDialog({ kind: "setup-scan", setup: await ops.start(password) }),
        "password",
      );
    } else if (current.kind === "setup-scan") {
      if (!needsCode()) return;
      await run(async () => {
        const codes = await ops.confirm(password, code);
        setPasswordValue("");
        setCodesSaved(false);
        setState({ enabled: true, recoveryCodesRemaining: codes.length });
        setDialog({ kind: "codes", codes, signOut: true });
      }, "code");
    } else if (current.kind === "disable") {
      if (!needsCode()) return;
      await run(async () => {
        await ops.disable(code);
        setState(OFF);
        setDialog(null);
        showSuccess(labels.turnedOff);
      }, "code");
    } else if (current.kind === "replace") {
      if (!needsCode()) return;
      await run(async () => {
        const codes = await ops.replaceRecoveryCodes(code);
        setCodesSaved(false);
        setState({ enabled: true, recoveryCodesRemaining: codes.length });
        setDialog({ kind: "codes", codes, signOut: false });
      }, "code");
    } else if (codesSaved) {
      if (current.signOut) await run(signOut, "code");
      else {
        setDialog(null);
        showSuccess(labels.codesReplaced);
      }
    }
  };

  return {
    phase,
    state,
    retry: () => void load(false),
    dialog,
    busy,
    password,
    setPassword: (value) => {
      setPasswordValue(value);
      setPasswordError("");
    },
    passwordError,
    code,
    setCode: (value) => {
      setCodeValue(value);
      setCodeError("");
      setWrongCode(false);
    },
    codeError,
    wrongCode,
    codesSaved,
    setCodesSaved,
    openSetup: () => {
      open({ kind: "setup-password", unsynced: 0 });
      void countUnsynced().then(
        (count) => setDialog((d) => (d?.kind === "setup-password" ? { ...d, unsynced: count } : d)),
        () => setDialog((d) => (d?.kind === "setup-password" ? { ...d, unsynced: null } : d)),
      );
    },
    openDisable: () => open({ kind: "disable" }),
    openReplace: () => open({ kind: "replace" }),
    close: () => {
      if (dialog?.kind === "codes" || busyRef.current) return;
      setPasswordValue("");
      setDialog(null);
    },
    submit,
  };
}
