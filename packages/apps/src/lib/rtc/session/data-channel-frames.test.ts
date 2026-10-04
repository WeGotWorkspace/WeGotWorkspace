import { describe, expect, it, vi } from "vitest";
import { createDataBinding } from "@/lib/rtc/session/bindings";
import { MeshPeerRegistry, type MeshPeerEntry } from "@/lib/rtc/session/mesh-peer-registry";

/** Chrome refuses one data-channel message above this size. */
const MAX_SCTP_MESSAGE_BYTES = 256 * 1024;

/** Each binary frame, header included, stays at or under this size. */
const MAX_FRAME_BYTES = 16 * 1024;

type CappedChannel = RTCDataChannel & {
  frames: Array<string | Uint8Array>;
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
    addEventListener() {},
    removeEventListener() {},
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
    // Peer advertises `bin`, so the update must go out as binary frames.
    Object.assign(entry, { caps: ["bin"] });
    registry.add("peer-b", entry);

    registry.sendJsonTo("peer-b", message);

    await vi.waitFor(
      () => {
        expect(received).toEqual([json]);
      },
      { timeout: 200 },
    );

    expect(channel.frames.length).toBeGreaterThan(1);
    for (const frame of channel.frames) {
      expect(frame).toBeInstanceOf(Uint8Array);
      expect((frame as Uint8Array).byteLength).toBeLessThanOrEqual(MAX_FRAME_BYTES);
    }
  });
});
