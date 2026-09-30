import { useEffect, useId, useState } from "react";
import { Button } from "@/button/src/button";
import { RecoveryCodesCopyButton } from "@/settings-core/src/settings-security-setup";
import { MfaRequestError } from "@/lib/api/wgw/mfa-client";
import { applyTotpPaste, digitsOnly } from "@/login-core/src/totp-format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";

export type SecurityReauth = { code?: string; password?: string };

export type SecurityDialogRequest =
  | { purpose: "disable" }
  | { purpose: "codes" }
  | { purpose: "codes-ready"; codes: string[] }
  | { purpose: "revoke-all" }
  | { purpose: "create" }
  | { purpose: "created"; password: string };

type SettingsSecurityDialogsProps = {
  request: SecurityDialogRequest | null;
  enabled: boolean;
  onClose: () => void;
  onDisable: (reauth: SecurityReauth) => Promise<void>;
  onReplaceCodes: (code: string) => Promise<string[]>;
  onRevokeAll: (reauth: SecurityReauth) => Promise<void>;
  onCreate: (name: string, reauth: SecurityReauth) => Promise<string>;
  onCodesReady: (codes: string[]) => void;
  onCreated: (password: string) => void;
};

export function SettingsSecurityDialogs({
  request,
  enabled,
  onClose,
  onDisable,
  onReplaceCodes,
  onRevokeAll,
  onCreate,
  onCodesReady,
  onCreated,
}: SettingsSecurityDialogsProps) {
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {request ? (
        <DialogBody
          request={request}
          enabled={enabled}
          onClose={onClose}
          onDisable={onDisable}
          onReplaceCodes={onReplaceCodes}
          onRevokeAll={onRevokeAll}
          onCreate={onCreate}
          onCodesReady={onCodesReady}
          onCreated={onCreated}
        />
      ) : null}
    </Dialog>
  );
}

function DialogBody({
  request,
  enabled,
  onClose,
  onDisable,
  onReplaceCodes,
  onRevokeAll,
  onCreate,
  onCodesReady,
  onCreated,
}: SettingsSecurityDialogsProps & { request: SecurityDialogRequest }) {
  const nameId = useId();
  const secretId = useId();
  const [name, setName] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName("");
    setSecret("");
    setError("");
    setBusy(false);
  }, [request.purpose]);

  const copy =
    request.purpose === "disable"
      ? {
          title: "Turn off two-factor authentication",
          description: "Enter the code from your authenticator app.",
          confirm: "Turn off",
          destructive: true,
        }
      : request.purpose === "codes"
        ? {
            title: "Replace recovery codes",
            description: "Enter the code from your authenticator app. The old codes stop working.",
            confirm: "Replace codes",
            destructive: false,
          }
        : request.purpose === "revoke-all"
          ? {
              title: "Revoke all app passwords",
              description: "Calendar and contact apps using these passwords will need a new one.",
              confirm: "Revoke all",
              destructive: true,
            }
          : request.purpose === "create"
            ? {
                title: "Create app password",
                description: "Name the app that will use this password. It is shown once.",
                confirm: "Create",
                destructive: false,
              }
            : request.purpose === "codes-ready"
              ? {
                  title: "Save these recovery codes",
                  description: "Each code works once. They will not be shown again.",
                  confirm: "Done",
                  destructive: false,
                }
              : {
                  title: "App password",
                  description: "Copy this password into the app. It will not be shown again.",
                  confirm: "Done",
                  destructive: false,
                };

  const reauth = (): SecurityReauth =>
    enabled ? { code: digitsOnly(secret) } : { password: secret };

  const secretReady = enabled ? digitsOnly(secret).length === 6 : secret !== "";

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (request.purpose === "disable") {
        await onDisable(reauth());
        onClose();
      } else if (request.purpose === "codes") {
        onCodesReady(await onReplaceCodes(digitsOnly(secret)));
      } else if (request.purpose === "revoke-all") {
        await onRevokeAll(reauth());
        onClose();
      } else if (request.purpose === "create") {
        onCreated(await onCreate(name.trim(), reauth()));
      }
    } catch (cause) {
      setError(cause instanceof MfaRequestError ? cause.message : "That did not work.");
      setBusy(false);
    }
  };

  const reveal =
    request.purpose === "codes-ready"
      ? request.codes.join("\n")
      : request.purpose === "created"
        ? request.password
        : "";

  return (
    <DialogContent className="settings-dialog-surface">
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>
      {request.purpose === "codes-ready" || request.purpose === "created" ? (
        <>
          {request.purpose === "codes-ready" ? (
            <ul className="settings-security-dialog__codes">
              {request.codes.map((code) => (
                <li key={code}>
                  <code>{code}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="settings-security-dialog__secret">{request.password}</p>
          )}
          <DialogFooter>
            {request.purpose === "codes-ready" ? (
              <RecoveryCodesCopyButton text={reveal} />
            ) : (
              <Button
                type="button"
                variant="outline"
                label="Copy"
                onClick={() => void navigator.clipboard?.writeText(reveal)}
              />
            )}
            <Button type="button" label="Done" onClick={onClose} />
          </DialogFooter>
        </>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {error ? (
            <p className="settings-security-dialog__alert" role="alert">
              {error}
            </p>
          ) : null}
          {request.purpose === "create" ? (
            <FieldLabelRow htmlFor={nameId} label="Name">
              <Input
                id={nameId}
                name="app-password-name"
                value={name}
                maxLength={60}
                required
                autoFocus
                onChange={(event) => setName(event.target.value)}
              />
            </FieldLabelRow>
          ) : null}
          <FieldLabelRow htmlFor={secretId} label={enabled ? "Authenticator code" : "Password"}>
            <Input
              id={secretId}
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
              autoFocus={request.purpose !== "create"}
              required
            />
          </FieldLabelRow>
          <DialogFooter>
            <Button type="button" variant="outline" label="Cancel" onClick={onClose} />
            <Button
              type="submit"
              variant={copy.destructive ? "destructive" : "default"}
              label={busy ? "Working..." : copy.confirm}
              disabled={
                busy || (request.purpose === "create" && name.trim() === "") || !secretReady
              }
            />
          </DialogFooter>
        </form>
      )}
    </DialogContent>
  );
}
