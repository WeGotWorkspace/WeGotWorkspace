import type { ShareUIPermission } from "@/share-ui/share-access-map";
import type { SharePrincipalKind } from "@/share-ui/share-principal-mark";

export const SHARE_GROUP_PREFIX = "groups/";

export type CollectionShareRights = {
  mayRead?: boolean;
  mayWrite?: boolean;
  mayWriteAll?: boolean;
  mayShare?: boolean;
  mayDelete?: boolean;
};

export type CollectionShareWith = Record<string, CollectionShareRights | null>;

export type CollectionSharePrincipal = {
  id: string;
  displayName: string;
  principalType: SharePrincipalKind;
  memberCount?: number;
};

export function shareRightsAllowWrite(rights?: CollectionShareRights | null): boolean {
  if (!rights) return true;
  if (typeof rights.mayWriteAll === "boolean") return rights.mayWriteAll;
  if (typeof rights.mayWrite === "boolean") return rights.mayWrite;
  return true;
}

export function shareRightsForPermission(permission: ShareUIPermission): CollectionShareRights {
  const write = permission === "edit";
  return {
    mayRead: true,
    mayWrite: write,
    mayWriteAll: write,
    mayShare: false,
    mayDelete: false,
  };
}

export function sharePermissionFromRights(
  rights: CollectionShareRights | null | undefined,
): ShareUIPermission {
  return shareRightsAllowWrite(rights) ? "edit" : "view";
}

export function isShareGroupId(id: string): boolean {
  return id.startsWith(SHARE_GROUP_PREFIX);
}

export function mergeShareWith(
  current: CollectionShareWith | null | undefined,
  patch: CollectionShareWith,
): CollectionShareWith | null {
  const next: CollectionShareWith = { ...(current ?? {}) };
  for (const [id, grant] of Object.entries(patch)) {
    if (grant === null) delete next[id];
    else next[id] = grant;
  }
  return Object.keys(next).length === 0 ? null : next;
}

export function shareGrantEntries(
  shareWith: CollectionShareWith | null | undefined,
): { id: string; rights: CollectionShareRights; isGroup: boolean }[] {
  if (!shareWith) return [];
  return Object.entries(shareWith)
    .filter((entry): entry is [string, CollectionShareRights] => entry[1] != null)
    .map(([id, rights]) => ({
      id,
      rights,
      isGroup: isShareGroupId(id),
    }))
    .sort((left, right) => {
      if (left.isGroup !== right.isGroup) return left.isGroup ? -1 : 1;
      return left.id.localeCompare(right.id);
    });
}

export function displayNameForSharePrincipal(
  id: string,
  known: readonly CollectionSharePrincipal[] = [],
): string {
  const match = known.find((row) => row.id === id);
  if (match?.displayName.trim()) return match.displayName;
  return isShareGroupId(id) ? id.slice(SHARE_GROUP_PREFIX.length) : id;
}

export function filterSharePrincipals(
  query: string,
  principals: readonly CollectionSharePrincipal[],
  options?: { excludeIds?: ReadonlySet<string> },
): CollectionSharePrincipal[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];
  return principals.filter((principal) => {
    if (options?.excludeIds?.has(principal.id)) return false;
    return (
      principal.displayName.toLowerCase().includes(needle) ||
      principal.id.toLowerCase().includes(needle)
    );
  });
}

export function sharePrincipalsFromDirectory(args: {
  users?: readonly { id: string; displayName: string }[];
  groups?: readonly { slug: string; displayName: string }[];
  excludeId?: string | null;
}): CollectionSharePrincipal[] {
  const exclude = args.excludeId?.trim();
  const users: CollectionSharePrincipal[] = (args.users ?? [])
    .filter((user) => user.id && user.id !== exclude)
    .map((user) => ({
      id: user.id,
      displayName: user.displayName.trim() || user.id,
      principalType: "user",
    }));
  const groups: CollectionSharePrincipal[] = (args.groups ?? []).map((group) => ({
    id: `${SHARE_GROUP_PREFIX}${group.slug}`,
    displayName: group.displayName,
    principalType: "group",
  }));
  return [...groups, ...users];
}
