import { useRef, useState } from "react";
import {
  isCompleteTotpCode,
  SignInError,
  type AuthenticatorSecret,
  type SignInOperations,
  type SignInStep,
} from "@/lib/api/wgw/auth-sign-in";
import { isFetchNetworkError } from "@/lib/offline/core/browser-online";
import { loginLabels as labels } from "@/login-core/src/login-labels";

/** Where the login screen is: the password, the code, a new authenticator, its recovery codes. */
export type LoginStep =
  | { kind: "password" }
  | { kind: "code"; challenge: string; recovery: boolean }
  | { kind: "replace"; challenge: string; secret: AuthenticatorSecret | null }
  | { kind: "codes"; codes: string[]; done: SignInStep };

function formatTime(ms: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(ms);
}

/** The sentence for a failed step, from the error's reason, never its message. */
export function loginFailureMessage(error: unknown, now = Date.now()): string {
  if (isFetchNetworkError(error)) return labels.offline;
  if (!(error instanceof SignInError)) return labels.failed;
  switch (error.reason) {
    case "credentials":
      return labels.invalid;
    case "invalid_code":
      return labels.wrongCode;
    case "expired":
      return labels.expired;
    case "throttled": {
      const at = error.retryAfterSeconds ? formatTime(now + error.retryAfterSeconds * 1000) : null;
      if (error.code === "mfa_locked") return labels.codesPaused(at);
      return labels.throttled(at);
    }
    default:
      return labels.failed;
  }
}

/** After this failure the password has to be typed again: the challenge is gone. */
function needsPasswordAgain(error: unknown): boolean {
  return (
    error instanceof SignInError && (error.reason === "expired" || error.reason === "credentials")
  );
}

export type LoginSignIn = {
  step: LoginStep;
  error: string;
  /** A wrong code: the field is marked and the phone-clock hint shows. */
  wrongCode: boolean;
  busy: boolean;
  submitPassword: (username: string, password: string) => Promise<void>;
  submitCode: (value: string) => Promise<void>;
  setRecovery: (recovery: boolean) => void;
  confirmReplacement: (code: string) => Promise<void>;
  finishCodes: () => void;
  startOver: () => void;
};

/**
 * The login screen's steps (#2274): the password, then for a user with two-factor on a code
 * or a recovery code, and after a recovery code a new authenticator and its recovery codes.
 * `onSignedIn` runs once, with the final `ok` step (the assistant's redirect, if any).
 */
export function useLoginSignIn(
  operations: SignInOperations,
  onSignedIn: (step: SignInStep) => void | Promise<void>,
): LoginSignIn {
  const [step, setStep] = useState<LoginStep>({ kind: "password" });
  const [error, setError] = useState("");
  const [wrongCode, setWrongCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const run = async (work: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setWrongCode(false);
    try {
      await work();
    } catch (cause) {
      setError(loginFailureMessage(cause));
      if (cause instanceof SignInError && cause.reason === "invalid_code") setWrongCode(true);
      if (needsPasswordAgain(cause)) setStep({ kind: "password" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const advance = async (next: SignInStep) => {
    if (next.status === "ok") {
      await onSignedIn(next);
      return;
    }
    if (next.status === "mfa_required") {
      setStep({ kind: "code", challenge: next.challenge, recovery: false });
      return;
    }
    setStep({ kind: "replace", challenge: next.challenge, secret: null });
    const secret = await operations.startReplacement(next.challenge);
    setStep({ kind: "replace", challenge: next.challenge, secret });
  };

  return {
    step,
    error,
    wrongCode,
    busy,
    submitPassword: (username, password) =>
      run(async () => {
        const normalized = username.trim();
        if (!normalized || !password) {
          setError(labels.required);
          return;
        }
        await advance(await operations.signIn(normalized, password));
      }),
    submitCode: (value) =>
      run(async () => {
        if (step.kind !== "code") return;
        if (step.recovery ? !value.trim() : !isCompleteTotpCode(value)) {
          setError(step.recovery ? labels.recoveryRequired : labels.codeRequired);
          return;
        }
        const proof = step.recovery ? { recoveryCode: value } : { code: value };
        await advance(await operations.verify(step.challenge, proof));
      }),
    setRecovery: (recovery) => {
      setError("");
      setWrongCode(false);
      setStep((current) => (current.kind === "code" ? { ...current, recovery } : current));
    },
    confirmReplacement: (code) =>
      run(async () => {
        if (step.kind !== "replace") return;
        if (!isCompleteTotpCode(code)) {
          setError(labels.codeRequired);
          return;
        }
        const result = await operations.confirmReplacement(step.challenge, code);
        if (result.step.status !== "ok") throw new Error("replacement did not sign in");
        if (result.recoveryCodes.length === 0) {
          await onSignedIn(result.step);
          return;
        }
        setStep({ kind: "codes", codes: result.recoveryCodes, done: result.step });
      }),
    finishCodes: () => {
      if (step.kind === "codes") void run(async () => onSignedIn(step.done));
    },
    startOver: () => {
      setError("");
      setWrongCode(false);
      setStep({ kind: "password" });
    },
  };
}
