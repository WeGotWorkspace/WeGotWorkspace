import type { MeetChannel } from "@/meet-core/src/meet-types";

export function meetChannelHashName(channel: Pick<MeetChannel, "name" | "kind">): string {
  if (channel.kind === "meeting") return channel.name;
  return `# ${channel.name.toLowerCase()}`;
}

export function meetChannelTitle(channel: Pick<MeetChannel, "name" | "kind">): string {
  if (channel.kind === "meeting") return channel.name;
  return `#${channel.name.toLowerCase()}`;
}

export function meetChannelTopicSubtitle(topic: string | null | undefined): string | undefined {
  const value = topic?.trim();
  return value ? `— ${value}` : undefined;
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
