import { Ban, KeyRound, Pencil, Plus, Trash2, UserCheck } from "lucide-react";
import { Card } from "@/card/src/card";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { isProtectedGroup } from "@/admin-core/src/admin-workspace-utils";
import { IconActionButton } from "@/admin-core/src/admin-workspace-widgets";
import type { AdminControllerState } from "@/admin-core/src/use-admin-controller";
import { cn } from "@/lib/utils";

export type AdminUsersPaneProps = {
  controller: AdminControllerState;
  groupMemberCount: Map<string, number>;
  onNewUser: () => void;
  onEditUser: (userId: string) => void;
  onPasswordUser: (userId: string) => void;
  onDeleteUser: (userId: string) => void;
  onNewGroup: () => void;
  onEditGroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
};

export function AdminUsersPane({
  controller,
  groupMemberCount,
  onNewUser,
  onEditUser,
  onPasswordUser,
  onDeleteUser,
  onNewGroup,
  onEditGroup,
  onDeleteGroup,
}: AdminUsersPaneProps) {
  return (
    <>
      <Card
        title="Users"
        action={
          <IconActionButton label="New user" onClick={onNewUser}>
            <Plus className="size-4" />
          </IconActionButton>
        }
      >
        <ul className="admin-divided-list">
          {controller.users.map((user) => {
            const isSelf = user.username === controller.currentUser;
            const enabled = user.enabled !== false;
            return (
              <li
                key={user.id}
                className={cn("admin-list-row", !enabled && "admin-list-row--disabled")}
              >
                <UserAvatar
                  displayName={user.displayName}
                  subtitle={enabled ? user.username : `${user.username} · Disabled`}
                  size="sm"
                  className="flex-1"
                />
                <div className="flex items-center gap-1 shrink-0">
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
                  <IconActionButton
                    label={enabled ? `Disable ${user.displayName}` : `Enable ${user.displayName}`}
                    onClick={() => void controller.actions.setUserEnabled(user.id, !enabled)}
                    disabled={isSelf && enabled}
                  >
                    {enabled ? <Ban className="size-4" /> : <UserCheck className="size-4" />}
                  </IconActionButton>
                  <IconActionButton
                    label={`Delete ${user.displayName}`}
                    onClick={() => onDeleteUser(user.id)}
                  >
                    <Trash2 className="size-4" />
                  </IconActionButton>
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
                size="sm"
                className="flex-1"
              />
              <div className="flex items-center gap-1 shrink-0">
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
    </>
  );
}
