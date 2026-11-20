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
 * With a Project selected (`projectId`), only that Project's channel is listed.
 */
export function partitionMeetChannels(
  items: readonly MeetChannel[],
  projectId: string | null = null,
): MeetChannelSections {
  if (projectId !== null) {
    return {
      channels: [],
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

/**
 * The channel to keep open under the Project filter: a channel the filter hides falls back
 * to the Project's channel (or none). DMs and listed channels stay open.
 */
export function meetSelectionUnderProject(
  selectedId: string | null,
  channels: readonly MeetChannel[],
  projectId: string | null,
): string | null {
  if (projectId === null || selectedId === null) return selectedId;
  const selected = channels.find((channel) => channel.id === selectedId);
  if (!selected || selected.projectId === projectId) return selectedId;
  return channels.find((channel) => channel.projectId === projectId)?.id ?? null;
}

/** A Project channel's name and lifetime follow the Project: no rename, edit or delete here. */
export function meetChannelLockedByProject(channel: MeetChannel): boolean {
  return isProjectCollection(channel) || channel.myRights?.mayRename === false;
}
