import { useEffect, useId, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/ui/alert-dialog";
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
import { NO_AUTOFILL } from "@/ui/no-autofill";
import { TeamMembersCard } from "@/settings-core/src/team-members-card";
import { type ShareSearchOption } from "@/share-ui/share-principal-search-dropdown";

type UserDialogPayload = { username: string; displayName: string; email: string; isAdmin: boolean };

type UserDialogProps = {
  open: boolean;
  title: string;
  initial?: { username: string; displayName: string; email: string; isAdmin: boolean };
  /** The signed-in admin edits their own account: the admin switch stays on. */
  isSelf?: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: UserDialogPayload) => void;
  onDelete?: () => void | Promise<void>;
};

function adminRoleHint(lockedOn: boolean): string {
  return lockedOn
    ? "You cannot remove your own organization admin role."
    : "Creates users and Teams, assigns people to Teams, and changes settings.";
}

export function UserDialog({
  open,
  title,
  initial,
  isSelf = false,
  onOpenChange,
  onSubmit,
  onDelete,
}: UserDialogProps) {
  const [username, setUsername] = useState(initial?.username ?? "");
  const [displayName, setDisplayName] = useState(initial?.displayName ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [isAdmin, setIsAdmin] = useState(initial?.isAdmin ?? false);
  const usernameId = useId();
  const displayNameId = useId();
  const emailId = useId();
  const adminSwitchId = useId();
  const adminHintId = useId();
  const adminLockedOn = isSelf && (initial?.isAdmin ?? false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      setConfirmDeleteOpen(false);
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    setUsername(initial?.username ?? "");
    setDisplayName(initial?.displayName ?? "");
    setEmail(initial?.email ?? "");
    setIsAdmin(initial?.isAdmin ?? false);
  }, [open, initial?.username, initial?.displayName, initial?.email, initial?.isAdmin]);

  const canDelete = Boolean(initial && onDelete);

  return (
    <>
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
          <FormField
            layout="inline"
            fill
            label="Username"
            htmlFor={usernameId}
            readOnly={Boolean(initial)}
          >
            <Input
              id={usernameId}
              value={username}
              readOnly={Boolean(initial)}
              onChange={(event) => setUsername(event.currentTarget.value)}
              placeholder="jane.doe"
            />
          </FormField>
          <FormField layout="inline" fill label="Display name" htmlFor={displayNameId}>
            <Input
              id={displayNameId}
              value={displayName}
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
          </FormField>
          <FormField layout="inline" fill label="Email" htmlFor={emailId}>
            <Input
              id={emailId}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </FormField>
          <FormField
            layout="inline"
            label="Organization admin"
            htmlFor={adminSwitchId}
            description={<span id={adminHintId}>{adminRoleHint(adminLockedOn)}</span>}
          >
            <Switch
              id={adminSwitchId}
              checked={isAdmin}
              disabled={adminLockedOn}
              aria-describedby={adminHintId}
              onCheckedChange={(next) => setIsAdmin(next === true)}
            />
          </FormField>
          <DialogFooter
            start={
              canDelete ? (
                <IconButton
                  type="button"
                  variant="outline"
                  severity="danger"
                  size="md"
                  icon={<Trash2 className="size-3.5" aria-hidden />}
                  label="Delete user"
                  onClick={() => setConfirmDeleteOpen(true)}
                />
              ) : null
            }
          >
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => onSubmit({ username, displayName, email, isAdmin })}
              disabled={!username.trim() || !displayName.trim() || !email.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmDeleteOpen}
        onOpenChange={(next) => {
          if (!next) setConfirmDeleteOpen(false);
        }}
      >
        <AlertDialogContent className="admin-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              {initial
                ? `${initial.displayName} (@${initial.username}) will be permanently removed and unassigned from all teams.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant="destructive"
                onClick={async (event) => {
                  event.preventDefault();
                  await onDelete?.();
                  setConfirmDeleteOpen(false);
                }}
              >
                Delete
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
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
  const passwordId = useId();
  const confirmPasswordId = useId();
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
        <FormField layout="inline" fill label="New password" htmlFor={passwordId}>
          <Input
            id={passwordId}
            variant="password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
          />
        </FormField>
        <FormField layout="inline" fill label="Confirm password" htmlFor={confirmPasswordId}>
          <Input
            id={confirmPasswordId}
            variant="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.currentTarget.value)}
          />
        </FormField>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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
  initial?: { id: string; displayName: string; teamAdmins: string[] };
  users: Array<{
    id: string;
    displayName: string;
    username: string;
    email?: string;
    groups: string[];
  }>;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: {
    name: string;
    memberUserIds: string[];
    teamAdminUserIds: string[];
  }) => void;
};

function teamAdminUserIdsOf(
  initial: GroupDialogProps["initial"],
  users: GroupDialogProps["users"],
): string[] {
  if (!initial) return [];
  return users.filter((user) => initial.teamAdmins.includes(user.username)).map((user) => user.id);
}

export function GroupDialog({
  open,
  title,
  initial,
  users,
  onOpenChange,
  onSubmit,
}: GroupDialogProps) {
  const [name, setName] = useState(initial?.displayName ?? "");
  const nameId = useId();
  const [memberUserIds, setMemberUserIds] = useState<string[]>(
    initial ? users.filter((user) => user.groups.includes(initial.id)).map((user) => user.id) : [],
  );
  const [teamAdminUserIds, setTeamAdminUserIds] = useState<string[]>(() =>
    teamAdminUserIdsOf(initial, users),
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
    setQuery("");
    setTeamAdminUserIds(teamAdminUserIdsOf(initial, users));
    setMemberUserIds(
      initial
        ? users.filter((user) => user.groups.includes(initial.id)).map((user) => user.id)
        : [],
    );
  }, [open, initial, users]);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const candidates: ShareSearchOption[] =
    needle === ""
      ? []
      : users
          .filter(
            (user) =>
              !memberUserIds.includes(user.id) &&
              [user.displayName, user.username, user.email ?? ""].some((field) =>
                field.toLowerCase().includes(needle),
              ),
          )
          .map((user) => ({
            id: user.id,
            displayName: user.displayName,
            principalType: "user" as const,
            meta: user.email ? user.email : user.username,
          }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="admin-dialog-surface">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {initial ? "Rename and assign members." : "Create a new team."}
          </DialogDescription>
        </DialogHeader>
        <FormField layout="inline" fill label="Team name" htmlFor={nameId}>
          <Input
            id={nameId}
            {...NO_AUTOFILL}
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
          />
        </FormField>
        {initial ? (
          <TeamMembersCard
            members={users
              .filter((user) => memberUserIds.includes(user.id))
              .map((user) => ({
                id: user.id,
                displayName: user.displayName,
                username: user.username,
                isTeamAdmin: teamAdminUserIds.includes(user.id),
              }))}
            query={query}
            onQueryChange={setQuery}
            candidates={candidates}
            minQueryLength={1}
            onAdd={(userId) => setMemberUserIds((prev) => [...prev, userId])}
            onRoleChange={(member, role) =>
              setTeamAdminUserIds((prev) =>
                role === "teamAdmin"
                  ? [...prev.filter((id) => id !== member.id), member.id]
                  : prev.filter((id) => id !== member.id),
              )
            }
            onRemove={(member) => {
              setMemberUserIds((prev) => prev.filter((id) => id !== member.id));
              setTeamAdminUserIds((prev) => prev.filter((id) => id !== member.id));
            }}
          />
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => onSubmit({ name, memberUserIds, teamAdminUserIds })}
            disabled={!name.trim()}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
