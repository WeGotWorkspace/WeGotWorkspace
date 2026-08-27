import type { CalendarInvitee } from "@/calendar-core/src/calendar-attendees";
import type {
  CalendarDirectoryGroup,
  CalendarInfo,
  CalendarSharePrincipal,
  CalendarShareWith,
} from "@/calendar-core/src/calendar-types";
import type { JmapCalendar } from "@/lib/jmap-client";
import {
  displayNameForSharePrincipal,
  filterSharePrincipals,
  isShareGroupId,
  mergeShareWith,
  shareGrantEntries,
  sharePermissionFromRights,
  sharePrincipalsFromDirectory,
  shareRightsAllowWrite,
  shareRightsForPermission,
} from "@/share-ui/collection-share";

export { isSharedWithMeCalendar } from "@/calendar-core/src/calendar-sidebar-order";
export type {
  CalendarSharePrincipal,
  CalendarShareRights,
  CalendarShareWith,
} from "@/calendar-core/src/calendar-types";

export const calendarRightsAllowWrite = shareRightsAllowWrite;
export const calendarShareRightsForPermission = shareRightsForPermission;
export const calendarSharePermissionFromRights = sharePermissionFromRights;
export const isCalendarShareGroupId = isShareGroupId;
export const mergeCalendarShareWith = mergeShareWith;
export const calendarShareGrantEntries = shareGrantEntries;
export { displayNameForSharePrincipal };
export const filterCalendarSharePrincipals = filterSharePrincipals;

export function calendarSharePrincipalsFromDirectory(args: {
  invitees?: readonly CalendarInvitee[];
  groups?: readonly CalendarDirectoryGroup[];
  excludeUsername?: string | null;
}): CalendarSharePrincipal[] {
  return sharePrincipalsFromDirectory({
    users: (args.invitees ?? [])
      .filter((invitee) => invitee.username)
      .map((invitee) => ({
        id: invitee.username,
        displayName: invitee.name.trim() || invitee.username,
      })),
    groups: args.groups,
    excludeId: args.excludeUsername,
  });
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
