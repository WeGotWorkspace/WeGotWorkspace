import type { MeetChannel } from "@/lib/models/meet-types";

type LabeledChannel = Pick<MeetChannel, "name" | "kind"> &
  Partial<Pick<MeetChannel, "projectId" | "scope">>;

/** A Project or Team channel carries its name as written; personal channels read lowercased. */
export function meetChannelText(channel: LabeledChannel): string {
  if (channel.kind === "meeting" || channel.projectId || channel.scope === "group") {
    return channel.name;
  }
  return channel.name.toLowerCase();
}

export function meetChannelHashName(channel: LabeledChannel): string {
  return channel.kind === "meeting" ? channel.name : `# ${meetChannelText(channel)}`;
}

export function meetChannelTitle(channel: LabeledChannel): string {
  return channel.kind === "meeting" ? channel.name : `#${meetChannelText(channel)}`;
}

export function meetChannelTopicSubtitle(topic: string | null | undefined): string | undefined {
  const value = topic?.trim();
  return value ? `— ${value}` : undefined;
}

/** Meeting header meta line: relative When first, then the channel topic. */
export function meetMeetingHeaderSubtitle(
  relativeLabel: string | null | undefined,
  topic: string | null | undefined,
): string | undefined {
  const relative = relativeLabel?.trim() || undefined;
  const topicLine = meetChannelTopicSubtitle(topic);
  if (relative && topicLine) return `${relative} ${topicLine}`;
  return relative ?? topicLine;
}

export function meetChannelComposerPlaceholder(
  channel: Pick<MeetChannel, "name" | "kind">,
): string {
  return `Message ${meetChannelHashName(channel)}`;
}

export function meetChannelMemberCount(
  channel: Pick<MeetChannel, "memberCount" | "shareWith">,
): number {
  if (channel.memberCount != null) return channel.memberCount;
  return Object.keys(channel.shareWith ?? {}).length + 1;
}

export function meetChannelMatchesQuery(
  channel: Pick<MeetChannel, "name">,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const name = channel.name.toLowerCase();
  return name.includes(needle) || `#${name}`.includes(needle) || `# ${name}`.includes(needle);
}
