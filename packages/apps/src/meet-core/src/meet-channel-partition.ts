import { partitionOwnedAndShared } from "@/collection-sidebar/src/collection-sidebar-partition";
import { isPersonalScope, PERSONAL_PROJECT_ID } from "@/lib/projects/project-filter";
import { collectionsInProject, isProjectCollection } from "@/lib/projects/project-match";
import type { MeetChannel } from "@/lib/models/meet-types";

export type MeetChannelSections = {
  channels: MeetChannel[];
  shared: MeetChannel[];
  meetings: MeetChannel[];
  /** Project channels (#818): a group of their own, apart from the Team and named channels. */
  projects: MeetChannel[];
  /** With a Project selected: the chats of its Team, a section of their own. */
  teamChats: MeetChannel[];
};

/**
 * My channels (owned channel) → Shared with me → Projects → Today’s meetings (owned meeting,
 * filtered to today in the workspace). Direct messages are directory people, not channels.
 * With a Project or a Team selected (`projectIds`: the Projects in scope), their channels and the chats of its Team
 * (`teamSlug`: the Team channel and the named channels the Team owns) are listed; other
 * Teams' channels, other Projects' channels and meetings are hidden.
 */
export function partitionMeetChannels(
  items: readonly MeetChannel[],
  projectIds: string | readonly string[] | null = null,
  teamSlug: string | null = null,
): MeetChannelSections {
  if (projectIds !== null && !isPersonalScope(projectIds)) {
    return {
      channels: [],
      shared: [],
      meetings: [],
      projects: collectionsInProject(items.filter(isProjectCollection), projectIds).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      teamChats: partitionOwnedAndShared(
        items.filter((item) => isTeamChat(item) && item.groupSlug === teamSlug),
      ).owned,
    };
  }
  const { owned, shared } = partitionOwnedAndShared(
    items.filter((item) => !isProjectCollection(item) && !isTeamChat(item)),
  );
  // "Personal": the user's own chats and meetings; Team chats and Project channels are out.
  const personal = isPersonalScope(projectIds);
  return {
    channels: owned.filter((item) => item.kind === "channel"),
    shared,
    teamChats: personal
      ? []
      : partitionOwnedAndShared(items.filter(isTeamChat)).owned.sort(
          (x, y) =>
            x.name.localeCompare(y.name) || (x.groupSlug ?? "").localeCompare(y.groupSlug ?? ""),
        ),
    meetings: owned.filter((item) => item.kind === "meeting"),
    projects: personal
      ? []
      : items.filter(isProjectCollection).sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** A chat a Team owns (Team channel or the Team's named channel), not a Project channel or meeting. */
export function isTeamChat(channel: MeetChannel): boolean {
  return channel.kind === "channel" && channel.scope === "group" && !isProjectCollection(channel);
}

/**
 * The channel to keep open under the Project filter: a channel the filter hides falls back
 * to the Project's channel (or none). DMs, the Team's chats and the Project channel stay open.
 */
export function meetSelectionUnderProject(
  selectedId: string | null,
  channels: readonly MeetChannel[],
  projectIds: string | readonly string[] | null,
  teamSlug: string | null = null,
): string | null {
  if (projectIds === null || selectedId === null) return selectedId;
  const ids = typeof projectIds === "string" ? [projectIds] : projectIds;
  const inScope = (channel: MeetChannel) => ids.includes(channel.projectId ?? PERSONAL_PROJECT_ID);
  const selected = channels.find((channel) => channel.id === selectedId);
  if (
    !selected ||
    inScope(selected) ||
    (isTeamChat(selected) && teamSlug !== null && selected.groupSlug === teamSlug)
  ) {
    return selectedId;
  }
  return channels.find(inScope)?.id ?? null;
}

/**
 * A Project channel's name and lifetime follow the Project, and a Team's own channel is named
 * after the Team: no rename, edit or delete here.
 */
export function meetChannelLockedByProject(channel: MeetChannel): boolean {
  return (
    isProjectCollection(channel) ||
    channel.isDefault === true ||
    channel.myRights?.mayRename === false
  );
}
