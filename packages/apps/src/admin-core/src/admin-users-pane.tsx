import { useState } from "react";
import { EllipsisVertical } from "lucide-react";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
import { AvatarList, AvatarListRow } from "@/ui/avatar-list";
import { Tag } from "@/tag/src/tag";
import { Button } from "@/button/src/button";
import { IconButton } from "@/button/src/icon-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
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

function memberCountLabel(count: number): string {
  return count === 1 ? "1 member" : `${count} members`;
}

const DANGER_ITEM = "menu-item--severity-danger menu-item--interactive";

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
        action={
          <Button
            type="button"
            variant="ghost"
            className="-me-3"
            label="New"
            aria-label="New user"
            onClick={onNewUser}
          />
        }
      >
        <AvatarList>
          {controller.users.map((user) => {
            const isSelf = user.username === controller.currentUser;
            const enabled = user.enabled !== false;
            const cannotDisableSelf = isSelf && enabled;
            // Your own two-factor is turned off in Settings → Security, with a code (#2275).
            const canResetMfa = user.mfaEnabled && !isSelf;
            return (
              <AvatarListRow
                key={user.id}
                displayName={user.displayName}
                subtitle={user.username}
                nameAccessory={
                  user.isAdmin || !enabled || user.mfaEnabled ? (
                    <span className="admin-user-tags">
                      {user.isAdmin ? <Tag label="Org admin" /> : null}
                      {user.mfaEnabled ? <Tag label="Two-factor" tone="success" /> : null}
                      {!enabled ? <Tag label="Disabled" tone="warning" /> : null}
                    </span>
                  ) : null
                }
              >
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      type="button"
                      variant="ghost"
                      label={`More options: ${user.displayName}`}
                      icon={<EllipsisVertical aria-hidden />}
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => onEditUser(user.id)}>Edit</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onPasswordUser(user.id)}>
                      Set password
                    </DropdownMenuItem>
                    {canResetMfa ? (
                      <DropdownMenuItem
                        className={DANGER_ITEM}
                        onSelect={() =>
                          setPendingMfaReset({ userId: user.id, displayName: user.displayName })
                        }
                      >
                        Reset two-factor sign-in
                      </DropdownMenuItem>
                    ) : null}
                    {cannotDisableSelf ? null : (
                      <DropdownMenuItem
                        className={enabled ? DANGER_ITEM : undefined}
                        onSelect={() =>
                          setPendingEnabled({
                            userId: user.id,
                            displayName: user.displayName,
                            enabled: !enabled,
                          })
                        }
                      >
                        {enabled ? "Disable account" : "Enable account"}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </AvatarListRow>
            );
          })}
        </AvatarList>
      </WorkspacePageSection>
      <WorkspacePageSection
        title="Teams"
        action={
          <Button
            type="button"
            variant="ghost"
            className="-me-3"
            label="New"
            aria-label="New team"
            onClick={onNewGroup}
          />
        }
      >
        <AvatarList>
          {controller.groups.map((group) => (
            <AvatarListRow
              key={group.id}
              displayName={group.displayName}
              subtitle={memberCountLabel(groupMemberCount.get(group.id) ?? 0)}
              nameAccessory={
                group.teamAdmins.length === 0 ? <Tag label="No team admin" tone="warning" /> : null
              }
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton
                    type="button"
                    variant="ghost"
                    label={`More options: ${group.displayName}`}
                    icon={<EllipsisVertical aria-hidden />}
                  />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onEditGroup(group.id)}>Edit</DropdownMenuItem>
                  <DropdownMenuItem
                    className={DANGER_ITEM}
                    onSelect={() => onDeleteGroup(group.id)}
                  >
                    Delete team
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </AvatarListRow>
          ))}
        </AvatarList>
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
