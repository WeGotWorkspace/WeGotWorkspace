import { partitionOwnedAndShared } from "@/collection-sidebar/src/collection-sidebar-partition";
import type { MeetChannel } from "@/meet-core/src/meet-types";

export type MeetChannelSections = {
  channels: MeetChannel[];
  shared: MeetChannel[];
  meetings: MeetChannel[];
};

/** My channels (owned channel) → Shared with me → Upcoming meetings (owned meeting). Direct messages are directory people, not channels. */
export function partitionMeetChannels(items: readonly MeetChannel[]): MeetChannelSections {
  const { owned, shared } = partitionOwnedAndShared(items);
  return {
    channels: owned.filter((item) => item.kind === "channel"),
    shared,
    meetings: owned.filter((item) => item.kind === "meeting"),
  };
}
