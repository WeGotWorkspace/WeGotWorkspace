import { useState, type FormEvent } from "react";
import { Button } from "@/button/src/button";
import { FieldLabelRow } from "@/ui/field-label-row";
import { applyTotpPaste, digitsOnly } from "@/login-core/src/totp-format";
import { Input } from "@/ui/input";

type TotpCodeFormProps = {
  username: string;
  submitting?: boolean;
  error?: string;
  onSubmit: (code: string) => void;
  onUseRecovery?: () => void;
};

/** One authenticator field so password managers can fill `one-time-code`. */
export function TotpCodeForm({
  username,
  submitting = false,
  error = "",
  onSubmit,
  onUseRecovery,
}: TotpCodeFormProps) {
  const [code, setCode] = useState("");

  const submitCode = (next: string) => {
    if (submitting || next.length !== 6) return;
    onSubmit(next);
  };

  const onFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitCode(code);
  };

  return (
    <form className="login-screen__form" onSubmit={onFormSubmit}>
      <input type="text" name="username" autoComplete="username" hidden readOnly value={username} />
      {error ? (
        <p className="login-screen__error" role="alert">
          {error}
        </p>
      ) : null}
      <FieldLabelRow htmlFor="otp" label="Authentication code">
        <Input
          id="otp"
          name="otp"
          type="text"
          value={code}
          onChange={(event) => {
            const next = digitsOnly(event.target.value);
            setCode(next);
            if (next.length === 6) submitCode(next);
          }}
          onPaste={(event) => {
            applyTotpPaste(event, (next) => {
              setCode(next);
              if (next.length === 6) submitCode(next);
            });
          }}
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          autoFocus
          disabled={submitting}
          required
        />
      </FieldLabelRow>
      <p className="login-screen__hint">Lost access? Ask your admin.</p>
      <div className="login-screen__actions">
        <Button
          type="submit"
          label={submitting ? "Checking..." : "Continue"}
          variant="primary"
          size="xl"
          pill
          disabled={submitting || code.length !== 6}
          className="login-screen__submit"
        />
      </div>
      {onUseRecovery ? (
        <p className="login-screen__hint">
          <button type="button" className="login-screen__text-button" onClick={onUseRecovery}>
            Use a recovery code
          </button>
        </p>
      ) : null}
    </form>
  );
}

type RecoveryCodeFormProps = {
  username: string;
  submitting?: boolean;
  error?: string;
  onSubmit: (code: string) => void;
  onUseAuthenticator?: () => void;
};

export function RecoveryCodeForm({
  username,
  submitting = false,
  error = "",
  onSubmit,
  onUseAuthenticator,
}: RecoveryCodeFormProps) {
  const [code, setCode] = useState("");

  return (
    <form
      className="login-screen__form"
      onSubmit={(event) => {
        event.preventDefault();
        const next = code.trim();
        if (!submitting && next) onSubmit(next);
      }}
    >
      <input type="text" name="username" autoComplete="username" hidden readOnly value={username} />
      {error ? (
        <p className="login-screen__error" role="alert">
          {error}
        </p>
      ) : null}
      <FieldLabelRow htmlFor="recovery-code" label="Recovery code">
        <Input
          id="recovery-code"
          name="recovery"
          type="text"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="off"
          autoFocus
          disabled={submitting}
          required
        />
      </FieldLabelRow>
      <p className="login-screen__hint">Lost access? Ask your admin.</p>
      <div className="login-screen__actions">
        <Button
          type="submit"
          label={submitting ? "Checking..." : "Continue"}
          variant="primary"
          size="xl"
          pill
          disabled={submitting || code.trim() === ""}
          className="login-screen__submit"
        />
      </div>
      {onUseAuthenticator ? (
        <p className="login-screen__hint">
          <button type="button" className="login-screen__text-button" onClick={onUseAuthenticator}>
            Use an authenticator code
          </button>
        </p>
      ) : null}
    </form>
  );
}
