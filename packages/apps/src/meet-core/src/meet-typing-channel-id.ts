import {
  MEET_DM_CHANNEL_PREFIX,
  isMeetDirectMessageChannelId,
  meetDirectMessageChannelId,
} from "@/meet-core/src/meet-direct-messages";

/**
 * Shared typing-map key for a conversation.
 *
 * Channel ids pass through. Virtual DM rail ids (`dm:{peer}`) are different
 * for each participant, so both sides canonicalize to `dm:{a}:{b}` with the
 * two usernames sorted — otherwise A broadcasts on `dm:bob` while B looks up
 * `dm:alice` and never sees the indicator.
 */
export function meetTypingChannelId(
  channelId: string,
  selfUsername: string | null | undefined,
): string {
  if (!channelId || !selfUsername || !isMeetDirectMessageChannelId(channelId)) {
    return channelId;
  }
  const rest = channelId.slice(MEET_DM_CHANNEL_PREFIX.length);
  if (!rest || rest.includes(":")) return channelId;
  if (rest === selfUsername) return channelId;
  const [left, right] = [selfUsername, rest].sort();
  return `${MEET_DM_CHANNEL_PREFIX}${left}:${right}`;
}

/**
 * Index a canonical `dm:{a}:{b}` typing row under both virtual rail ids so the
 * workspace can keep looking up `typingByChannel[selectedId]`.
 */
export function expandMeetTypingChannelKeys(
  typingByChannel: Record<string, string[]>,
): Record<string, string[]> {
  const expanded: Record<string, string[]> = { ...typingByChannel };
  for (const [key, usernames] of Object.entries(typingByChannel)) {
    if (!isMeetDirectMessageChannelId(key)) continue;
    const rest = key.slice(MEET_DM_CHANNEL_PREFIX.length);
    const separator = rest.indexOf(":");
    if (separator <= 0 || separator === rest.length - 1) continue;
    const left = rest.slice(0, separator);
    const right = rest.slice(separator + 1);
    if (!left || !right || right.includes(":")) continue;
    expanded[meetDirectMessageChannelId(left)] = usernames;
    expanded[meetDirectMessageChannelId(right)] = usernames;
  }
  return expanded;
}
