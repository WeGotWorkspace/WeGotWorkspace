/**
 * Workspace principal directory for the live Meet chat workspace: mention
 * targets, DM rail people, and the share-dialog suggestion fallback. Reuses the
 * existing principal surfaces (scheduling invitees + settings groups) — the
 * live share *search* stays on `searchCollectionSharePrincipals`.
 */
import { fetchCalendarSchedulingInvitees } from "@/lib/api/wgw/calendar-scheduling";
import { wgwSettingsStateRead } from "@/lib/api/wgw/http";
import {
  sharePrincipalsFromDirectory,
  type CollectionSharePrincipal,
} from "@/lib/sharing/collection-share";
import type { MeetDirectoryGroup } from "@/lib/models/meet-types";
import { mapSettingsGroupsToTeamOptions } from "@/lib/sharing/team-owner-options";

export type MeetChatDirectory = {
  directory: CollectionSharePrincipal[];
  /** `undefined` when the Teams could not be loaded: not the same as "no Team". */
  groups?: MeetDirectoryGroup[];
};

function meetDirectoryGroupsFromSettings(
  groups: { id: string; displayName: string; isTeamAdmin?: boolean }[],
): MeetDirectoryGroup[] {
  return mapSettingsGroupsToTeamOptions(groups);
}

async function fetchMeetDirectoryGroups(): Promise<MeetDirectoryGroup[] | undefined> {
  try {
    const read = await wgwSettingsStateRead.read();
    if (!read.ok) return undefined;
    const settings = read.json as {
      groups?: { id: string; displayName: string; isTeamAdmin?: boolean }[];
    };
    return Array.isArray(settings.groups)
      ? meetDirectoryGroupsFromSettings(settings.groups)
      : undefined;
  } catch {
    return undefined;
  }
}

/** Best-effort — each source degrades to empty on failure, never throws. */
export async function fetchMeetChatDirectory(): Promise<MeetChatDirectory> {
  const [invitees, groups] = await Promise.all([
    fetchCalendarSchedulingInvitees()
      .then((response) => response.list)
      .catch(() => []),
    fetchMeetDirectoryGroups(),
  ]);
  const users = invitees
    .filter((invitee) => invitee.username?.trim())
    .map((invitee) => ({
      id: invitee.username,
      displayName: invitee.name?.trim() || invitee.username,
      sharesTeam: invitee.sharesTeam,
    }));
  return {
    directory: sharePrincipalsFromDirectory({ users, groups: groups ?? [] }),
    ...(groups !== undefined ? { groups } : {}),
  };
}
