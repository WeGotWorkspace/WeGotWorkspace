import type { ChatMessage } from "@/meet-core/src/meet-types";

export type MeetChatLine = {
  id: string;
  fromPeerId: string;
  fromName: string;
  body: string;
  ts: number;
  isSelf: boolean;
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
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
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
 * Skip local echoes (`isSelf`) — those already landed via `sendMessage`.
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
    if (line.isSelf) continue;
    const message = meetChatLineToChannelMessage(line, channelId);
    if (ids.has(message.id)) continue;
    ids.add(message.id);
    merged.push(message);
  }
  return merged.sort((a, b) => a.createdAt - b.createdAt);
}
