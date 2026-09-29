import { useState } from "react";
import { Button } from "@/button/src/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
import { Input } from "@/ui/input";
import { digitsOnly } from "@/login-core/src/totp-format";

type CodeDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  username?: string;
  requireUsername?: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (code: string) => void;
};

/** Confirm stays disabled until six digits are present. The server checks the code. */
export function AdminMfaCodeDialog({
  open,
  title,
  description,
  confirmLabel,
  username = "",
  requireUsername,
  onOpenChange,
  onConfirm,
}: CodeDialogProps) {
  const [code, setCode] = useState("");
  const [typedUsername, setTypedUsername] = useState("");
  const usernameOk = !requireUsername || typedUsername === requireUsername;
  const ready = code.length === 6 && usernameOk;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setCode("");
          setTypedUsername("");
        }
        onOpenChange(next);
      }}
    >
      <AlertDialogContent className="admin-dialog-surface">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <input
          type="text"
          name="username"
          autoComplete="username"
          hidden
          readOnly
          value={username}
        />
        {requireUsername ? (
          <label className="block space-y-1 text-sm">
            Type {requireUsername} to confirm
            <Input
              value={typedUsername}
              onChange={(event) => setTypedUsername(event.target.value)}
              autoComplete="off"
            />
          </label>
        ) : null}
        <label className="block space-y-1 text-sm" htmlFor="admin-mfa-code">
          Authenticator code
          <Input
            id="admin-mfa-code"
            name="otp"
            value={code}
            onChange={(event) => setCode(digitsOnly(event.target.value))}
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            autoFocus
          />
        </label>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline" label="Cancel" />
          </AlertDialogCancel>
          <Button
            label={confirmLabel}
            disabled={!ready}
            onClick={() => {
              if (!ready) return;
              onConfirm(code);
              setCode("");
              setTypedUsername("");
            }}
          />
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
