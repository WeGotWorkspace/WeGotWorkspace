import { buildMeetChatLineFromPoll, type MeetChatLine } from "@/meet-core/src/meet-chat-line";
import type { ChatMessage } from "@/meet-core/src/meet-types";

/**
 * Room signaling echoes a saved channel message so guests, who only have
 * room lines, can read it. Members already receive that row through channel
 * sync, under the account principal. The echo is marked so the member column
 * skips that copy and does not paint the RTC peer id as a second author.
 * The line itself keeps a generated id, so a caller-supplied id cannot collide
 * with a channel row. The saved id is a
 * prefix because room text is truncated to 2000 characters; a trailing id
 * would be cut off a long body.
 */
const CHANNEL_CHAT_ECHO_PREFIX = "__wgw_meet_channel_chat__:";

/** Saved channel ids are ULIDs or local placeholders (`local-<time>`). */
const CHANNEL_CHAT_ECHO_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function buildMeetChannelChatEcho(messageId: string, body: string): string {
  return `${CHANNEL_CHAT_ECHO_PREFIX}${messageId}\n${body}`;
}

/**
 * Inbound room text from another peer. A miss returns null so the caller
 * shows the raw text; this never fetches, caches, or keys a limiter on the id.
 */
export function parseMeetChannelChatEcho(text: string): { id: string; body: string } | null {
  if (!text.startsWith(CHANNEL_CHAT_ECHO_PREFIX)) return null;
  const rest = text.slice(CHANNEL_CHAT_ECHO_PREFIX.length);
  const newline = rest.indexOf("\n");
  if (newline <= 0) return null;
  const id = rest.slice(0, newline);
  const body = rest.slice(newline + 1).trim();
  if (!CHANNEL_CHAT_ECHO_ID.test(id) || body === "") return null;
  return { id, body };
}

export function meetPollChatLine(
  fromPeerId: string,
  fromName: string,
  text: string,
  selfPeerId: string,
  now = Date.now(),
): MeetChatLine {
  const echo = parseMeetChannelChatEcho(text.trim());
  const line = buildMeetChatLineFromPoll(fromPeerId, fromName, echo?.body ?? text, selfPeerId, now);
  if (!echo) return line;
  return { ...line, channelMessageId: echo.id };
}

export async function meetRoomChatOutbound(
  text: string,
  persisted?: Promise<ChatMessage | null>,
): Promise<{ text: string; saved: boolean }> {
  if (!persisted) return { text, saved: false };
  try {
    const saved = await persisted;
    if (!saved) return { text, saved: false };
    const body = saved.body.trim();
    if (body === "" || !CHANNEL_CHAT_ECHO_ID.test(saved.id)) return { text, saved: true };
    return { text: buildMeetChannelChatEcho(saved.id, body), saved: true };
  } catch {
    return { text, saved: false };
  }
}
