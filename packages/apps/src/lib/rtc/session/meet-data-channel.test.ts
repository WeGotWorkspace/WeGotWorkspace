import { describe, expect, it, vi } from "vitest";
import {
  MEET_DATA_CHANNEL_ID,
  MEET_DATA_CHANNEL_INIT,
  MEET_UNRELIABLE_DATA_CHANNEL_ID,
  openMeetDataChannel,
  parseMeetDcMessage,
} from "@/lib/rtc/session/meet-data-channel";

const CLIENT_ID = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

describe("parseMeetDcMessage", () => {
  it("reads a chat frame and ignores a sender field", () => {
    expect(
      parseMeetDcMessage(
        JSON.stringify({
          t: "chat",
          id: CLIENT_ID,
          text: "hello",
          ts: 10,
          from: "forged",
          name: "Mallory",
        }),
      ),
    ).toEqual({ id: CLIENT_ID, text: "hello", ts: 10 });
  });

  it("ignores reserved and unknown types", () => {
    for (const t of ["vad", "caps", "rank", "sig", "nope"]) {
      expect(parseMeetDcMessage(JSON.stringify({ t, id: CLIENT_ID, text: "x", ts: 1 }))).toBeNull();
    }
    expect(parseMeetDcMessage("not-json")).toBeNull();
    expect(parseMeetDcMessage(JSON.stringify({ t: "chat", id: "", text: "x", ts: 1 }))).toBeNull();
  });
});

describe("openMeetDataChannel", () => {
  it("creates the negotiated meet channel and does not open id 2", () => {
    const createDataChannel = vi.fn(() => ({
      label: "meet",
      binaryType: "blob" as BinaryType,
      onmessage: null as ((event: MessageEvent) => void) | null,
    }));
    const pc = { createDataChannel } as unknown as RTCPeerConnection;
    const onText = vi.fn();
    const channel = openMeetDataChannel(pc, onText);

    expect(createDataChannel).toHaveBeenCalledTimes(1);
    expect(createDataChannel).toHaveBeenCalledWith("meet", MEET_DATA_CHANNEL_INIT);
    expect(MEET_DATA_CHANNEL_INIT.id).toBe(MEET_DATA_CHANNEL_ID);
    expect(MEET_DATA_CHANNEL_INIT.id).not.toBe(MEET_UNRELIABLE_DATA_CHANNEL_ID);

    channel.onmessage?.({
      data: JSON.stringify({ t: "chat", id: CLIENT_ID, text: "hi", ts: 1 }),
    } as MessageEvent);
    expect(onText).toHaveBeenCalledTimes(1);
    channel.onmessage?.({ data: new ArrayBuffer(4) } as MessageEvent);
    expect(onText).toHaveBeenCalledTimes(1);
  });
});
