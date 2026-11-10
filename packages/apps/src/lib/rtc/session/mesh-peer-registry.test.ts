import { describe, expect, it, vi } from "vitest";
import { createMediaBinding } from "@/lib/rtc/session/bindings";
import { MeshPeerRegistry, type MeshPeerEntry } from "@/lib/rtc/session/mesh-peer-registry";

type FakeTransceiver = {
  direction: RTCRtpTransceiverDirection;
  receiver: { track: { kind: string } };
  sender: { track: MediaStreamTrack | null; replaceTrack: ReturnType<typeof vi.fn> };
};

function slot(kind: string, direction: RTCRtpTransceiverDirection): FakeTransceiver {
  const sender = {
    track: null as MediaStreamTrack | null,
    replaceTrack: vi.fn(async (track: MediaStreamTrack | null) => {
      sender.track = track;
    }),
  };
  return { direction, receiver: { track: { kind } }, sender };
}

/** An answerer's connection: no transceivers until the remote offer is applied. */
function answererPc() {
  const transceivers: FakeTransceiver[] = [];
  const pc = {
    getTransceivers: () => transceivers,
    getSenders: () => transceivers.map((t) => t.sender),
  } as unknown as RTCPeerConnection;
  return { pc, applyOffer: (...offered: FakeTransceiver[]) => transceivers.push(...offered) };
}

function registryWith(pc: RTCPeerConnection): MeshPeerRegistry {
  const registry = new MeshPeerRegistry(createMediaBinding({ getLocalStream: () => null }));
  registry.add("peer-b", { pc } as MeshPeerEntry);
  return registry;
}

function camera(readyState: MediaStreamTrackState = "live"): MediaStreamTrack {
  return { kind: "video", readyState } as MediaStreamTrack;
}

describe("MeshPeerRegistry send slots", () => {
  it("places a camera turned on before the offer on the slot the answer opens", async () => {
    const { pc, applyOffer } = answererPc();
    const registry = registryWith(pc);
    const cam = camera();

    // No slot yet: the track has nowhere to go.
    await registry.replaceSenderTrack("video", cam);
    const video = slot("video", "recvonly");
    applyOffer(slot("audio", "recvonly"), video);
    expect(video.sender.replaceTrack).not.toHaveBeenCalled();

    await registry.prepareAnswer(pc);

    expect(video.direction).toBe("sendrecv");
    expect(video.sender.replaceTrack).toHaveBeenCalledWith(cam);
  });

  it("leaves the slot empty for a track that has ended", async () => {
    const { pc, applyOffer } = answererPc();
    const registry = registryWith(pc);
    await registry.replaceSenderTrack("video", camera("ended"));
    const video = slot("video", "recvonly");
    applyOffer(video);

    await registry.prepareAnswer(pc);

    expect(video.direction).toBe("sendrecv");
    expect(video.sender.replaceTrack).not.toHaveBeenCalled();
  });
});
