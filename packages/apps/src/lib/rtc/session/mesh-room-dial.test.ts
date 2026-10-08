import { describe, expect, it, vi } from "vitest";
import { RtcPeerMesh } from "@/lib/rtc/session/peer-mesh";
import type { HttpSignalingClient } from "@/lib/rtc/signaling/http-client";

vi.mock("@/lib/rtc/log", () => ({ rtcLog: vi.fn(), rtcSdpMeta: () => ({ sdpBytes: 0 }) }));
vi.mock("@/lib/rtc/telemetry/selected-pair", () => ({ logSelectedPairTelemetry: vi.fn() }));
vi.mock("@/lib/rtc/net-probe-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rtc/net-probe-session")>();
  return { ...actual, netClassForJoin: vi.fn(async () => "open") };
});

/**
 * The second dial is `dialRoomPeers` again, from the piggyback poll inside
 * `sendSignal`, while the first offer is still `have-local-offer`.
 */
function meshWithReentry() {
  const offers: string[] = [];
  let reentered = false;
  const signaling = {
    join: vi.fn(async (input: { peerId?: string }) => ({
      peerId: input.peerId ?? "peer-a",
      peers: [{ id: "peer-z", name: "Ada" }],
      sessionKey: null,
    })),
    poll: vi.fn(async () => ({ peers: [{ id: "peer-z", name: "Ada" }], messages: [] })),
    send: vi.fn(async (input: { type: string; to: string }) => {
      if (input.type !== "offer") return { ok: true };
      offers.push(input.to);
      if (reentered) return { ok: true };
      reentered = true;
      return {
        ok: true,
        peers: [{ id: "peer-z", name: "Ada" }],
        messages: [{ id: 7, from: "peer-z", type: "ice", payload: { candidate: "candidate:1" } }],
      };
    }),
    leave: vi.fn(async () => ({ ok: true })),
    relay: vi.fn(async () => ({ turn: { urls: [], username: "", credential: "", ttl: 0 } })),
  };
  const mesh = new RtcPeerMesh({
    channel: "collab",
    room: "room-1",
    initiatorRule: "lowerId",
    signaling: signaling as unknown as HttpSignalingClient,
    rtcSettings: { stunUrls: "", turnAvailable: true, forceRelay: false },
    ports: { createPeerConnection: () => stubPc() },
  });
  return { mesh, offers };
}

function stubPc(): RTCPeerConnection {
  const pc = {
    connectionState: "new",
    iceConnectionState: "new",
    iceGatheringState: "new",
    signalingState: "stable",
    localDescription: null as RTCSessionDescriptionInit | null,
    remoteDescription: null,
    onicecandidate: null,
    ontrack: null,
    onconnectionstatechange: null as ((event: Event) => void) | null,
    oniceconnectionstatechange: null as ((event: Event) => void) | null,
    onicegatheringstatechange: null,
    getSenders: () => [],
    close: () => undefined,
    addTrack: () => undefined,
    createOffer: async () => ({ type: "offer" as const, sdp: "v=0\r\n" }),
    createAnswer: async () => ({ type: "answer" as const, sdp: "v=0\r\n" }),
    setLocalDescription: async function (
      this: { signalingState: string; localDescription: RTCSessionDescriptionInit | null },
      desc: RTCSessionDescriptionInit,
    ) {
      this.localDescription = desc;
      if (desc.type === "offer") this.signalingState = "have-local-offer";
    },
    setRemoteDescription: async () => undefined,
    addIceCandidate: async () => undefined,
    createDataChannel: () => ({
      binaryType: "blob",
      readyState: "connecting",
      close: () => undefined,
      send: () => undefined,
    }),
  };
  return pc as unknown as RTCPeerConnection;
}

describe("roster dial offer pending", () => {
  it("sends one offer when a piggyback poll dials the same peer within 100ms", async () => {
    const { mesh, offers } = meshWithReentry();
    await mesh.join({ name: "Host", peerId: "peer-a" });
    expect(offers).toEqual(["peer-z"]);
    await mesh.leave();
  });
});
