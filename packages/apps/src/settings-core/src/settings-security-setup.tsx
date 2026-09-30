import { useEffect, useId, useState } from "react";
import { Button } from "@/button/src/button";
import { Card } from "@/card/src/card";
import type { TotpWizardSource } from "@/lib/api/wgw/mfa-client";
import { MfaRequestError } from "@/lib/api/wgw/mfa-client";
import { applyTotpPaste, digitsOnly, groupTotpSecret } from "@/login-core/src/totp-format";
import { Checkbox } from "@/ui/checkbox";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";

type SettingsSecuritySetupProps = {
  source: TotpWizardSource;
  onCancel: () => void;
  onFinished: (recoveryCodeCount: number) => void;
};

type SetupStep = "password" | "qr" | "codes";

export function SettingsSecuritySetup({
  source,
  onCancel,
  onFinished,
}: SettingsSecuritySetupProps) {
  const [step, setStep] = useState<SetupStep>("password");
  const [accountPassword, setAccountPassword] = useState("");
  const [secret, setSecret] = useState("");
  const [otpauthUri, setOtpauthUri] = useState("");
  const [davWarning, setDavWarning] = useState(false);
  const [qrUrl, setQrUrl] = useState("");
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [savedCodes, setSavedCodes] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!otpauthUri) return;
    let cancelled = false;
    void import("qrcode")
      .then((qr) => qr.toDataURL(otpauthUri, { margin: 1, width: 196 }))
      .then((url) => {
        if (!cancelled) setQrUrl(url);
      })
      .catch(() => {
        // The secret stays on screen when QR drawing is unavailable.
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUri]);

  const begin = async (password: string) => {
    if (submitting || password === "") return;
    setSubmitting(true);
    setError("");
    try {
      const provision = await source.start(password);
      setAccountPassword(password);
      setSecret(provision.secret);
      setOtpauthUri(provision.otpauthUri);
      setDavWarning(provision.davWarning);
      setStep("qr");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That password was not accepted.");
    } finally {
      setSubmitting(false);
    }
  };

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

  const description =
    step === "password"
      ? "Step 1 of 3. Enter your account password."
      : step === "qr"
        ? "Step 2 of 3. Scan the QR code, or enter the secret in your authenticator app."
        : "Step 3 of 3. Save these recovery codes. Each code works once.";

  return (
    <Card title="Set up two-factor authentication" description={description}>
      {error ? (
        <p className="settings-security-pane__alert" role="alert">
          {error}
        </p>
      ) : null}
      {step === "password" ? (
        <PasswordStep
          username={source.username}
          submitting={submitting}
          onCancel={onCancel}
          onSubmit={(password) => void begin(password)}
        />
      ) : null}
      {step === "qr" ? (
        <QrStep
          username={source.username}
          secret={secret}
          otpauthUri={otpauthUri}
          qrUrl={qrUrl}
          davWarning={davWarning}
          code={code}
          submitting={submitting}
          onCodeChange={setCode}
          onCancel={onCancel}
          onSubmit={() => void confirm(code)}
        />
      ) : null}
      {step === "codes" ? (
        <CodesStep
          codes={recoveryCodes}
          saved={savedCodes}
          davWarning={davWarning}
          onSavedChange={setSavedCodes}
          onDone={() => onFinished(recoveryCodes.length)}
        />
      ) : null}
    </Card>
  );
}

function PasswordStep({
  username,
  submitting,
  onCancel,
  onSubmit,
}: {
  username: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (password: string) => void;
}) {
  const id = useId();
  const [password, setPassword] = useState("");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(password);
      }}
    >
      <input type="text" name="username" autoComplete="username" hidden readOnly value={username} />
      <FieldLabelRow htmlFor={id} label="Password">
        <Input
          id={id}
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
      <div className="settings-security-pane__actions">
        <Button type="button" variant="outline" label="Cancel" onClick={onCancel} />
        <Button
          type="submit"
          label={submitting ? "Checking..." : "Continue"}
          disabled={submitting || password === ""}
        />
      </div>
    </form>
  );
}

function QrStep({
  username,
  secret,
  otpauthUri,
  qrUrl,
  davWarning,
  code,
  submitting,
  onCodeChange,
  onCancel,
  onSubmit,
}: {
  username: string;
  secret: string;
  otpauthUri: string;
  qrUrl: string;
  davWarning: boolean;
  code: string;
  submitting: boolean;
  onCodeChange: (code: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const id = useId();
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <input type="text" name="username" autoComplete="username" hidden readOnly value={username} />
      {qrUrl ? (
        <img
          className="settings-security-pane__qr"
          src={qrUrl}
          alt="QR code for the authenticator app"
        />
      ) : null}
      {otpauthUri ? (
        <p className="settings-security-pane__note">
          <a href={otpauthUri}>Open in your authenticator app</a>
        </p>
      ) : null}
      <p className="settings-security-pane__secret">{groupTotpSecret(secret)}</p>
      <div className="settings-security-pane__actions">
        <Button
          type="button"
          variant="outline"
          label="Copy secret"
          onClick={() => void navigator.clipboard?.writeText(secret.replace(/\s+/g, ""))}
        />
      </div>
      {davWarning ? <DavNote /> : null}
      <FieldLabelRow htmlFor={id} label="Code from the app">
        <Input
          id={id}
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
      <div className="settings-security-pane__actions">
        <Button type="button" variant="outline" label="Cancel" onClick={onCancel} />
        <Button
          type="submit"
          label={submitting ? "Checking..." : "Confirm"}
          disabled={submitting || code.length !== 6}
        />
      </div>
    </form>
  );
}

function CodesStep({
  codes,
  saved,
  davWarning,
  onSavedChange,
  onDone,
}: {
  codes: string[];
  saved: boolean;
  davWarning: boolean;
  onSavedChange: (saved: boolean) => void;
  onDone: () => void;
}) {
  const savedId = useId();
  const text = codes.join("\n");
  return (
    <div>
      <ul className="settings-security-pane__codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
      <div className="settings-security-pane__actions">
        <Button
          type="button"
          variant="outline"
          label="Copy"
          onClick={() => void navigator.clipboard?.writeText(text)}
        />
        <Button
          type="button"
          variant="outline"
          label="Download"
          onClick={() => downloadCodes(text)}
        />
      </div>
      {davWarning ? <DavNote /> : null}
      <label className="settings-security-pane__saved" htmlFor={savedId}>
        <Checkbox
          id={savedId}
          checked={saved}
          onCheckedChange={(value) => onSavedChange(value === true)}
        />
        I have saved these codes
      </label>
      <div className="settings-security-pane__actions">
        <Button type="button" label="Done" disabled={!saved} onClick={onDone} />
      </div>
    </div>
  );
}

function DavNote() {
  return (
    <p className="settings-security-pane__note" role="status">
      Calendar and contact apps that sign in with your account password will stop working. Create an
      app password on this page after setup.
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
