import type { ChatMessage } from "@/meet-core/src/meet-types";

/**
 * A channel write in flight plus the echo id its room copy has to carry. The
 * id is known before the write settles, which is what lets the live call post
 * the room copy immediately.
 */
export type MeetChannelChatSend = {
  /** Client ULID of the channel row, or null when none was minted. */
  echoId: string | null;
  saved: Promise<ChatMessage | null>;
};

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

/** Saved channel ids are ULIDs; mock and story operations mint their own slugs. */
const CHANNEL_CHAT_ECHO_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** `MeetSignalingService::chat` cuts room text at 2000 characters. */
export const MEET_ROOM_CHAT_TEXT_LIMIT = 2000;

/** Optimistic ids for a message the server has never seen (`local-<time>`). */
const LOCAL_MESSAGE_ID_PREFIX = "local-";

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

/**
 * The echo id names a saved channel row, so a peer can look it up. A
 * `local-…` placeholder names a row that exists in one browser only: it would
 * hide the line from every other member without them ever getting the save.
 */
export function meetRoomChatEchoId(messageId: string | null | undefined): string | null {
  const id = messageId?.trim() ?? "";
  if (id === "" || id.startsWith(LOCAL_MESSAGE_ID_PREFIX)) return null;
  return CHANNEL_CHAT_ECHO_ID.test(id) ? id : null;
}

/** Room text for a saved channel message, cut the way the signaling send cuts it. */
export function meetRoomChatEchoText(messageId: string, body: string): string {
  const text = buildMeetChannelChatEcho(messageId, body.trim());
  const chars = [...text];
  return chars.length <= MEET_ROOM_CHAT_TEXT_LIMIT
    ? text
    : chars.slice(0, MEET_ROOM_CHAT_TEXT_LIMIT).join("");
}

/**
 * The body a peer reads back from the echo of this channel row. A long row
 * loses its tail to the room limit, so the member column compares a room line
 * against this and not against the stored channel body.
 */
export function meetRoomChatEchoBody(messageId: string, body: string): string {
  return parseMeetChannelChatEcho(meetRoomChatEchoText(messageId, body))?.body ?? body.trim();
}
