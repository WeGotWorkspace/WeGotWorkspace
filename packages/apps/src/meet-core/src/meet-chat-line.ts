import type { ChatMessage } from "@/meet-core/src/meet-types";

export type MeetChatLine = {
  id: string;
  fromPeerId: string;
  fromName: string;
  body: string;
  ts: number;
  isSelf: boolean;
  /**
   * Signed-in peer. Their channel row uses the account principal as `authorId`.
   * This line's `fromPeerId` is only the RTC id.
   */
  accountPeer?: boolean;
  /** Saved channel message this room line echoes. Members already have that row. */
  channelMessageId?: string;
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
  id?: string,
): MeetChatLine {
  return {
    id: id ?? createMeetChatLineId(fromPeerId),
    fromPeerId,
    fromName,
    body: body.trim(),
    ts: now,
    isSelf: fromPeerId === selfPeerId,
  };
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
 * A signed-in peer's room line uses the RTC peer id as `fromPeerId`. Mapping
 * that id through `authorId` paints a second avatar (color and presence are
 * keyed by author id) for a message the channel collection already delivers
 * under the account principal. Those lines stay in the call store so guests,
 * who have no channel collection, can still read them. An edit or delete
 * keeps the channel row.
 */
export function mergeMeetRoomChatIntoChannel(
  channelMessages: ChatMessage[],
  roomLines: readonly MeetChatLine[],
  channelId: string,
): ChatMessage[] {
  if (roomLines.length === 0) return channelMessages;
  const ids = new Set(channelMessages.map((message) => message.id));
  const merged = [...channelMessages];
  for (const line of roomLines) {
    if (line.accountPeer || line.channelMessageId) continue;
    const message = meetChatLineToChannelMessage(line, channelId);
    if (ids.has(message.id)) continue;
    ids.add(message.id);
    merged.push(message);
  }
  return merged.sort((a, b) => a.createdAt - b.createdAt);
}
