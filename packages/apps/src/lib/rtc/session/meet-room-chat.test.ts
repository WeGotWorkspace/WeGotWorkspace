import { describe, expect, it, vi } from "vitest";
import { meetRoomChatEchoText } from "@/meet-core/src/meet-channel-chat-echo";
import {
  appendMeetRoomChatLine,
  meetDataChatLine,
  meetPollChatLine,
  type MeetChatLine,
} from "@/meet-core/src/meet-chat-line";
import { parseMeetDcMessage } from "@/lib/rtc/session/meet-data-channel";
import { createMeshMeetRoomChat, sendRoomChat } from "@/lib/rtc/session/meet-room-chat";

const CLIENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

function deliver(
  readyState: RTCDataChannelState,
  onRemote: (raw: string) => void,
): {
  path: ReturnType<typeof createMeshMeetRoomChat>;
  sent: number;
} {
  let sent = 0;
  const channel = {
    label: "meet",
    readyState,
    send: (raw: string) => {
      sent += 1;
      onRemote(raw);
    },
  } as RTCDataChannel;
  const path = createMeshMeetRoomChat({
    getPeerIds: () => ["peer-2"],
    getDataChannel: () => channel,
    sendJsonTo: (_remoteId, message) => {
      channel.send(JSON.stringify(message));
    },
  });
  return {
    path,
    get sent() {
      return sent;
    },
  };
}

function applyHttp(lines: MeetChatLine[], fromPeerId: string, text: string): MeetChatLine[] {
  return appendMeetRoomChatLine(lines, meetPollChatLine(fromPeerId, "Ada", text, "self-1", 20));
}

describe("sendRoomChat", () => {
  it("delivers guest chat over an open channel in under 300ms and once when the channel is blocked", async () => {
    const lines: MeetChatLine[] = [];
    const open = deliver("open", (raw) => {
      const chat = parseMeetDcMessage(raw);
      if (!chat) return;
      lines.push(
        ...appendMeetRoomChatLine(lines, meetDataChatLine("peer-2", "Ada", chat, "self-1")).slice(
          lines.length,
        ),
      );
    });
    const http = vi.fn(async () => undefined);
    const started = performance.now();
    await sendRoomChat({
      dataPath: open.path,
      message: { id: CLIENT_ID, text: "hello", ts: 10 },
      postHttp: http,
    });
    expect(performance.now() - started).toBeLessThan(300);
    expect(open.sent).toBe(1);
    expect(http).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      fromPeerId: "peer-2",
      fromName: "Ada",
      body: "hello",
      clientId: CLIENT_ID,
    });

    const afterHttp = applyHttp(lines, "peer-2", meetRoomChatEchoText(CLIENT_ID, "hello"));
    expect(afterHttp).toHaveLength(1);
    expect(afterHttp).toBe(lines);

    const blockedLines: MeetChatLine[] = [];
    const blocked = deliver("connecting", () => {
      throw new Error("blocked channel must not deliver");
    });
    const blockedHttp = vi.fn(async () => {
      blockedLines.push(...applyHttp([], "peer-2", meetRoomChatEchoText(CLIENT_ID, "hello")));
    });
    await sendRoomChat({
      dataPath: blocked.path,
      message: { id: CLIENT_ID, text: "hello", ts: 10 },
      postHttp: blockedHttp,
    });
    expect(blocked.sent).toBe(0);
    expect(blockedLines).toHaveLength(1);
    expect(blockedLines[0]?.body).toBe("hello");
  });
});
