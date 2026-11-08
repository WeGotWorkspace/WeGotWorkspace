import { isProtectedGroup } from "@/admin-core/src/admin-workspace-utils";
import {
  appendLocalGroup,
  applyGroupMembership,
  groupsWithout,
  memberUsernames,
  renameGroup,
  requiredGroupName,
  usersWithoutGroup,
  validateNewGroup,
} from "@/admin-core/src/admin-group-directory";
import { mutationErrorMessage } from "@/admin-core/src/admin-mutation-feedback";
import type { AdminMutationSliceArgs } from "@/admin-core/src/admin-mutation-slice";

type GroupShell = AdminMutationSliceArgs<
  "groups" | "setGroups" | "users" | "setUsers" | "applyAdminData"
>;

export function useAdminGroupMutations({ operations, shell, showSuccess, showError }: GroupShell) {
  const { groups, setGroups, users, setUsers, applyAdminData } = shell;

  const createGroup = async (name: string) => {
    const decision = validateNewGroup(groups, name);
    if (!decision.ok) {
      showError(decision.message);
      return false;
    }
    if (operations?.createGroup) {
      try {
        const next = await operations.createGroup({
          name: decision.name,
          displayName: decision.name,
        });
        applyAdminData(next);
        showSuccess("Team created");
        return true;
      } catch (error) {
        showError(mutationErrorMessage(error, "Could not create team"));
        return false;
      }
    }
    setGroups((prev) => appendLocalGroup(prev, { id: decision.id, name: decision.name }));
    showSuccess("Team created");
    return true;
  };

  const updateGroup = async (groupId: string, input: { name: string; memberUserIds: string[] }) => {
    const required = requiredGroupName(input.name);
    if (!required.ok) {
      showError(required.message);
      return false;
    }
    if (operations?.updateGroup) {
      try {
        const next = await operations.updateGroup(groupId, {
          displayName: required.name,
          members: memberUsernames(users, input.memberUserIds),
        });
        applyAdminData(next);
        showSuccess("Team saved");
        return true;
      } catch (error) {
        showError(mutationErrorMessage(error, "Could not update team"));
        return false;
      }
    }
    setGroups((prev) => renameGroup(prev, groupId, required.name));
    setUsers((prev) => applyGroupMembership(prev, groupId, input.memberUserIds));
    showSuccess("Team saved");
    return true;
  };

  const deleteGroup = async (groupId: string) => {
    if (isProtectedGroup(groupId)) {
      showError("The administrators team is protected and cannot be deleted.");
      return false;
    }
    if (operations?.deleteGroup) {
      try {
        const next = await operations.deleteGroup(groupId);
        applyAdminData(next);
        showSuccess("Team deleted");
        return true;
      } catch (error) {
        showError(mutationErrorMessage(error, "Could not delete team"));
        return false;
      }
    }
    setGroups((prev) => groupsWithout(prev, groupId));
    setUsers((prev) => usersWithoutGroup(prev, groupId));
    showSuccess("Team deleted");
    return true;
  };

  return { createGroup, updateGroup, deleteGroup };
}
