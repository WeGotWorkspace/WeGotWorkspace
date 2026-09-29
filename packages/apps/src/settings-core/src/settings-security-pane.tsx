import { useEffect, useState } from "react";
import { Button } from "@/button/src/button";
import {
  createAppPassword,
  disableTotp,
  fetchMfaAccount,
  listAppPasswords,
  MfaRequestError,
  regenerateRecoveryCodes,
  revokeAllAppPasswords,
  revokeAppPassword,
  sessionWizardSource,
  type AppPasswordItem,
  type MfaAccount,
} from "@/lib/api/wgw/mfa-client";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import { TotpWizard } from "@/login-core/src/totp-wizard";
import { applyTotpPaste, digitsOnly } from "@/login-core/src/totp-format";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";

export type SettingsSecurityPreview = {
  account: MfaAccount;
  username?: string;
  appPasswords: AppPasswordItem[];
  onCreateAppPassword?: (
    name: string,
    reauth: { code?: string; password?: string },
  ) => Promise<{
    password: string;
  }>;
};

type SettingsSecurityPaneProps = {
  preview?: SettingsSecurityPreview;
};

export function SettingsSecurityPane({ preview }: SettingsSecurityPaneProps) {
  const [account, setAccount] = useState<MfaAccount | null>(preview?.account ?? null);
  const [passwords, setPasswords] = useState<AppPasswordItem[]>(preview?.appPasswords ?? []);
  const [enrolling, setEnrolling] = useState(false);
  const [message, setMessage] = useState("");
  const [revealed, setRevealed] = useState("");
  const [freshCodes, setFreshCodes] = useState<string[]>([]);

  useEffect(() => {
    if (preview || !wgwLiveApiEnabled()) return;
    let cancelled = false;
    void (async () => {
      const [nextAccount, nextPasswords] = await Promise.all([
        fetchMfaAccount(),
        listAppPasswords().catch(() => []),
      ]);
      if (cancelled) return;
      setAccount(nextAccount);
      setPasswords(nextPasswords);
    })();
    return () => {
      cancelled = true;
    };
  }, [preview]);

  if (enrolling) {
    return (
      <TotpWizard
        source={sessionWizardSource(preview?.username ?? "", false)}
        onFinished={() => {
          setEnrolling(false);
          setAccount((current) =>
            current
              ? { ...current, enabled: true, suggest: false, recoveryCodesRemaining: 10 }
              : current,
          );
        }}
        onLogout={() => setEnrolling(false)}
      />
    );
  }

  const enabled = account?.enabled === true;
  const required = account?.required === true;
  const remaining = account?.recoveryCodesRemaining ?? 0;

  return (
    <div className="settings-security-pane max-w-lg space-y-8">
      <section className="space-y-3">
        <h2 className="text-base font-medium">Two-factor authentication</h2>
        <p className="text-sm text-muted-foreground">
          {enabled
            ? "An authenticator app is required when you sign in."
            : "Add an authenticator app. Calendar and contact apps keep using app passwords."}
        </p>
        {enabled && remaining < 3 ? (
          <p className="text-sm" role="status">
            {remaining === 0
              ? "You have no recovery codes left."
              : `Only ${remaining} recovery codes left.`}
          </p>
        ) : null}
        {message ? (
          <p className="text-sm" role="alert">
            {message}
          </p>
        ) : null}
        {enabled && !required ? (
          <ReauthForm
            enabled
            label="Turn off"
            onSubmit={async (reauth) => {
              if (preview) {
                setAccount({ ...preview.account, enabled: false, recoveryCodesRemaining: 0 });
                return;
              }
              await disableTotp(reauth);
              setAccount((current) =>
                current
                  ? { ...current, enabled: false, recoveryCodesRemaining: 0, suggest: true }
                  : current,
              );
            }}
            onError={setMessage}
          />
        ) : null}
        {!enabled ? (
          <Button type="button" label="Turn on" onClick={() => setEnrolling(true)} />
        ) : (
          <ReauthForm
            enabled
            label="Replace recovery codes"
            onSubmit={async (reauth) => {
              if (!reauth.code) return;
              const codes = preview ? ["aaaaa-bbbbb"] : await regenerateRecoveryCodes(reauth.code);
              setFreshCodes(codes);
              setAccount((current) =>
                current ? { ...current, recoveryCodesRemaining: codes.length } : current,
              );
            }}
            onError={setMessage}
          />
        )}
        {freshCodes.length > 0 ? (
          <ul>
            {freshCodes.map((code) => (
              <li key={code}>
                <code>{code}</code>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-medium">App passwords</h2>
        <p className="text-sm text-muted-foreground">
          Named passwords for calendar and contact apps. They are shown once.
        </p>
        {revealed ? (
          <p>
            App password: <code>{revealed}</code>
          </p>
        ) : null}
        <ul className="space-y-2">
          {passwords.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {item.name}
                {item.lastUsedClient ? ` · ${item.lastUsedClient}` : ""}
              </span>
              <Button
                type="button"
                variant="outline"
                label="Revoke"
                onClick={() => {
                  void (async () => {
                    if (!preview) await revokeAppPassword(item.id);
                    setPasswords((current) => current.filter((row) => row.id !== item.id));
                  })();
                }}
              />
            </li>
          ))}
        </ul>
        <AppPasswordCreateForm
          enabled={enabled}
          onCreate={async (name, reauth) => {
            if (preview?.onCreateAppPassword) {
              const created = await preview.onCreateAppPassword(name, reauth);
              setRevealed(created.password);
              return;
            }
            if (preview) {
              setRevealed("abcd-efgh-ijkl-mnop");
              return;
            }
            const created = await createAppPassword(name, reauth);
            setRevealed(created.password);
            setPasswords((current) => [created.item, ...current]);
          }}
          onError={setMessage}
        />
        {passwords.length > 0 ? (
          <ReauthForm
            enabled={enabled}
            label="Revoke all"
            onSubmit={async (reauth) => {
              if (!preview) await revokeAllAppPasswords(reauth);
              setPasswords([]);
            }}
            onError={setMessage}
          />
        ) : null}
      </section>
    </div>
  );
}

function ReauthForm({
  enabled,
  label,
  onSubmit,
  onError,
}: {
  enabled: boolean;
  label: string;
  onSubmit: (reauth: { code?: string; password?: string }) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        onError("");
        const reauth = enabled ? { code: digitsOnly(value) } : { password: value };
        void onSubmit(reauth)
          .catch((cause: unknown) => {
            onError(cause instanceof MfaRequestError ? cause.message : "That did not work.");
          })
          .finally(() => setBusy(false));
      }}
    >
      <FieldLabelRow
        htmlFor={`reauth-${label}`}
        label={enabled ? "Authenticator code" : "Password"}
      >
        <Input
          id={`reauth-${label}`}
          name={enabled ? "otp" : "password"}
          type="text"
          value={value}
          onChange={(event) =>
            setValue(enabled ? digitsOnly(event.target.value) : event.target.value)
          }
          onPaste={enabled ? (event) => applyTotpPaste(event, setValue) : undefined}
          autoComplete={enabled ? "one-time-code" : "current-password"}
          inputMode={enabled ? "numeric" : undefined}
          pattern={enabled ? "[0-9]*" : undefined}
          maxLength={enabled ? 6 : undefined}
          variant={enabled ? "default" : "password"}
        />
      </FieldLabelRow>
      <Button
        type="submit"
        label={label}
        disabled={busy || (enabled ? value.length !== 6 : value === "")}
      />
    </form>
  );
}

function AppPasswordCreateForm({
  enabled,
  onCreate,
  onError,
}: {
  enabled: boolean;
  onCreate: (name: string, reauth: { code?: string; password?: string }) => Promise<void>;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        onError("");
        const reauth = enabled ? { code: digitsOnly(secret) } : { password: secret };
        void onCreate(name.trim(), reauth)
          .then(() => {
            setName("");
            setSecret("");
          })
          .catch((cause: unknown) => {
            onError(
              cause instanceof MfaRequestError
                ? cause.message
                : "Could not create that app password.",
            );
          })
          .finally(() => setBusy(false));
      }}
    >
      <FieldLabelRow htmlFor="app-password-name" label="Name">
        <Input
          id="app-password-name"
          name="app-password-name"
          value={name}
          maxLength={60}
          required
          onChange={(event) => setName(event.target.value)}
        />
      </FieldLabelRow>
      <FieldLabelRow
        htmlFor="app-password-reauth"
        label={enabled ? "Authenticator code" : "Password"}
      >
        <Input
          id="app-password-reauth"
          name={enabled ? "otp" : "password"}
          type="text"
          value={secret}
          onChange={(event) =>
            setSecret(enabled ? digitsOnly(event.target.value) : event.target.value)
          }
          onPaste={enabled ? (event) => applyTotpPaste(event, setSecret) : undefined}
          autoComplete={enabled ? "one-time-code" : "current-password"}
          inputMode={enabled ? "numeric" : undefined}
          pattern={enabled ? "[0-9]*" : undefined}
          maxLength={enabled ? 6 : undefined}
          variant={enabled ? "default" : "password"}
        />
      </FieldLabelRow>
      <Button
        type="submit"
        label={busy ? "Creating..." : "Create app password"}
        disabled={busy || name.trim() === "" || (enabled ? secret.length !== 6 : secret === "")}
      />
    </form>
  );
}
