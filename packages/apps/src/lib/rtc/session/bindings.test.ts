import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDataBinding, createMediaBinding } from "@/lib/rtc/session/bindings";

describe("createMediaBinding", () => {
  beforeEach(() => {
    class MockMediaStream {
      private tracks: MediaStreamTrack[] = [];

      addTrack(track: MediaStreamTrack) {
        if (!this.tracks.includes(track)) this.tracks.push(track);
      }

      getTracks() {
        return this.tracks;
      }
    }

    vi.stubGlobal("MediaStream", MockMediaStream);
  });

  it("notifies onRemoteStream when ontrack fires", () => {
    const onRemoteStream = vi.fn();
    const binding = createMediaBinding({
      getLocalStream: () => null,
      onRemoteStream,
    });

    const pc = {
      addTrack: vi.fn(),
      ontrack: null as RTCPeerConnection["ontrack"],
    } as unknown as RTCPeerConnection;

    const remoteStream = binding.attach(pc, "REMOTE1");
    expect(pc.ontrack).toBeTypeOf("function");

    const track = { kind: "audio" } as MediaStreamTrack;
    pc.ontrack?.({
      track,
      streams: [],
    } as unknown as RTCTrackEvent);

    expect(remoteStream.getTracks()).toContain(track);
    expect(onRemoteStream).toHaveBeenCalledWith("REMOTE1", remoteStream);
  });
});

describe("createDataBinding extra channels", () => {
  function stubPc() {
    const listeners = new Map<string, Set<EventListener>>();
    const pc = {
      createDataChannel: vi.fn((label: string) => ({
        label,
        binaryType: "blob",
        onopen: null,
        onclose: null,
        onmessage: null,
      })),
      ondatachannel: null as RTCPeerConnection["ondatachannel"],
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        let set = listeners.get(type);
        if (!set) {
          set = new Set();
          listeners.set(type, set);
        }
        set.add(listener);
      }),
      removeEventListener: vi.fn(),
      fireDataChannel(channel: { label: string }) {
        const event = { channel } as unknown as RTCDataChannelEvent;
        for (const listener of listeners.get("datachannel") ?? []) {
          listener(event);
        }
        pc.ondatachannel?.(event);
      },
    };
    return pc as typeof pc & RTCPeerConnection;
  }

  it("forwards an extra channel on the initiator PC", () => {
    const onExtraChannel = vi.fn();
    const binding = createDataBinding({ label: "presence", onExtraChannel });
    const pc = stubPc();

    binding.attachInitiator(pc, "peer-a");
    const extra = { label: "wgw1/collab/abcdef" };
    pc.fireDataChannel(extra);

    expect(onExtraChannel).toHaveBeenCalledWith("peer-a", extra);
  });

  it("forwards an extra channel on the receiver PC", () => {
    const onExtraChannel = vi.fn();
    const binding = createDataBinding({ label: "presence", onExtraChannel });
    const pc = stubPc();

    binding.attachReceiver(pc, "peer-b");
    const extra = { label: "wgw1/collab/abcdef" };
    pc.fireDataChannel(extra);

    expect(onExtraChannel).toHaveBeenCalledWith("peer-b", extra);
  });

  it("does not forward the primary label", () => {
    const onExtraChannel = vi.fn();
    const binding = createDataBinding({ label: "presence", onExtraChannel });
    const pc = stubPc();

    binding.attachInitiator(pc, "peer-a");
    pc.fireDataChannel({ label: "presence" });

    expect(onExtraChannel).not.toHaveBeenCalled();
  });

  it("does not add a listener when onExtraChannel is absent", () => {
    const binding = createDataBinding({ label: "presence" });
    const pc = stubPc();

    binding.attachInitiator(pc, "peer-a");
    binding.attachReceiver(pc, "peer-b");

    expect(pc.addEventListener).not.toHaveBeenCalled();
  });
});
