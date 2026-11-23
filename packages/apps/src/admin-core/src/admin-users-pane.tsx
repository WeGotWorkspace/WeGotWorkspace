import { useState } from "react";
import { KeyRound, Pencil, Plus, ShieldOff, Trash2, User, Users } from "lucide-react";
import { WorkspacePageSection } from "@/workspace-shell/src/workspace-page";
import { AvatarList, AvatarListAction, AvatarListRow } from "@/ui/avatar-list";
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
import { AdminArchivedProjectsSection } from "@/admin-core/src/admin-archived-projects-section";
import type { AdminProjectOperations } from "@/admin-core/src/admin-projects-operations";
import { IconActionButton } from "@/admin-core/src/admin-workspace-widgets";
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
  /** Archived Projects sit under Teams; the section is hidden without operations. */
  projectOperations?: AdminProjectOperations;
};

type PendingMfaReset = { userId: string; displayName: string };

type PendingEnabledChange = {
  userId: string;
  displayName: string;
  enabled: boolean;
};

function teamSubtitle(members: number, teamAdmins: number): string {
  const memberPart = `${members} member${members === 1 ? "" : "s"}`;
  if (teamAdmins === 0) return `${memberPart} · no team admin`;
  return `${memberPart} · ${teamAdmins} team admin${teamAdmins === 1 ? "" : "s"}`;
}

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
  projectOperations,
}: AdminUsersPaneProps) {
  const [pendingEnabled, setPendingEnabled] = useState<PendingEnabledChange | null>(null);
  const [pendingMfaReset, setPendingMfaReset] = useState<PendingMfaReset | null>(null);

  return (
    <>
      <WorkspacePageSection
        title="Users"
        icon={<User aria-hidden />}
        action={
          <IconActionButton label="New user" onClick={onNewUser}>
            <Plus className="size-4" />
          </IconActionButton>
        }
      >
        <AvatarList>
          {controller.users.map((user) => {
            const isSelf = user.username === controller.currentUser;
            const enabled = user.enabled !== false;
            const cannotDisableSelf = isSelf && enabled;
            const switchLabel = userEnabledSwitchLabel(enabled, isSelf);
            return (
              <AvatarListRow
                key={user.id}
                displayName={user.displayName}
                subtitle={user.username}
                nameAccessory={
                  user.isAdmin || !enabled || user.mfaEnabled ? (
                    <span className="admin-user-tags">
                      {user.isAdmin ? (
                        <Tag label="Organization admin" className="admin-user-role-tag" />
                      ) : null}
                      {user.mfaEnabled ? (
                        <Tag label="Two-factor" className="admin-user-role-tag" />
                      ) : null}
                      {!enabled ? <Tag label="Disabled" className="admin-user-status-tag" /> : null}
                    </span>
                  ) : null
                }
              >
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
                <AvatarListAction
                  label={`Edit ${user.displayName}`}
                  icon={<Pencil className="size-4" />}
                  onClick={() => onEditUser(user.id)}
                />
                <AvatarListAction
                  label={`Set password for ${user.displayName}`}
                  icon={<KeyRound className="size-4" />}
                  onClick={() => onPasswordUser(user.id)}
                />
                {/* Your own two-factor is turned off in Settings → Security, with a code (#2275). */}
                {user.mfaEnabled && !isSelf ? (
                  <AvatarListAction
                    label={`Reset two-factor sign-in for ${user.displayName}`}
                    icon={<ShieldOff className="size-4" />}
                    onClick={() =>
                      setPendingMfaReset({ userId: user.id, displayName: user.displayName })
                    }
                  />
                ) : null}
              </AvatarListRow>
            );
          })}
        </AvatarList>
      </WorkspacePageSection>
      <WorkspacePageSection
        title="Teams"
        icon={<Users aria-hidden />}
        action={
          <IconActionButton label="New team" onClick={onNewGroup}>
            <Plus className="size-4" />
          </IconActionButton>
        }
      >
        <AvatarList>
          {controller.groups.map((group) => (
            <AvatarListRow
              key={group.id}
              displayName={group.displayName}
              subtitle={teamSubtitle(groupMemberCount.get(group.id) ?? 0, group.teamAdmins.length)}
            >
              <AvatarListAction
                label={`Edit ${group.displayName}`}
                icon={<Pencil className="size-4" />}
                onClick={() => onEditGroup(group.id)}
              />
              <AvatarListAction
                label={`Delete ${group.displayName}`}
                icon={<Trash2 className="size-4" />}
                onClick={() => onDeleteGroup(group.id)}
              />
            </AvatarListRow>
          ))}
        </AvatarList>
      </WorkspacePageSection>
      <AdminArchivedProjectsSection operations={projectOperations} />

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
