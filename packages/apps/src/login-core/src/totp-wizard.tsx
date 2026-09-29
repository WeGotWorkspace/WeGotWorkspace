import { useEffect, useState } from "react";
import { Button } from "@/button/src/button";
import type { TotpWizardSource } from "@/lib/api/wgw/mfa-client";
import { MfaRequestError } from "@/lib/api/wgw/mfa-client";
import { AuthenticationPage } from "@/login-core/src/authentication-page";
import { applyTotpPaste, digitsOnly, groupTotpSecret } from "@/login-core/src/totp-format";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";

type TotpWizardProps = {
  source: TotpWizardSource;
  onFinished: () => void;
  onLogout: () => void;
};

type WizardStep = "password" | "setup" | "codes";

export function TotpWizard({ source, onFinished, onLogout }: TotpWizardProps) {
  const carriedPassword = source.knownPassword?.trim() ?? "";
  const asksForPassword = source.mode === "enroll" && carriedPassword === "";
  const [step, setStep] = useState<WizardStep>(asksForPassword ? "password" : "setup");
  const [accountPassword, setAccountPassword] = useState(carriedPassword);
  const [secret, setSecret] = useState("");
  const [otpauthUri, setOtpauthUri] = useState("");
  const [davWarning, setDavWarning] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedCodes, setSavedCodes] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (source.mode === "enroll" && carriedPassword === "") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void source
      .start(carriedPassword || undefined)
      .then((provision) => {
        if (cancelled) return;
        if (carriedPassword) setAccountPassword(carriedPassword);
        setSecret(provision.secret);
        setOtpauthUri(provision.otpauthUri);
        setDavWarning(provision.davWarning);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Could not start setup.");
        if (carriedPassword) setStep("password");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [source, carriedPassword]);

  const beginWithPassword = async (password: string) => {
    if (submitting || password.trim() === "") return;
    setSubmitting(true);
    setError("");
    try {
      const provision = await source.start(password);
      setAccountPassword(password);
      setSecret(provision.secret);
      setOtpauthUri(provision.otpauthUri);
      setDavWarning(provision.davWarning);
      setStep("setup");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That password was not accepted.");
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!otpauthUri) return;
    let cancelled = false;
    void import("qrcode")
      .then((qr) => qr.toDataURL(otpauthUri, { margin: 1, width: 196 }))
      .then((url) => {
        if (!cancelled) setQrUrl(url);
      })
      .catch(() => {
        // The otpauth link remains when QR drawing is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUri]);

  const title =
    source.mode === "replace" ? "Set up a new authenticator" : "Set up two-factor authentication";

  const confirm = async (nextCode: string) => {
    if (submitting || nextCode.length !== 6) return;
    setSubmitting(true);
    setError("");
    try {
      const confirmed = await source.confirm(nextCode, accountPassword || undefined);
      setRecoveryCodes(confirmed.recoveryCodes);
      setStep("codes");
    } catch (cause) {
      setError(cause instanceof MfaRequestError ? cause.message : "That code was not accepted.");
    } finally {
      setSubmitting(false);
    }
  };

  const body =
    step === "codes" ? (
      <RecoveryCodesStep
        codes={recoveryCodes}
        saved={savedCodes}
        davWarning={davWarning}
        onSavedChange={setSavedCodes}
        onContinue={onFinished}
      />
    ) : step === "password" ? (
      <PasswordStep
        username={source.username}
        error={error}
        submitting={submitting}
        onSubmit={(password) => void beginWithPassword(password)}
      />
    ) : (
      <SetupStep
        username={source.username}
        loading={loading}
        secret={secret}
        otpauthUri={otpauthUri}
        qrUrl={qrUrl}
        davWarning={davWarning}
        code={code}
        error={error}
        submitting={submitting}
        onCodeChange={(next) => {
          setCode(next);
          if (next.length === 6) void confirm(next);
        }}
        onSubmit={() => void confirm(code)}
      />
    );

  if (source.presentation === "session" && !source.forced) {
    return (
      <div className="totp-wizard">
        <h2 className="text-lg font-medium">{title}</h2>
        {body}
      </div>
    );
  }

  return (
    <AuthenticationPage title={title}>
      {body}
      <p className="login-screen__hint">
        <button type="button" className="login-screen__text-button" onClick={onLogout}>
          Log out
        </button>
      </p>
    </AuthenticationPage>
  );
}

function PasswordStep({
  username,
  error,
  submitting,
  onSubmit,
}: {
  username: string;
  error: string;
  submitting: boolean;
  onSubmit: (password: string) => void;
}) {
  const [password, setPassword] = useState("");
  return (
    <form
      className="login-screen__form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(password);
      }}
    >
      <input type="text" name="username" autoComplete="username" hidden readOnly value={username} />
      {error ? (
        <p className="login-screen__error" role="alert">
          {error}
        </p>
      ) : null}
      <p className="login-screen__hint">Enter your account password to start setup.</p>
      <FieldLabelRow htmlFor="setup-password" label="Password">
        <Input
          id="setup-password"
          name="password"
          variant="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          autoFocus
          required
          disabled={submitting}
        />
      </FieldLabelRow>
      <div className="login-screen__actions">
        <Button
          type="submit"
          label={submitting ? "Checking..." : "Continue"}
          variant="primary"
          size="xl"
          pill
          disabled={submitting || password === ""}
          className="login-screen__submit"
        />
      </div>
    </form>
  );
}

function SetupStep({
  username,
  loading,
  secret,
  otpauthUri,
  qrUrl,
  davWarning,
  code,
  error,
  submitting,
  onCodeChange,
  onSubmit,
}: {
  username: string;
  loading: boolean;
  secret: string;
  otpauthUri: string;
  qrUrl: string;
  davWarning: boolean;
  code: string;
  error: string;
  submitting: boolean;
  onCodeChange: (code: string) => void;
  onSubmit: () => void;
}) {
  if (loading) return <p>Preparing your authenticator…</p>;
  return (
    <form
      className="login-screen__form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input type="text" name="username" autoComplete="username" hidden readOnly value={username} />
      {error ? (
        <p className="login-screen__error" role="alert">
          {error}
        </p>
      ) : null}
      {qrUrl ? (
        <img className="totp-wizard__qr" src={qrUrl} alt="QR code for the authenticator app" />
      ) : null}
      {otpauthUri ? (
        <p className="login-screen__hint">
          <a href={otpauthUri}>Open in your authenticator app</a>
        </p>
      ) : null}
      <p className="login-screen__hint">Can&apos;t scan?</p>
      <p className="totp-wizard__secret">{groupTotpSecret(secret)}</p>
      <button
        type="button"
        className="login-screen__text-button"
        onClick={() => void navigator.clipboard?.writeText(secret.replace(/\s+/g, ""))}
      >
        Copy secret
      </button>
      {davWarning ? <DavWarning /> : null}
      <FieldLabelRow htmlFor="setup-otp" label="Code from the app">
        <Input
          id="setup-otp"
          name="otp"
          type="text"
          value={code}
          onChange={(event) => onCodeChange(digitsOnly(event.target.value))}
          onPaste={(event) => applyTotpPaste(event, onCodeChange)}
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          autoFocus
          disabled={submitting}
          required
        />
      </FieldLabelRow>
      <div className="login-screen__actions">
        <Button
          type="submit"
          label={submitting ? "Checking..." : "Confirm"}
          variant="primary"
          size="xl"
          pill
          disabled={submitting || code.length !== 6}
          className="login-screen__submit"
        />
      </div>
    </form>
  );
}

function RecoveryCodesStep({
  codes,
  saved,
  davWarning,
  onSavedChange,
  onContinue,
}: {
  codes: string[];
  saved: boolean;
  davWarning: boolean;
  onSavedChange: (saved: boolean) => void;
  onContinue: () => void;
}) {
  const text = codes.join("\n");
  return (
    <div className="login-screen__form">
      <p>Save these recovery codes. Each code works once. They will not be shown again.</p>
      <ul className="totp-wizard__codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <p className="login-screen__hint">
        <button
          type="button"
          className="login-screen__text-button"
          onClick={() => void navigator.clipboard?.writeText(text)}
        >
          Copy
        </button>{" "}
        <button
          type="button"
          className="login-screen__text-button"
          onClick={() => downloadCodes(text)}
        >
          Download
        </button>{" "}
        <button type="button" className="login-screen__text-button" onClick={() => window.print()}>
          Print
        </button>
      </p>
      {davWarning ? <DavWarning /> : null}
      <label className="totp-wizard__saved">
        <input
          type="checkbox"
          checked={saved}
          onChange={(event) => onSavedChange(event.target.checked)}
        />{" "}
        I have saved these codes
      </label>
      <div className="login-screen__actions">
        <Button
          type="button"
          label="Continue"
          variant="primary"
          size="xl"
          pill
          disabled={!saved}
          className="login-screen__submit"
          onClick={onContinue}
        />
      </div>
    </div>
  );
}

function DavWarning() {
  return (
    <p className="login-screen__error" role="status">
      Calendar and contact apps that sign in with your account password will stop working. Create an
      app password in <a href="/settings/security">Settings → Security</a>.
    </p>
  );
}

function downloadCodes(text: string): void {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "wegotworkspace-recovery-codes.txt";
  link.click();
  URL.revokeObjectURL(url);
}
