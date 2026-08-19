import { useEffect, useRef, useState } from "react";
import { Button } from "@/button/src/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { FieldLabelRow as FormField } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { Switch } from "@/ui/switch";
import { UserAvatar } from "@/user-avatar/src/user-avatar";

type UserDialogProps = {
  open: boolean;
  title: string;
  initial?: { username: string; displayName: string; email: string };
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: { username: string; displayName: string; email: string }) => void;
};

export function UserDialog({ open, title, initial, onOpenChange, onSubmit }: UserDialogProps) {
  const [username, setUsername] = useState(initial?.username ?? "");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setUsername(initial?.username ?? "");
    setDisplayName(initial?.displayName ?? "");
    setEmail(initial?.email ?? "");
  }, [open, initial?.username, initial?.displayName, initial?.email]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-dialog-surface">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {initial
              ? "Update display name and email. Username cannot be changed."
              : "Create a new user account."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="Username" readOnly={Boolean(initial)}>
            <Input
              value={username}
              readOnly={Boolean(initial)}
              onChange={(event) => setUsername(event.currentTarget.value)}
              placeholder="jane.doe"
            />
          </FormField>
          <FormField label="Display name">
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
          </FormField>
          <FormField label="Email">
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit({ username, displayName, email })}
            disabled={!username.trim() || !displayName.trim() || !email.trim()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PasswordDialogProps = {
  open: boolean;
  user: { displayName: string } | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: { password: string; confirmPassword: string }) => void;
};

export function PasswordDialog({ open, user, onOpenChange, onSubmit }: PasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setPassword("");
    setConfirmPassword("");
  }, [open, user?.displayName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-dialog-surface">
        <DialogHeader>
          <DialogTitle>Set password</DialogTitle>
          <DialogDescription>
            {user ? `Set a new password for ${user.displayName}.` : "Set a new password."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="New password">
            <Input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
          </FormField>
          <FormField label="Confirm password">
            <Input
              type="password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.currentTarget.value)}
            />
          </FormField>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit({ password, confirmPassword })}
            disabled={!password || !confirmPassword}
          >
            Update password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type GroupDialogProps = {
  open: boolean;
  title: string;
  initial?: { id: string; displayName: string };
  users: Array<{ id: string; displayName: string; username: string; groups: string[] }>;
  currentUsername: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: { name: string; memberUserIds: string[] }) => void;
};

export function GroupDialog({
  open,
  title,
  initial,
  users,
  currentUsername,
  onOpenChange,
  onSubmit,
}: GroupDialogProps) {
  const [name, setName] = useState(initial?.displayName ?? "");
  const [memberUserIds, setMemberUserIds] = useState<string[]>(
    initial ? users.filter((user) => user.groups.includes(initial.id)).map((user) => user.id) : [],
  );
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setName(initial?.displayName ?? "");
    setMemberUserIds(
      initial
        ? users.filter((user) => user.groups.includes(initial.id)).map((user) => user.id)
        : [],
    );
  }, [open, initial, users]);
  const toggleMember = (userId: string) =>
    setMemberUserIds((prev) =>
      prev.includes(userId) ? prev.filter((candidate) => candidate !== userId) : [...prev, userId],
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-dialog-surface">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {initial ? "Rename and assign members." : "Create a new group."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <FormField label="Group name">
            <Input value={name} onChange={(event) => setName(event.currentTarget.value)} />
          </FormField>
          {initial ? (
            <FormField label="Members">
              <ul className="admin-group-member-list">
                {users.map((user) => (
                  <li key={user.id} className="admin-group-member-row">
                    <UserAvatar
                      displayName={user.displayName}
                      subtitle={user.username}
                      size="sm"
                      className="flex-1"
                    />
                    <Switch
                      checked={memberUserIds.includes(user.id)}
                      disabled={
                        initial?.id === "principals/groups/administrators" &&
                        user.username === currentUsername
                      }
                      onCheckedChange={() => toggleMember(user.id)}
                      aria-label={`${user.displayName} group member`}
                    />
                  </li>
                ))}
              </ul>
            </FormField>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => onSubmit({ name, memberUserIds })} disabled={!name.trim()}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isRecipientEmail(value: string): boolean {
  const email = value.trim();
  if (!email.includes("@")) return false;
  const [, domain] = email.split("@");
  return Boolean(domain?.includes("."));
}

export type MailDeliveryTestDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (to: string) => void | Promise<void>;
};

export function MailDeliveryTestDialog({
  open,
  onOpenChange,
  onSubmit,
}: MailDeliveryTestDialogProps) {
  const [to, setTo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setTo("");
    setSubmitting(false);
  }, [open]);

  const recipient = to.trim();
  const canSend = isRecipientEmail(to);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-dialog-surface">
        <DialogHeader>
          <DialogTitle>Send test email</DialogTitle>
          <DialogDescription>
            Send a test message through the configured platform delivery path. Acceptance by the
            transport does not mean the message reached an inbox.
          </DialogDescription>
        </DialogHeader>
        <FormField htmlFor="admin-mail-delivery-test-to" label="Recipient">
          <Input
            id="admin-mail-delivery-test-to"
            type="email"
            autoComplete="email"
            value={to}
            onChange={(event) => {
              const value = event.target.value;
              setTo(value);
            }}
          />
        </FormField>
        <DialogFooter>
          <Button variant="ghost" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!canSend || submitting}
            onClick={async () => {
              if (!canSend) return;
              setSubmitting(true);
              try {
                await onSubmit(recipient);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
