import { describe, expect, it, vi } from "vitest";
import { createDataBinding } from "@/lib/rtc/session/bindings";
import {
  BINARY_FRAME_BYTES,
  BINARY_FRAME_HEADER_BYTES,
  DATA_CHANNEL_BUFFER_HIGH_WATER_BYTES,
  decodeBinaryFrame,
  encodeBinaryFrames,
  FrameReassembler,
  MAX_MESSAGE_FRAMES,
  MAX_PENDING_BYTES_PER_REMOTE,
  PENDING_MESSAGE_TTL_MS,
} from "@/lib/rtc/session/data-channel-frames";
import { MeshPeerRegistry, type MeshPeerEntry } from "@/lib/rtc/session/mesh-peer-registry";

/** Chrome refuses one data-channel message above this size. */
const MAX_SCTP_MESSAGE_BYTES = 256 * 1024;

/** Each binary frame, header included, stays at or under this size. */
const MAX_FRAME_BYTES = 16 * 1024;

type CappedChannel = {
  readyState: string;
  bufferedAmount: number;
  bufferedAmountLowThreshold: number;
  binaryType: string;
  frames: Array<string | Uint8Array>;
  lowListeners: Set<() => void>;
  send: (data: string | Uint8Array | ArrayBuffer) => void;
  onmessage: ((event: MessageEvent) => void) | null;
};

/**
 * Mock data channel that enforces the 256 KiB SCTP cap and delivers accepted
 * sends to `onmessage` the way a browser does (`binaryType = "arraybuffer"`).
 */
