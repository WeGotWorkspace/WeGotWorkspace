import type { AdminGroup, AdminUser } from "@/admin-core/src/admin-types";

export type RequiredGroupName =
  | { ok: true; name: string }
  | { ok: false; message: "Group name is required" };

export type NewGroupDecision =
  | { ok: true; name: string; id: string }
  | { ok: false; message: "Group name is required" | "Group already exists" };

export function groupIdFromName(name: string): string {
  const idToken = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return `principals/groups/${idToken}`;
}

export function requiredGroupName(name: string): RequiredGroupName {
  const value = name.trim();
  if (!value) {
    return { ok: false, message: "Group name is required" };
  }
  return { ok: true, name: value };
}

export function validateNewGroup(groups: readonly AdminGroup[], name: string): NewGroupDecision {
  const required = requiredGroupName(name);
  if (!required.ok) {
    return required;
  }
  const id = groupIdFromName(required.name);
  const needle = required.name.toLowerCase();
  if (groups.some((group) => group.id === id || group.name.toLowerCase() === needle)) {
    return { ok: false, message: "Group already exists" };
  }
  return { ok: true, name: required.name, id };
}

export function memberUsernames(
  users: readonly AdminUser[],
  memberUserIds: readonly string[],
): string[] {
  return users.filter((user) => memberUserIds.includes(user.id)).map((user) => user.username);
}

export function appendLocalGroup(
  groups: readonly AdminGroup[],
  group: { id: string; name: string },
): AdminGroup[] {
  return [...groups, { id: group.id, name: group.name, displayName: group.name }];
}

export function renameGroup(
  groups: readonly AdminGroup[],
  groupId: string,
  name: string,
): AdminGroup[] {
  return groups.map((group) =>
    group.id === groupId
      ? {
          ...group,
          name,
          displayName: name,
        }
      : group,
  );
}

export function applyGroupMembership(
  users: readonly AdminUser[],
  groupId: string,
  memberUserIds: readonly string[],
): AdminUser[] {
  return users.map((user) => {
    const belongs = user.groups.includes(groupId);
    const shouldBelong = memberUserIds.includes(user.id);
    if (belongs === shouldBelong) return user;
    return {
      ...user,
      groups: shouldBelong
        ? [...user.groups, groupId]
        : user.groups.filter((candidate) => candidate !== groupId),
    };
  });
}

export function groupsWithout(groups: readonly AdminGroup[], groupId: string): AdminGroup[] {
  return groups.filter((group) => group.id !== groupId);
}

export function usersWithoutGroup(users: readonly AdminUser[], groupId: string): AdminUser[] {
  return users.map((user) => ({
    ...user,
    groups: user.groups.filter((candidate) => candidate !== groupId),
  }));
}
