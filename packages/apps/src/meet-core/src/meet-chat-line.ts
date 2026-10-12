import type { MeetDcChat } from "@/lib/rtc/session/meet-data-channel";
import {
  meetRoomChatEchoBody,
  parseMeetChannelChatEcho,
} from "@/meet-core/src/meet-channel-chat-echo";
import type { ChatMessage } from "@/meet-core/src/meet-types";

export type MeetChatLine = {
  id: string;
  fromPeerId: string;
  fromName: string;
  body: string;
  ts: number;
  isSelf: boolean;
  /** Saved channel message this room line echoes. Members already have that row. */
  channelMessageId?: string;
  /**
   * Client ULID shared by the data channel and the room echo.
   * Dedupe pairs this with `fromPeerId` — never the id on its own.
   */
  clientId?: string;
};

/** Guest in-channel rail uses MeetChatColumn; room poll lines are a thinner shape. */
export function meetChatLineToChannelMessage(line: MeetChatLine, channelId: string): ChatMessage {
  return {
    id: line.id,
    channelId,
    authorId: line.fromPeerId,
    authorName: line.fromName,
    body: line.body,
    createdAt: line.ts,
    reactions: [],
    mentions: [],
    previews: [],
  };
}

function createMeetChatLineId(fromPeerId: string, prefix = fromPeerId): string {
  const bytes = new Uint8Array(2);
  crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}-${Date.now()}-${suffix}`;
}

export function buildMeetChatLineFromPoll(
  fromPeerId: string,
  fromName: string,
  body: string,
  selfPeerId: string,
  now = Date.now(),
): MeetChatLine {
  return {
    id: createMeetChatLineId(fromPeerId),
    fromPeerId,
    fromName,
    body: body.trim(),
    ts: now,
    isSelf: fromPeerId === selfPeerId,
  };
}

/**
 * Inbound room text from another peer. A copy of a saved channel message keeps
 * the saved id beside the line, never as the line id, so a caller-supplied id
 * cannot collide with a channel row or a list key.
 */
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
  return { ...line, channelMessageId: echo.id, clientId: echo.id };
}

/** A data-channel chat line. `senderPeerId` is the connection, not a payload field. */
export function meetDataChatLine(
  senderPeerId: string,
  fromName: string,
  message: MeetDcChat,
  selfPeerId: string,
): MeetChatLine {
  const line = buildMeetChatLineFromPoll(
    senderPeerId,
    fromName,
    message.text,
    selfPeerId,
    message.ts,
  );
  return { ...line, clientId: message.id, channelMessageId: message.id, ts: message.ts };
}

/**
 * Keep the first line for a (sender peer id, client ULID) pair.
 * The same ULID from another peer is a different message.
 */
export function appendMeetRoomChatLine(lines: MeetChatLine[], line: MeetChatLine): MeetChatLine[] {
  if (
    line.clientId &&
    lines.some(
      (existing) => existing.clientId === line.clientId && existing.fromPeerId === line.fromPeerId,
    )
  ) {
    return lines;
  }
  return [...lines, line];
}

export function buildLocalMeetChatLine(
  fromPeerId: string,
  fromName: string,
  body: string,
  now = Date.now(),
): MeetChatLine {
  return {
    id: createMeetChatLineId(fromPeerId, "me"),
    fromPeerId,
    fromName,
    body: body.trim(),
    ts: now,
    isSelf: true,
  };
}

/**
 * Host channel collection + guest room-poll lines share one MeetChatColumn.
 * A copy of a saved channel message is marked with `channelMessageId` and is
 * hidden only once the collection holds that row with the same body: members
 * already have it under the account principal. The id alone is not enough —
 * any peer can name a real message and send different text, which members
 * would then never see. Every other room line is shown once: a guest, a
 * signed-in person admitted from the lobby, a channel send still in flight,
 * or one that never saved. Copies stay in the call store so guests, who have
 * no channel collection, can still read them.
 */
export function mergeMeetRoomChatIntoChannel(
  channelMessages: ChatMessage[],
  roomLines: readonly MeetChatLine[],
  channelId: string,
): ChatMessage[] {
  if (roomLines.length === 0) return channelMessages;
  const byId = new Map(channelMessages.map((message) => [message.id, message]));
  const merged = [...channelMessages];
  for (const line of roomLines) {
    const echoed = line.channelMessageId ? byId.get(line.channelMessageId) : undefined;
    if (echoed && line.body.trim() === meetRoomChatEchoBody(echoed.id, echoed.body)) continue;
    const message = meetChatLineToChannelMessage(line, channelId);
    if (byId.has(message.id)) continue;
    byId.set(message.id, message);
    merged.push(message);
  }
  return merged.sort((a, b) => a.createdAt - b.createdAt);
}