function createCappedChannel(): CappedChannel {
  const channel = {
    readyState: "open",
    bufferedAmount: 0,
    bufferedAmountLowThreshold: 0,
    binaryType: "arraybuffer",
    frames: [] as Array<string | Uint8Array>,
    lowListeners: new Set<() => void>(),
    onopen: null,
    onclose: null,
    onmessage: null as ((event: MessageEvent) => void) | null,
    onbufferedamountlow: null,
    send(data: string | Uint8Array | ArrayBuffer) {
      const size = messageByteLength(data);
      if (size > MAX_SCTP_MESSAGE_BYTES) {
        throw new DOMException("The message is too large.", "OperationError");
      }
      channel.frames.push(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
      const eventData =
        typeof data === "string"
          ? data
          : data instanceof Uint8Array
            ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
            : data;
      channel.onmessage?.({ data: eventData } as MessageEvent);
    },
    close() {
      channel.readyState = "closed";
    },
    addEventListener(type: string, listener: () => void) {
      if (type === "bufferedamountlow") channel.lowListeners.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      if (type === "bufferedamountlow") channel.lowListeners.delete(listener);
    },
    dispatchEvent() {
      return true;
    },
  };
  return channel as unknown as CappedChannel;
}

function messageByteLength(data: string | Uint8Array | ArrayBuffer): number {
  if (typeof data === "string") return new TextEncoder().encode(data).byteLength;
  if (data instanceof Uint8Array) return data.byteLength;
  return data.byteLength;
}

type ReceivedMessage = { json: string; payload: Uint8Array | null };

/** Raw tail about 300 KB — over the 256 KiB SCTP cap when sent as one message. */
function largeSyncPayload(): Uint8Array {
  const payload = new Uint8Array(300_000);
  payload.fill(200);
  return payload;
}

describe("large Yjs state over a capped data channel", () => {
  it("delivers a ~300 KB update to the second peer in frames of 16 KiB or less", async () => {
    const payload = largeSyncPayload();
    const header = { type: "sync", bin: 1 };
    expect(payload.byteLength).toBeGreaterThan(MAX_SCTP_MESSAGE_BYTES);

    const received: ReceivedMessage[] = [];
    const channel = createCappedChannel();
    const binding = createDataBinding({
      label: "collab",
      onMessage: (_remoteId, json, tail) => {
        received.push({ json, payload: tail });
      },
    });
    const pc = {
      createDataChannel: () => channel,
    } as unknown as RTCPeerConnection;
    const attached = binding.attachInitiator(pc, "peer-b");

    const registry = new MeshPeerRegistry(binding);
    const entry: MeshPeerEntry = {
      name: "Bob",
      pc,
      mode: "direct",
      relayFallbackTried: false,
      initiator: true,
      pendingIce: [],
      signalSent: true,
      dataChannel: attached,
    };
    registry.add("peer-b", entry);

    registry.sendJsonTo("peer-b", header, payload);

    await vi.waitFor(
      () => {
        expect(received).toEqual([{ json: JSON.stringify(header), payload }]);
      },
      { timeout: 200 },
    );

    expect(channel.frames.length).toBeGreaterThan(1);
    const decoded = channel.frames.map((frame) => {
      expect(frame).toBeInstanceOf(Uint8Array);
      const bytes = frame as Uint8Array;
      expect(bytes.byteLength).toBeLessThanOrEqual(MAX_FRAME_BYTES);
      return decodeBinaryFrame(bytes);
    });
    const count = decoded.length;
    decoded.forEach((frame, index) => {
      expect(frame).toMatchObject({ messageId: 1, index, count });
    });
  });

  it("frames a collab-reuse data envelope with the tail outside the JSON", async () => {
    const payload = largeSyncPayload();
    const envelope = {
      v: 1 as const,
      kind: "collab-reuse" as const,
      room: "docs/notes.md",
      op: "data" as const,
      collabPeerId: "aaaaaaaaaaaaaaaa",
      payload: { type: "sync", bin: 1 },
    };

    const received: ReceivedMessage[] = [];
    const { registry, channel } = openPeer(received);
    registry.sendJsonTo("peer-b", envelope, payload);

    await vi.waitFor(
      () => expect(received).toEqual([{ json: JSON.stringify(envelope), payload }]),
      { timeout: 200 },
    );
    expect(channel.frames.length).toBeGreaterThan(1);
    expect(channel.frames.every((frame) => frame instanceof Uint8Array)).toBe(true);
    expect(JSON.stringify(envelope)).not.toContain('"u"');
  });

  it("frames a message for a peer that does not advertise bin", () => {
    const received: ReceivedMessage[] = [];
    const { registry, channel } = openPeer(received);
    const payload = Uint8Array.of(1, 2, 3);
    const header = { type: "sync", bin: 1 };
    registry.sendJsonTo("peer-b", header, payload);

    expect(channel.frames.every((frame) => frame instanceof Uint8Array)).toBe(true);
    expect(received).toEqual([{ json: JSON.stringify(header), payload }]);
  });

  it("frames the first sync when caps were stored before the peer entry existed", () => {
    const received: ReceivedMessage[] = [];
    const channel = createCappedChannel();
    const binding = createDataBinding({
      label: "collab",
      onMessage: (_remoteId, json, tail) => {
        received.push({ json, payload: tail });
      },
    });
    const pc = {
      createDataChannel: () => channel,
    } as unknown as RTCPeerConnection;
    const attached = binding.attachInitiator(pc, "peer-b");
    const registry = new MeshPeerRegistry(binding);
    const header = { type: "sync", bin: 1 };
    const payload = Uint8Array.of(1, 2, 3);

    registry.rememberCaps("peer-b", ["yjs-http"]);
    registry.add("peer-b", peerEntry(pc, attached));
    registry.sendJsonTo("peer-b", header, payload);

    expect(channel.frames[0]).toBeInstanceOf(Uint8Array);
    expect(registry.get("peer-b")?.caps).toEqual(["yjs-http"]);
    expect(received).toEqual([{ json: JSON.stringify(header), payload }]);
  });

  it("pauses above 1 MiB buffered and resumes on bufferedamountlow", () => {
    const received: ReceivedMessage[] = [];
    const { registry, channel } = openPeer(received);
    channel.bufferedAmount = DATA_CHANNEL_BUFFER_HIGH_WATER_BYTES + 1;
    const header = { type: "sync", bin: 1 };
    const payload = Uint8Array.of(1, 2, 3);

    registry.sendJsonTo("peer-b", header, payload);

    expect(channel.frames).toEqual([]);
    expect(channel.bufferedAmountLowThreshold).toBe(DATA_CHANNEL_BUFFER_HIGH_WATER_BYTES);
    expect(channel.lowListeners.size).toBe(1);

    channel.bufferedAmount = 0;
    for (const listener of channel.lowListeners) listener();

    expect(received).toEqual([{ json: JSON.stringify(header), payload }]);
    expect(channel.frames.every((frame) => frame instanceof Uint8Array)).toBe(true);
  });

  it("logs a send failure and reports the peer for resync", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onSendFailed = vi.fn();
    const received: ReceivedMessage[] = [];
    const { registry, channel } = openPeer(received, undefined, onSendFailed);
    channel.send = () => {
      throw new Error("send failed");
    };

    registry.sendJsonTo("peer-b", { type: "sync", bin: 1 }, Uint8Array.of(1));

    expect(received).toEqual([]);
    expect(onSendFailed).toHaveBeenCalledWith("peer-b", expect.any(Error));
    expect(warn).toHaveBeenCalledWith(
      "[rtc] datachannel-send-failed",
      expect.objectContaining({ remoteId: "peer-b", message: "send failed" }),
    );
  });
});

