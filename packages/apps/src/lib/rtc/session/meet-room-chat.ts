import {
  MEET_DATA_CHANNEL_LABEL,
  meetDcChatFrame,
  type MeetDcChat,
} from "@/lib/rtc/session/meet-data-channel";

export type MeetRoomChatMessage = MeetDcChat;

/**
 * Live-call delivery of one chat frame. A media server replaces this later;
 * the mesh is only today's implementation.
 */
export type MeetRoomChatDataPath = {
  sendRoomChat(message: MeetRoomChatMessage): void;
};

export type MeetRoomChatMesh = {
  getPeerIds(): readonly string[];
  getDataChannel(remoteId: string): RTCDataChannel | null;
  sendJsonTo(remoteId: string, message: unknown): void;
};

/** Fan a chat frame out to every peer whose Meet data channel is open. */
export function createMeshMeetRoomChat(mesh: MeetRoomChatMesh): MeetRoomChatDataPath {
  return {
    sendRoomChat(message) {
      const frame = meetDcChatFrame(message);
      for (const remoteId of mesh.getPeerIds()) {
        const channel = mesh.getDataChannel(remoteId);
        if (channel?.label !== MEET_DATA_CHANNEL_LABEL || channel.readyState !== "open") continue;
        mesh.sendJsonTo(remoteId, frame);
      }
    },
  };
}

/**
 * Chat goes out on the data path and always on HTTP. The HTTP post is the
 * fallback when no channel is open, and the copy receivers dedupe against.
 * Admit and other server-recorded control stay on HTTP; this function is chat.
 */
export async function sendRoomChat(input: {
  dataPath: MeetRoomChatDataPath;
  message: MeetRoomChatMessage;
  postHttp: () => Promise<unknown>;
}): Promise<void> {
  try {
    input.dataPath.sendRoomChat(input.message);
  } catch (error) {
    const message = error instanceof Error ? error.message : "data path failed";
    console.warn("[rtc] meet-room-chat data path failed", message);
  }
  await input.postHttp();
}
