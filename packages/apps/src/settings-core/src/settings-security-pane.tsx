import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { Card } from "@/card/src/card";
import { CardRow } from "@/card/src/card-row";
import { Switch } from "@/ui/switch";
import {
  createAppPassword,
  disableTotp,
  fetchMfaAccount,
  listAppPasswords,
  regenerateRecoveryCodes,
  revokeAllAppPasswords,
  revokeAppPassword,
  sessionWizardSource,
  type AppPasswordItem,
  type MfaAccount,
  type TotpWizardSource,
} from "@/lib/api/wgw/mfa-client";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";
import {
  SettingsSecurityDialogs,
  type SecurityDialogRequest,
  type SecurityReauth,
} from "@/settings-core/src/settings-security-dialogs";
import { SettingsSecuritySetup } from "@/settings-core/src/settings-security-setup";

export type SettingsSecurityPreview = {
  account: MfaAccount;
  username?: string;
  appPasswords: AppPasswordItem[];
  onCreateAppPassword?: (name: string, reauth: SecurityReauth) => Promise<{ password: string }>;
};

type SettingsSecurityPaneProps = {
  preview?: SettingsSecurityPreview;
};

const emptyAccount: MfaAccount = {
  enabled: false,
  required: false,
  recoveryCodesRemaining: 0,
  suggest: false,
};

export function SettingsSecurityPane({ preview }: SettingsSecurityPaneProps) {
  const [account, setAccount] = useState<MfaAccount | null>(preview?.account ?? null);
  const [passwords, setPasswords] = useState<AppPasswordItem[]>(preview?.appPasswords ?? []);
  const [ready, setReady] = useState(Boolean(preview) || !wgwLiveApiEnabled());
  const [setup, setSetup] = useState(false);
  const [dialog, setDialog] = useState<SecurityDialogRequest | null>(null);

  useEffect(() => {
    if (preview || !wgwLiveApiEnabled()) return;
    let cancelled = false;
    void (async () => {
      const [nextAccount, nextPasswords] = await Promise.all([
        fetchMfaAccount(),
        listAppPasswords().catch(() => []),
      ]);
      if (cancelled) return;
      setAccount(nextAccount ?? emptyAccount);
      setPasswords(nextPasswords);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [preview]);

  if (!ready) {
    return <p className="settings-security-pane__note">Loading security settings…</p>;
  }

  const shown = account ?? emptyAccount;

  if (setup) {
    const source = preview
      ? previewSetupSource(preview.username ?? "")
      : sessionWizardSource("", false);
    return (
      <div className="settings-security-pane">
        <SettingsSecuritySetup
          source={source}
          onCancel={() => setSetup(false)}
          onFinished={(recoveryCodeCount) => {
            setSetup(false);
            setAccount((current) => ({
              ...(current ?? emptyAccount),
              enabled: true,
              suggest: false,
              recoveryCodesRemaining: recoveryCodeCount,
            }));
          }}
        />
      </div>
    );
  }

  const enabled = shown.enabled;
  const remaining = shown.recoveryCodesRemaining;

  return (
    <div className="settings-security-pane">
      <Card
        title="Two-factor authentication"
        description={
          enabled
            ? "An authenticator app is required when you sign in."
            : "Add an authenticator app. Calendar and contact apps keep using app passwords."
        }
        action={
          <Switch
            checked={enabled}
            aria-label="Two-factor authentication"
            onCheckedChange={(next) => {
              if (next) {
                setSetup(true);
                return;
              }
              setDialog({ purpose: "disable" });
            }}
          />
        }
      >
        {enabled ? (
          <>
            <CardRow title="Authenticator" subtitle="On" />
            <CardRow
              title="Recovery codes"
              subtitle={
                remaining === 0
                  ? "None left"
                  : remaining < 3
                    ? `Only ${remaining} left`
                    : `${remaining} left`
              }
            />
            {remaining < 3 ? (
              <p className="settings-security-pane__note" role="status">
                {remaining === 0
                  ? "You have no recovery codes left."
                  : `Only ${remaining} recovery codes left.`}
              </p>
            ) : null}
            <div className="settings-security-pane__actions">
              <Button
                type="button"
                variant="outline"
                label="Replace recovery codes"
                onClick={() => setDialog({ purpose: "codes" })}
              />
            </div>
          </>
        ) : null}
      </Card>

      <Card
        title="App passwords"
        description="Named passwords for calendar and contact apps. A password is shown once, when you create it."
      >
        {passwords.length === 0 ? (
          <p className="settings-security-pane__note">No app passwords yet.</p>
        ) : (
          <ul className="settings-security-pane__passwords">
            {passwords.map((item) => (
              <li key={item.id} className="settings-security-pane__password">
                <div>
                  <div>{item.name}</div>
                  {item.lastUsedClient ? (
                    <div className="settings-security-pane__password-meta">
                      {item.lastUsedClient}
                    </div>
                  ) : null}
                </div>
                <IconButton
                  type="button"
                  label={`Revoke ${item.name}`}
                  icon={<Trash2 />}
                  variant="outline"
                  severity="danger"
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
        )}
        <div className="settings-security-pane__actions">
          <Button
            type="button"
            variant="outline"
            label="Create app password"
            onClick={() => setDialog({ purpose: "create" })}
          />
          {passwords.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              label="Revoke all"
              onClick={() => setDialog({ purpose: "revoke-all" })}
            />
          ) : null}
        </div>
      </Card>

      <SettingsSecurityDialogs
        request={dialog}
        enabled={enabled}
        onClose={() => setDialog(null)}
        onDisable={async (reauth) => {
          if (!preview) await disableTotp(reauth);
          setAccount((current) =>
            current
              ? { ...current, enabled: false, recoveryCodesRemaining: 0, suggest: true }
              : current,
          );
        }}
        onReplaceCodes={async (code) => {
          const codes = preview ? ["aaaaa-bbbbb"] : await regenerateRecoveryCodes(code);
          setAccount((current) =>
            current ? { ...current, recoveryCodesRemaining: codes.length } : current,
          );
          return codes;
        }}
        onRevokeAll={async (reauth) => {
          if (!preview) await revokeAllAppPasswords(reauth);
          setPasswords([]);
        }}
        onCreate={async (name, reauth) => {
          if (preview?.onCreateAppPassword) {
            const created = await preview.onCreateAppPassword(name, reauth);
            return created.password;
          }
          if (preview) return "abcd-efgh-ijkl-mnop";
          const created = await createAppPassword(name, reauth);
          setPasswords((current) => [created.item, ...current]);
          return created.password;
        }}
        onCodesReady={(codes) => setDialog({ purpose: "codes-ready", codes })}
        onCreated={(password) => setDialog({ purpose: "created", password })}
      />
    </div>
  );
}

function previewSetupSource(username: string): TotpWizardSource {
  return {
    mode: "enroll",
    username,
    presentation: "session",
    forced: false,
    start: async (password) => {
      if (!password) {
        throw new Error("Enter your account password.");
      }
      return {
        secret: "ABCDEFGHIJKLMNOP",
        otpauthUri: "otpauth://totp/WeGotWorkspace:admin?secret=ABCDEFGHIJKLMNOP",
        davWarning: false,
      };
    },
    confirm: async () => ({ recoveryCodes: ["aaaaa-bbbbb", "ccccc-ddddd"] }),
  };
}