function binaryFrame(
  messageId: number,
  index: number,
  count: number,
  payload: string | Uint8Array,
): Uint8Array {
  const body = typeof payload === "string" ? new TextEncoder().encode(payload) : payload;
  const frame = new Uint8Array(BINARY_FRAME_HEADER_BYTES + body.byteLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, messageId >>> 0);
  view.setUint16(4, index);
  view.setUint16(6, count);
  frame.set(body, BINARY_FRAME_HEADER_BYTES);
  return frame;
}

function manualClock(start = 0): { now: () => number; set: (value: number) => void } {
  let current = start;
  return {
    now: () => current,
    set(value: number) {
      current = value;
    },
  };
}

describe("FrameReassembler pending bounds", () => {
  it("drops an incomplete message after the ttl on the next push for that remote", () => {
    const clock = manualClock(1_000);
    const reassembler = new FrameReassembler(clock.now);

    expect(reassembler.push("remote-a", binaryFrame(1, 0, 2, "aa"))).toBeNull();

    clock.set(1_000 + PENDING_MESSAGE_TTL_MS + 1_000);
    expect(reassembler.push("remote-a", binaryFrame(2, 0, 1, "zz"))).toEqual(textBytes("zz"));
    expect(reassembler.push("remote-a", binaryFrame(1, 1, 2, "bb"))).toBeNull();
  });

  it("drops the oldest incomplete message when a remote exceeds the pending cap", () => {
    const clock = manualClock(1_000);
    const reassembler = new FrameReassembler(clock.now);

    for (let messageId = 1; messageId <= 5; messageId += 1) {
      clock.set(1_000 + messageId);
      expect(reassembler.push("remote-a", binaryFrame(messageId, 0, 2, "p"))).toBeNull();
    }

    // Finish the survivor first. Probing the evicted id opens a new message and would drop the next oldest.
    expect(reassembler.push("remote-a", binaryFrame(2, 1, 2, "q"))).toEqual(textBytes("pq"));
    expect(reassembler.push("remote-a", binaryFrame(1, 1, 2, "q"))).toBeNull();
  });

  it("rejects a frame count above the ceiling and does not open a pending entry", () => {
    const count = MAX_MESSAGE_FRAMES + 1;
    const illegal = binaryFrame(1, 0, count, "x");
    expect(decodeBinaryFrame(illegal)).toBeNull();

    const payloadBytes = BINARY_FRAME_BYTES - BINARY_FRAME_HEADER_BYTES;
    expect(encodeBinaryFrames(new Uint8Array(MAX_MESSAGE_FRAMES * payloadBytes), 4)).toHaveLength(
      MAX_MESSAGE_FRAMES,
    );
    expect(() => encodeBinaryFrames(new Uint8Array(count * payloadBytes), 4)).toThrow(
      /frame count/,
    );

    const reassembler = new FrameReassembler(() => 0);
    for (let messageId = 1; messageId <= 4; messageId += 1) {
      expect(reassembler.push("remote-a", binaryFrame(messageId, 0, 2, "a"))).toBeNull();
    }
    expect(reassembler.push("remote-a", illegal)).toBeNull();
    for (let messageId = 1; messageId <= 4; messageId += 1) {
      expect(reassembler.push("remote-a", binaryFrame(messageId, 1, 2, "b"))).toEqual(
        textBytes("ab"),
      );
    }
  });

  it("drops the oldest incomplete message when a remote exceeds the pending byte budget", () => {
    const payloadBytes = BINARY_FRAME_BYTES - BINARY_FRAME_HEADER_BYTES;
    const chunk = new Uint8Array(payloadBytes);
    const perMessage = 400;
    const count = perMessage + 1;
    expect(perMessage * payloadBytes * 2).toBeLessThan(MAX_PENDING_BYTES_PER_REMOTE);
    expect(perMessage * payloadBytes * 4).toBeGreaterThan(MAX_PENDING_BYTES_PER_REMOTE);
    const clock = manualClock(1_000);
    const reassembler = new FrameReassembler(clock.now);

    for (let messageId = 1; messageId <= 4; messageId += 1) {
      clock.set(1_000 + messageId);
      for (let index = 0; index < perMessage; index += 1) {
        expect(
          reassembler.push("remote-a", binaryFrame(messageId, index, count, chunk)),
        ).toBeNull();
      }
    }

    expectZeroPayload(
      reassembler.push("remote-a", binaryFrame(4, perMessage, count, chunk)),
      payloadBytes * count,
    );
    expect(reassembler.push("remote-a", binaryFrame(1, perMessage, count, chunk))).toBeNull();
  });

  it("finishes a message larger than the byte budget and drops the other one", () => {
    const payloadBytes = BINARY_FRAME_BYTES - BINARY_FRAME_HEADER_BYTES;
    const chunk = new Uint8Array(payloadBytes);
    const framesOverBudget = Math.floor(MAX_PENDING_BYTES_PER_REMOTE / payloadBytes) + 1;
    const count = framesOverBudget + 1;
    expect(framesOverBudget * payloadBytes).toBeGreaterThan(MAX_PENDING_BYTES_PER_REMOTE);
    expect(count).toBeLessThanOrEqual(MAX_MESSAGE_FRAMES);
    const clock = manualClock(1_000);
    const reassembler = new FrameReassembler(clock.now);

    for (let index = 0; index < framesOverBudget; index += 1) {
      expect(reassembler.push("remote-a", binaryFrame(1, index, count, chunk))).toBeNull();
    }

    clock.set(2_000);
    for (let index = 0; index < framesOverBudget; index += 1) {
      expect(reassembler.push("remote-a", binaryFrame(2, index, count, chunk))).toBeNull();
    }
    expectZeroPayload(
      reassembler.push("remote-a", binaryFrame(2, framesOverBudget, count, chunk)),
      payloadBytes * count,
    );
    expect(reassembler.push("remote-a", binaryFrame(1, framesOverBudget, count, chunk))).toBeNull();
  });

  it("reassembles a three-frame message when chunks arrive out of order", () => {
    const frames = ["one", "two", "three"].map((part, index) => binaryFrame(9, index, 3, part));
    const reassembler = new FrameReassembler();

    expect(reassembler.push("remote-a", frames[2]!)).toBeNull();
    expect(reassembler.push("remote-a", frames[0]!)).toBeNull();
    expect(reassembler.push("remote-a", frames[1]!)).toEqual(textBytes("onetwothree"));
  });

  it("does not expire another remote's incomplete message", () => {
    const clock = manualClock(0);
    const reassembler = new FrameReassembler(clock.now);

    expect(reassembler.push("remote-a", binaryFrame(1, 0, 2, "a"))).toBeNull();
    clock.set(1);
    expect(reassembler.push("remote-b", binaryFrame(1, 0, 2, "b"))).toBeNull();

    clock.set(PENDING_MESSAGE_TTL_MS + 2);
    expect(reassembler.push("remote-b", binaryFrame(2, 0, 1, "z"))).toEqual(textBytes("z"));

    clock.set(0);
    expect(reassembler.push("remote-a", binaryFrame(1, 1, 2, "c"))).toEqual(textBytes("ac"));
  });

  it("uses the latest bytes when the same chunk index arrives twice", () => {
    const reassembler = new FrameReassembler();

    expect(reassembler.push("remote-a", binaryFrame(1, 0, 2, "aa"))).toBeNull();
    expect(reassembler.push("remote-a", binaryFrame(1, 0, 2, "b"))).toBeNull();
    expect(reassembler.push("remote-a", binaryFrame(1, 1, 2, "c"))).toEqual(textBytes("bc"));
  });
});

