/**
 * Workspace principal directory for the live Meet chat workspace: mention
 * targets, DM rail people, and the share-dialog suggestion fallback. Reuses the
 * existing principal surfaces (scheduling invitees + settings groups) — the
 * live share *search* stays on `searchCollectionSharePrincipals`.
 */
import { fetchCalendarSchedulingInvitees } from "@/lib/api/wgw/calendar-scheduling";
import { wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import {
  sharePrincipalsFromDirectory,
  type CollectionSharePrincipal,
} from "@/share-ui/collection-share";
import type { MeetDirectoryGroup } from "@/meet-core/src/meet-types";

const GROUP_PRINCIPAL_PREFIX = "principals/groups/";

export type MeetChatDirectory = {
  directory: CollectionSharePrincipal[];
  groups: MeetDirectoryGroup[];
};

function meetDirectoryGroupsFromSettings(
  groups: { id: string; displayName: string }[],
): MeetDirectoryGroup[] {
  return groups.map((group) => {
    const slug = group.id.startsWith(GROUP_PRINCIPAL_PREFIX)
      ? group.id.slice(GROUP_PRINCIPAL_PREFIX.length)
      : group.id;
    return { slug, displayName: group.displayName?.trim() || slug };
  });
}

async function fetchMeetDirectoryGroups(): Promise<MeetDirectoryGroup[]> {
  try {
    const res = await wgwFetch("/settings/state");
    if (!res.ok) return [];
    const settings = (await wgwReadJson(res)) as {
      groups?: { id: string; displayName: string }[];
    };
    return Array.isArray(settings.groups) ? meetDirectoryGroupsFromSettings(settings.groups) : [];
  } catch {
    return [];
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
    }));
  return { directory: sharePrincipalsFromDirectory({ users, groups }), groups };
}
