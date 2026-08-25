import type { ShareUIPermission } from "@/share-ui/share-access-map";
import type {
  CalendarDirectoryGroup,
  CalendarInfo,
  CalendarSharePrincipal,
  CalendarShareRights,
  CalendarShareWith,
} from "@/calendar-core/src/calendar-types";
import type { CalendarInvitee } from "@/calendar-core/src/calendar-attendees";
import type { JmapCalendar } from "@/lib/jmap-client";

export { isSharedWithMeCalendar } from "@/calendar-core/src/calendar-sidebar-order";
export type { CalendarSharePrincipal, CalendarShareRights, CalendarShareWith };

const GROUP_PREFIX = "groups/";

export function calendarRightsAllowWrite(rights?: CalendarShareRights | null): boolean {
  if (!rights) return true;
  if (typeof rights.mayWriteAll === "boolean") return rights.mayWriteAll;
  if (typeof rights.mayWrite === "boolean") return rights.mayWrite;
  return true;
}

export function calendarShareRightsForPermission(
  permission: ShareUIPermission,
): CalendarShareRights {
  const write = permission === "edit";
  return {
    mayRead: true,
    mayWrite: write,
    mayWriteAll: write,
    mayShare: false,
    mayDelete: false,
  };
}

export function calendarSharePermissionFromRights(
  rights: CalendarShareRights | null | undefined,
): ShareUIPermission {
  return calendarRightsAllowWrite(rights) ? "edit" : "view";
}

export function isCalendarShareGroupId(id: string): boolean {
  return id.startsWith(GROUP_PREFIX);
}

export function mergeCalendarShareWith(
  current: CalendarShareWith | null | undefined,
  patch: CalendarShareWith,
): CalendarShareWith | null {
  const next: CalendarShareWith = { ...(current ?? {}) };
  for (const [id, grant] of Object.entries(patch)) {
    if (grant === null) delete next[id];
    else next[id] = grant;
  }
  return Object.keys(next).length === 0 ? null : next;
}

export function calendarShareGrantEntries(
  shareWith: CalendarShareWith | null | undefined,
): { id: string; rights: CalendarShareRights; isGroup: boolean }[] {
  if (!shareWith) return [];
  return Object.entries(shareWith)
    .filter((entry): entry is [string, CalendarShareRights] => entry[1] != null)
    .map(([id, rights]) => ({
      id,
      rights,
      isGroup: isCalendarShareGroupId(id),
    }))
    .sort((left, right) => {
      if (left.isGroup !== right.isGroup) return left.isGroup ? -1 : 1;
      return left.id.localeCompare(right.id);
    });
}

export function displayNameForSharePrincipal(
  id: string,
  known: readonly CalendarSharePrincipal[] = [],
): string {
  const match = known.find((row) => row.id === id);
  if (match?.displayName.trim()) return match.displayName;
  return isCalendarShareGroupId(id) ? id.slice(GROUP_PREFIX.length) : id;
}

export function filterCalendarSharePrincipals(
  query: string,
  principals: readonly CalendarSharePrincipal[],
  options?: { excludeIds?: ReadonlySet<string> },
): CalendarSharePrincipal[] {
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

export function calendarSharePrincipalsFromDirectory(args: {
  invitees?: readonly CalendarInvitee[];
  groups?: readonly CalendarDirectoryGroup[];
  excludeUsername?: string | null;
}): CalendarSharePrincipal[] {
  const exclude = args.excludeUsername?.trim();
  const users: CalendarSharePrincipal[] = (args.invitees ?? [])
    .filter((invitee) => invitee.username && invitee.username !== exclude)
    .map((invitee) => ({
      id: invitee.username,
      displayName: invitee.name.trim() || invitee.username,
      principalType: "user",
    }));
  const groups: CalendarSharePrincipal[] = (args.groups ?? []).map((group) => ({
    id: `${GROUP_PREFIX}${group.slug}`,
    displayName: group.displayName,
    principalType: "group",
  }));
  return [...groups, ...users];
}

function shareWithFromJmap(
  shareWith: JmapCalendar["shareWith"],
): CalendarShareWith | null | undefined {
  if (shareWith === undefined) return undefined;
  if (shareWith === null) return null;
  const mapped: CalendarShareWith = {};
  for (const [id, rights] of Object.entries(shareWith)) {
    if (rights == null || typeof rights !== "object") continue;
    mapped[id] = {
      ...(typeof rights.mayRead === "boolean" ? { mayRead: rights.mayRead } : {}),
      ...(typeof rights.mayWrite === "boolean" ? { mayWrite: rights.mayWrite } : {}),
      ...(typeof rights.mayWriteAll === "boolean" ? { mayWriteAll: rights.mayWriteAll } : {}),
      ...(typeof rights.mayShare === "boolean" ? { mayShare: rights.mayShare } : {}),
      ...(typeof rights.mayDelete === "boolean" ? { mayDelete: rights.mayDelete } : {}),
    };
  }
  return Object.keys(mapped).length === 0 ? null : mapped;
}

/** Maps a JMAP Calendar (including OpenAPI `mayWrite` rights) onto UI `CalendarInfo`. */
export function calendarInfoFromJmap(calendar: JmapCalendar): CalendarInfo {
  const groupSlug =
    typeof calendar.groupSlug === "string" && calendar.groupSlug.trim()
      ? calendar.groupSlug.trim()
      : null;
  const shareWith = shareWithFromJmap(calendar.shareWith);
  return {
    id: calendar.id,
    name: calendar.name,
    color: calendar.color ?? "#6366F1",
    sortOrder: typeof calendar.sortOrder === "number" ? calendar.sortOrder : 0,
    ...(calendar.isVisible === false ? { isVisible: false } : {}),
    ...(calendar.isDefault ? { isDefault: true } : {}),
    mayWrite: calendar.myRights ? calendarRightsAllowWrite(calendar.myRights) : true,
    mayDelete: calendar.myRights ? calendar.myRights.mayDelete === true : true,
    ...(typeof calendar.myRights?.mayShare === "boolean"
      ? { mayShare: calendar.myRights.mayShare }
      : {}),
    scope: calendar.scope === "group" || groupSlug ? "group" : "personal",
    groupSlug,
    ...(typeof calendar.subscriptionId === "string" && calendar.subscriptionId
      ? { subscriptionId: calendar.subscriptionId }
      : {}),
    ...(shareWith !== undefined ? { shareWith } : {}),
  };
}