function peerEntry(pc: RTCPeerConnection, dataChannel: RTCDataChannel): MeshPeerEntry {
  return {
    name: "Bob",
    pc,
    mode: "direct",
    relayFallbackTried: false,
    initiator: true,
    pendingIce: [],
    signalSent: true,
    dataChannel,
  };
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function expectZeroPayload(actual: Uint8Array | null, byteLength: number): void {
  expect(actual).toBeInstanceOf(Uint8Array);
  expect(actual?.byteLength).toBe(byteLength);
  expect(actual?.every((byte) => byte === 0)).toBe(true);
}

function openPeer(
  received: ReceivedMessage[],
  caps?: readonly string[],
  onSendFailed?: (remoteId: string, error: unknown) => void,
): { registry: MeshPeerRegistry; channel: CappedChannel } {
  const channel = createCappedChannel();
  const binding = createDataBinding({
    label: "collab",
    onMessage: (_remoteId, json, payload) => {
      received.push({ json, payload });
    },
  });
  const pc = {
    createDataChannel: () => channel,
  } as unknown as RTCPeerConnection;
  const attached = binding.attachInitiator(pc, "peer-b");
  const registry = new MeshPeerRegistry(binding, onSendFailed);
  const entry: MeshPeerEntry = {
    name: "Bob",
    pc,
    mode: "direct",
    relayFallbackTried: false,
    initiator: true,
    pendingIce: [],
    signalSent: true,
    dataChannel: attached,
    caps,
  };
  registry.add("peer-b", entry);
  return { registry, channel };
}
