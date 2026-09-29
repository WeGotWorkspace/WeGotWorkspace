import { useEffect, useState } from "react";
import { KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { Card } from "@/card/src/card";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { Tag } from "@/tag/src/tag";
import { Switch } from "@/ui/switch";
import { Button } from "@/button/src/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";
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
import { AdminMfaCodeDialog } from "@/admin-core/src/admin-mfa-dialogs";
import { isProtectedGroup } from "@/admin-core/src/admin-workspace-utils";
import { IconActionButton } from "@/admin-core/src/admin-workspace-widgets";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";
import { fetchMfaAccount, resetUserMfa, updateMfaEnforcement } from "@/lib/api/wgw/mfa-client";
import { wgwLiveApiEnabled } from "@/lib/api/wgw/http";

export type AdminUsersPaneProps = {
  controller: AdminControllerState;
  groupMemberCount: Map<string, number>;
  onNewUser: () => void;
  onEditUser: (userId: string) => void;
  onPasswordUser: (userId: string) => void;
  onNewGroup: () => void;
  onEditGroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  mfaPolicy?: {
    required: boolean;
    callerEnabled: boolean;
    onEnforce: (required: boolean, code: string) => void;
    onReset: (username: string, code: string) => void;
  };
};

type PendingEnabledChange = {
  userId: string;
  displayName: string;
  enabled: boolean;
};

function userEnabledSwitchLabel(enabled: boolean, isSelf: boolean): string {
  if (isSelf && enabled) {
    return "You cannot disable your own account.";
  }
  return enabled ? "Disable account" : "Enable account";
}

export function AdminUsersPane({
  controller,
  groupMemberCount,
  onNewUser,
  onEditUser,
  onPasswordUser,
  onNewGroup,
  onEditGroup,
  onDeleteGroup,
  mfaPolicy,
}: AdminUsersPaneProps) {
  const [pendingEnabled, setPendingEnabled] = useState<PendingEnabledChange | null>(null);
  const [userFilter, setUserFilter] = useState<"all" | "without-2fa">("all");
  const [livePolicy, setLivePolicy] = useState<{
    required: boolean;
    callerEnabled: boolean;
  } | null>(null);
  const [enforceOpen, setEnforceOpen] = useState<boolean | null>(null);
  const [resetUser, setResetUser] = useState<string | null>(null);
  const knowsMfa = controller.users.some((user) => typeof user.mfaEnabled === "boolean");
  const policy = mfaPolicy ?? livePolicy;

  useEffect(() => {
    if (mfaPolicy || !wgwLiveApiEnabled()) return;
    let cancelled = false;
    void fetchMfaAccount().then((account) => {
      if (cancelled || !account) return;
      setLivePolicy({ required: account.required, callerEnabled: account.enabled });
    });
    return () => {
      cancelled = true;
    };
  }, [mfaPolicy]);

  const visibleUsers =
    userFilter === "without-2fa"
      ? controller.users.filter((user) => user.mfaEnabled !== true)
      : controller.users;

  return (
    <>
      {policy ? (
        <Card title="Two-factor authentication">
          {policy.callerEnabled ? (
            <Button
              type="button"
              label={policy.required ? "Stop requiring 2FA" : "Require 2FA"}
              onClick={() => setEnforceOpen(!policy.required)}
            />
          ) : (
            <a href="/settings/security">Set up two-factor authentication before requiring it.</a>
          )}
        </Card>
      ) : null}
      <Card
        title="Users"
        action={
          <IconActionButton label="New user" onClick={onNewUser}>
            <Plus className="size-4" />
          </IconActionButton>
        }
      >
        {knowsMfa ? (
          <label className="mb-3 block text-sm">
            Show{" "}
            <select
              aria-label="Filter users"
              value={userFilter}
              onChange={(event) => setUserFilter(event.target.value as "all" | "without-2fa")}
            >
              <option value="all">All users</option>
              <option value="without-2fa">Without 2FA</option>
            </select>
          </label>
        ) : null}
        <ul className="admin-divided-list">
          {visibleUsers.map((user) => {
            const isSelf = user.username === controller.currentUser;
            const enabled = user.enabled !== false;
            const cannotDisableSelf = isSelf && enabled;
            const switchLabel = userEnabledSwitchLabel(enabled, isSelf);
            return (
              <li key={user.id} className="admin-list-row">
                <UserAvatar
                  displayName={user.displayName}
                  subtitle={user.username}
                  size="md"
                  className="flex-1"
                  nameAccessory={
                    <>
                      {!enabled ? <Tag label="Disabled" className="admin-user-status-tag" /> : null}
                      {user.mfaEnabled ? <Tag label="2FA" /> : null}
                    </>
                  }
                />
                <div className="admin-list-row__actions">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="admin-list-row__enabled-switch">
                        <Switch
                          checked={enabled}
                          disabled={cannotDisableSelf}
                          aria-label={switchLabel}
                          onCheckedChange={(next) => {
                            if (next === enabled) return;
                            setPendingEnabled({
                              userId: user.id,
                              displayName: user.displayName,
                              enabled: next,
                            });
                          }}
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>{switchLabel}</TooltipContent>
                  </Tooltip>
                  <IconActionButton
                    label={`Edit ${user.displayName}`}
                    onClick={() => onEditUser(user.id)}
                  >
                    <Pencil className="size-4" />
                  </IconActionButton>
                  <IconActionButton
                    label={`Set password for ${user.displayName}`}
                    onClick={() => onPasswordUser(user.id)}
                  >
                    <KeyRound className="size-4" />
                  </IconActionButton>
                  {policy && user.mfaEnabled ? (
                    <Button
                      type="button"
                      variant="outline"
                      label="Reset 2FA"
                      onClick={() => setResetUser(user.username)}
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>
      <Card
        title="Groups"
        action={
          <IconActionButton label="New group" onClick={onNewGroup}>
            <Plus className="size-4" />
          </IconActionButton>
        }
      >
        <ul className="admin-divided-list">
          {controller.groups.map((group) => (
            <li key={group.id} className="admin-list-row">
              <UserAvatar
                displayName={group.displayName}
                subtitle={`${groupMemberCount.get(group.id) ?? 0} member${(groupMemberCount.get(group.id) ?? 0) === 1 ? "" : "s"}`}
                size="md"
                className="flex-1"
              />
              <div className="admin-list-row__actions">
                <IconActionButton
                  label={`Edit ${group.displayName}`}
                  onClick={() => onEditGroup(group.id)}
                >
                  <Pencil className="size-4" />
                </IconActionButton>
                {!isProtectedGroup(group.id) ? (
                  <IconActionButton
                    label={`Delete ${group.displayName}`}
                    onClick={() => onDeleteGroup(group.id)}
                  >
                    <Trash2 className="size-4" />
                  </IconActionButton>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <AdminMfaCodeDialog
        open={enforceOpen !== null}
        title={
          enforceOpen
            ? "Require two-factor authentication?"
            : "Stop requiring two-factor authentication?"
        }
        description="Enter a current code from your authenticator app."
        confirmLabel={enforceOpen ? "Require 2FA" : "Stop requiring"}
        username={controller.currentUser}
        onOpenChange={(next) => {
          if (!next) setEnforceOpen(null);
        }}
        onConfirm={(code) => {
          const required = enforceOpen === true;
          setEnforceOpen(null);
          if (mfaPolicy) {
            mfaPolicy.onEnforce(required, code);
            return;
          }
          void updateMfaEnforcement(required, code).then(() => {
            setLivePolicy((current) => (current ? { ...current, required } : current));
          });
        }}
      />
      <AdminMfaCodeDialog
        open={resetUser !== null}
        title={`Reset 2FA for ${resetUser ?? "this user"}?`}
        description="This signs them out and removes their authenticator. App passwords stay."
        confirmLabel="Reset 2FA"
        username={controller.currentUser}
        requireUsername={resetUser ?? undefined}
        onOpenChange={(next) => {
          if (!next) setResetUser(null);
        }}
        onConfirm={(code) => {
          const username = resetUser;
          setResetUser(null);
          if (!username) return;
          if (mfaPolicy) {
            mfaPolicy.onReset(username, code);
            return;
          }
          void resetUserMfa(username, code, username);
        }}
      />

      <AlertDialog
        open={pendingEnabled !== null}
        onOpenChange={(next) => {
          if (!next) setPendingEnabled(null);
        }}
      >
        <AlertDialogContent className="admin-dialog-surface">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingEnabled?.enabled
                ? `Enable ${pendingEnabled.displayName}?`
                : `Disable ${pendingEnabled?.displayName ?? "user"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingEnabled?.enabled
                ? "They will be able to sign in again."
                : "They will not be able to sign in. Their data and files stay on disk."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel asChild>
              <Button variant="outline">Cancel</Button>
            </AlertDialogCancel>
            <AlertDialogAction asChild>
              <Button
                variant={pendingEnabled?.enabled ? "default" : "destructive"}
                onClick={(event) => {
                  event.preventDefault();
                  if (!pendingEnabled) return;
                  void controller.actions.setUserEnabled(
                    pendingEnabled.userId,
                    pendingEnabled.enabled,
                  );
                  setPendingEnabled(null);
                }}
              >
                {pendingEnabled?.enabled ? "Enable" : "Disable"}
              </Button>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
