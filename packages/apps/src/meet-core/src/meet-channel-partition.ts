import { partitionOwnedAndShared } from "@/collection-sidebar/src/collection-sidebar-partition";
import { collectionsInProject, isProjectCollection } from "@/lib/projects/project-match";
import type { MeetChannel } from "@/lib/models/meet-types";

export type MeetChannelSections = {
  channels: MeetChannel[];
  shared: MeetChannel[];
  meetings: MeetChannel[];
  /** Project channels (#818): a group of their own, apart from the Team and named channels. */
  projects: MeetChannel[];
};

/**
 * My channels (owned channel) → Shared with me → Projects → Today’s meetings (owned meeting,
 * filtered to today in the workspace). Direct messages are directory people, not channels.
 * With a Project selected (`projectId`), that Project's channel and the chats of its Team
 * (`teamSlug`: the Team channel and the named channels the Team owns) are listed; other
 * Teams' channels, other Projects' channels and meetings are hidden.
 */
export function partitionMeetChannels(
  items: readonly MeetChannel[],
  projectId: string | null = null,
  teamSlug: string | null = null,
): MeetChannelSections {
  if (projectId !== null) {
    return {
      channels: partitionOwnedAndShared(items.filter((item) => isTeamChat(item, teamSlug))).owned,
      shared: [],
      meetings: [],
      projects: collectionsInProject(items, projectId),
    };
  }
  const { owned, shared } = partitionOwnedAndShared(
    items.filter((item) => !isProjectCollection(item)),
  );
  return {
    channels: owned.filter((item) => item.kind === "channel"),
    shared,
    meetings: owned.filter((item) => item.kind === "meeting"),
    projects: items.filter(isProjectCollection).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** A chat the Team owns (Team channel or named channel), not a Project channel or meeting. */
function isTeamChat(channel: MeetChannel, teamSlug: string | null): boolean {
  return (
    teamSlug !== null &&
    channel.kind === "channel" &&
    channel.scope === "group" &&
    channel.groupSlug === teamSlug &&
    !isProjectCollection(channel)
  );
}

/**
 * The channel to keep open under the Project filter: a channel the filter hides falls back
 * to the Project's channel (or none). DMs, the Team's chats and the Project channel stay open.
 */
export function meetSelectionUnderProject(
  selectedId: string | null,
  channels: readonly MeetChannel[],
  projectId: string | null,
  teamSlug: string | null = null,
): string | null {
  if (projectId === null || selectedId === null) return selectedId;
  const selected = channels.find((channel) => channel.id === selectedId);
  if (!selected || selected.projectId === projectId || isTeamChat(selected, teamSlug)) {
    return selectedId;
  }
  return channels.find((channel) => channel.projectId === projectId)?.id ?? null;
}

/** A Project channel's name and lifetime follow the Project: no rename, edit or delete here. */
export function meetChannelLockedByProject(channel: MeetChannel): boolean {
  return isProjectCollection(channel) || channel.myRights?.mayRename === false;
}
