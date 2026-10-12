import type { Dispatch, SetStateAction } from "react";
import { parseMeetDcMessage } from "@/lib/rtc/session/meet-data-channel";
import {
  appendMeetRoomChatLine,
  meetDataChatLine,
  type MeetChatLine,
} from "@/meet-core/src/meet-chat-line";
import { parseMeetControlMessage } from "@/meet-core/src/meet-control-messages";

/**
 * Apply one data-channel payload to the call chat. The sender is `remoteId`
 * (the connection it arrived on). The display name comes from the roster.
 * Control text is left for HTTP: admit stays server-recorded, and a data
 * channel must not run mute or end.
 */
export function acceptMeetDataChat(input: {
  remoteId: string;
  raw: string;
  selfPeerId: string | null;
  peerNames: ReadonlyMap<string, string>;
  setChatMessages: Dispatch<SetStateAction<MeetChatLine[]>>;
}): void {
  const chat = parseMeetDcMessage(input.raw);
  if (!chat || chat.text.trim() === "") return;
  if (parseMeetControlMessage(chat.text.trim())) return;
  const selfPeerId = input.selfPeerId;
  if (!selfPeerId || input.remoteId === selfPeerId) return;
  const fromName = input.peerNames.get(input.remoteId)?.trim() || "Peer";
  const line = meetDataChatLine(input.remoteId, fromName, chat, selfPeerId);
  input.setChatMessages((prev) => appendMeetRoomChatLine(prev, line));
}
