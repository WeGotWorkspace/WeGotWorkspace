import { describe, expect, it, vi } from "vitest";
import { createDataBinding } from "@/lib/rtc/session/bindings";
import {
  DATA_CHANNEL_BUFFER_HIGH_WATER_BYTES,
  decodeBinaryFrame,
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

/** JSON number-array of a Yjs update, about 300 KB — over the 256 KiB cap. */
function largeSyncMessage(): { message: { type: "sync"; u: number[] }; json: string } {
  const u = new Array(75_000).fill(200);
  const message = { type: "sync" as const, u };
  return { message, json: JSON.stringify(message) };
}

describe("large Yjs state over a capped data channel", () => {
  it("delivers a ~300 KB update to the second peer in frames of 16 KiB or less", async () => {
    const { message, json } = largeSyncMessage();
    expect(json.length).toBeGreaterThan(MAX_SCTP_MESSAGE_BYTES);
    expect(json.length).toBeGreaterThan(290_000);
    expect(json.length).toBeLessThan(310_000);

    const received: string[] = [];
    const channel = createCappedChannel();
    const binding = createDataBinding({
      label: "collab",
      onMessage: (_remoteId, data) => {
        received.push(data);
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
    entry.caps = ["bin"];
    registry.add("peer-b", entry);

    registry.sendJsonTo("peer-b", message);

    await vi.waitFor(
      () => {
        expect(received).toEqual([json]);
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

  it("frames a collab-reuse data envelope the same way", async () => {
    const { message, json } = largeSyncMessage();
    const envelope = {
      v: 1 as const,
      kind: "collab-reuse" as const,
      room: "docs/notes.md",
      op: "data" as const,
      collabPeerId: "aaaaaaaaaaaaaaaa",
      payload: message,
    };
    const wire = JSON.stringify(envelope);
    expect(wire.length).toBeGreaterThan(json.length);

    const received: string[] = [];
    const { registry, channel } = openPeer(received, ["bin"]);
    registry.sendJsonTo("peer-b", envelope);

    await vi.waitFor(() => expect(received).toEqual([wire]), { timeout: 200 });
    expect(channel.frames.length).toBeGreaterThan(1);
    expect(channel.frames.every((frame) => frame instanceof Uint8Array)).toBe(true);
  });

  it("still sends one JSON string to a peer that does not advertise bin", () => {
    const received: string[] = [];
    const { registry, channel } = openPeer(received);
    const message = { type: "sync", u: [1, 2, 3] };
    registry.sendJsonTo("peer-b", message);

    expect(channel.frames).toEqual([JSON.stringify(message)]);
    expect(received).toEqual([JSON.stringify(message)]);
  });

  it("frames the first sync when bin was announced before the peer entry existed", () => {
    const received: string[] = [];
    const channel = createCappedChannel();
    const binding = createDataBinding({
      label: "collab",
      onMessage: (_remoteId, data) => {
        received.push(data);
      },
    });
    const pc = {
      createDataChannel: () => channel,
    } as unknown as RTCPeerConnection;
    const attached = binding.attachInitiator(pc, "peer-b");
    const registry = new MeshPeerRegistry(binding);
    const message = { type: "sync", u: [1, 2, 3] };

    registry.rememberCaps("peer-b", ["bin"]);
    registry.add("peer-b", peerEntry(pc, attached));
    registry.sendJsonTo("peer-b", message);

    expect(channel.frames[0]).toBeInstanceOf(Uint8Array);
    expect(received).toEqual([JSON.stringify(message)]);
  });

  it("pauses above 1 MiB buffered and resumes on bufferedamountlow", () => {
    const received: string[] = [];
    const { registry, channel } = openPeer(received, ["bin"]);
    channel.bufferedAmount = DATA_CHANNEL_BUFFER_HIGH_WATER_BYTES + 1;

    registry.sendJsonTo("peer-b", { type: "sync", u: [1, 2, 3] });

    expect(channel.frames).toEqual([]);
    expect(channel.bufferedAmountLowThreshold).toBe(DATA_CHANNEL_BUFFER_HIGH_WATER_BYTES);
    expect(channel.lowListeners.size).toBe(1);

    channel.bufferedAmount = 0;
    for (const listener of channel.lowListeners) listener();

    expect(received).toEqual([JSON.stringify({ type: "sync", u: [1, 2, 3] })]);
    expect(channel.frames.every((frame) => frame instanceof Uint8Array)).toBe(true);
  });

  it("logs a send failure and reports the peer for resync", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onSendFailed = vi.fn();
    const received: string[] = [];
    const { registry, channel } = openPeer(received, ["bin"], onSendFailed);
    channel.send = () => {
      throw new Error("send failed");
    };

    registry.sendJsonTo("peer-b", { type: "sync", u: [1] });

    expect(received).toEqual([]);
    expect(onSendFailed).toHaveBeenCalledWith("peer-b", expect.any(Error));
    expect(warn).toHaveBeenCalledWith(
      "[rtc] datachannel-send-failed",
      expect.objectContaining({ remoteId: "peer-b", message: "send failed" }),
    );
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

function openPeer(
  received: string[],
  caps?: readonly string[],
  onSendFailed?: (remoteId: string, error: unknown) => void,
): { registry: MeshPeerRegistry; channel: CappedChannel } {
  const channel = createCappedChannel();
  const binding = createDataBinding({
    label: "collab",
    onMessage: (_remoteId, data) => {
      received.push(data);
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
