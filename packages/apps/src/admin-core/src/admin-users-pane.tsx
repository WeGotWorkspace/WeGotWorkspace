import { useState } from "react";
import { MoreHorizontal, User, Users } from "lucide-react";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { Tag } from "@/tag/src/tag";
import { Button } from "@/button/src/button";
import { IconButton } from "@/button/src/icon-button";
import { DropdownMenu } from "@/menu-dropdown/src/dropdown-menu";
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
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";

export type AdminUsersPaneProps = {
  controller: AdminControllerState;
  groupMemberCount: Map<string, number>;
  onNewUser: () => void;
  onEditUser: (userId: string) => void;
  onPasswordUser: (userId: string) => void;
  onNewGroup: () => void;
  onEditGroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
};

type PendingMfaReset = { userId: string; displayName: string };

type PendingEnabledChange = {
  userId: string;
  displayName: string;
  enabled: boolean;
};

function userEnabledLabel(enabled: boolean): string {
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
}: AdminUsersPaneProps) {
  const [pendingEnabled, setPendingEnabled] = useState<PendingEnabledChange | null>(null);
  const [pendingMfaReset, setPendingMfaReset] = useState<PendingMfaReset | null>(null);

  return (
    <>
      <WorkspacePageSection
        title="Users"
        icon={<User aria-hidden />}
        action={<Button label="New user" size="md" variant="outline" onClick={onNewUser} />}
      >
        <ul className="admin-divided-list">
          {controller.users.map((user) => {
            const isSelf = user.username === controller.currentUser;
            const enabled = user.enabled !== false;
            const cannotDisableSelf = isSelf && enabled;
            return (
              <li key={user.id} className="admin-list-row">
                <UserAvatar
                  displayName={user.displayName}
                  subtitle={user.username}
                  size="md"
                  className="flex-1"
                  nameAccessory={
                    user.isAdmin || !enabled || user.mfaEnabled ? (
                      <span className="admin-user-tags">
                        {user.isAdmin ? (
                          <Tag label="Admin" className="admin-user-role-tag" />
                        ) : null}
                        {user.mfaEnabled ? (
                          <Tag label="Two-factor" className="admin-user-role-tag" />
                        ) : null}
                        {!enabled ? (
                          <Tag label="Disabled" className="admin-user-status-tag" />
                        ) : null}
                      </span>
                    ) : null
                  }
                />
                <div className="admin-list-row__actions">
                  <DropdownMenu
                    align="end"
                    contentClassName="min-w-[11rem] p-1.5"
                    items={[
                      { id: "edit", label: "Edit", onClick: () => onEditUser(user.id) },
                      {
                        id: "password",
                        label: "Change password",
                        onClick: () => onPasswordUser(user.id),
                      },
                      {
                        id: "enabled",
                        label: userEnabledLabel(enabled),
                        // You cannot disable your own account.
                        disabled: cannotDisableSelf,
                        onClick: () =>
                          setPendingEnabled({
                            userId: user.id,
                            displayName: user.displayName,
                            enabled: !enabled,
                          }),
                      },
                      // Your own two-factor is turned off in Settings → Security, with a code (#2275).
                      ...(user.mfaEnabled && !isSelf
                        ? [
                            { type: "separator" as const },
                            {
                              id: "reset-two-factor",
                              label: "Reset two-factor sign-in",
                              onClick: () =>
                                setPendingMfaReset({
                                  userId: user.id,
                                  displayName: user.displayName,
                                }),
                            },
                          ]
                        : []),
                    ]}
                    trigger={
                      <IconButton
                        label={`More actions for ${user.displayName}`}
                        icon={<MoreHorizontal />}
                        size="md"
                        variant="outline"
                      />
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </WorkspacePageSection>
      <WorkspacePageSection
        title="Teams"
        icon={<Users aria-hidden />}
        action={<Button label="New team" size="md" variant="outline" onClick={onNewGroup} />}
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
                <DropdownMenu
                  align="end"
                  contentClassName="min-w-[11rem] p-1.5"
                  items={[
                    { id: "edit", label: "Edit", onClick: () => onEditGroup(group.id) },
                    { id: "delete", label: "Delete", onClick: () => onDeleteGroup(group.id) },
                  ]}
                  trigger={
                    <IconButton
                      label={`More actions for ${group.displayName}`}
                      icon={<MoreHorizontal />}
                      size="md"
                      variant="outline"
                    />
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      </WorkspacePageSection>

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
      <MfaResetDialog
        pending={pendingMfaReset}
        onClose={() => setPendingMfaReset(null)}
        onConfirm={(userId) => void controller.actions.resetUserMfa(userId)}
      />
    </>
  );
}

/** Admin reset (#2275): the user signs in with the password alone and sets it up again. */
function MfaResetDialog({
  pending,
  onClose,
  onConfirm,
}: {
  pending: PendingMfaReset | null;
  onClose: () => void;
  onConfirm: (userId: string) => void;
}) {
  return (
    <AlertDialog open={pending !== null} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent className="admin-dialog-surface">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {`Reset two-factor sign-in for ${pending?.displayName ?? "user"}?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Their authenticator app and recovery codes stop working and they are signed out
            everywhere. They sign in with their password alone and can turn two-factor on again in
            Settings.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel asChild>
            <Button variant="outline">Cancel</Button>
          </AlertDialogCancel>
          <AlertDialogAction asChild>
            <Button
              variant="destructive"
              onClick={(event) => {
                event.preventDefault();
                if (pending) onConfirm(pending.userId);
                onClose();
              }}
            >
              Reset
            </Button>
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
