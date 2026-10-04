import { afterEach, describe, expect, it, vi } from "vitest";
import { RtcPeerMesh } from "@/lib/rtc/session/peer-mesh";
import type { HttpSignalingClient } from "@/lib/rtc/signaling/http-client";
import { netClassForJoin } from "@/lib/rtc/net-probe-session";

vi.mock("@/lib/rtc/log", () => ({ rtcLog: vi.fn() }));
vi.mock("@/lib/rtc/telemetry/selected-pair", () => ({ logSelectedPairTelemetry: vi.fn() }));
vi.mock("@/lib/rtc/net-probe-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rtc/net-probe-session")>();
  return { ...actual, netClassForJoin: vi.fn(async () => "open") };
});

function stubPeerConnection(): RTCPeerConnection {
  const pc = {
    connectionState: "new",
    iceConnectionState: "new",
    signalingState: "stable",
    localDescription: null,
    remoteDescription: null,
    onicecandidate: null,
    ontrack: null,
    onconnectionstatechange: null as ((event: Event) => void) | null,
    oniceconnectionstatechange: null as ((event: Event) => void) | null,
    getSenders: () => [],
    close: vi.fn(),
    addTrack: vi.fn(),
    createOffer: vi.fn(async () => ({ type: "offer" as const, sdp: "v=0\r\n" })),
    createAnswer: vi.fn(async () => ({ type: "answer" as const, sdp: "v=0\r\n" })),
    setLocalDescription: vi.fn(async function (
      this: { signalingState: string },
      desc: { type?: string },
    ) {
      if (desc.type === "offer") this.signalingState = "have-local-offer";
    }),
    setRemoteDescription: vi.fn(async () => {}),
    addIceCandidate: vi.fn(async () => {}),
    setConfiguration: vi.fn(),
    restartIce: vi.fn(),
  };
  return pc as unknown as RTCPeerConnection;
}

function meshWith(net: "symmetric" | "unknown") {
  vi.mocked(netClassForJoin).mockResolvedValue(net);
  const order: string[] = [];
  const relay = vi.fn(async (input: { reason: string; target: string }) => {
    order.push(`relay:${input.reason}:${input.target}`);
    return {
      turn: { urls: ["turn:turn.example:3478"], username: "user", credential: "cred", ttl: 3600 },
    };
  });
  const send = vi.fn(async (input: { type: string }) => {
    if (input.type === "offer") order.push("offer");
    return { ok: true };
  });
  const signaling = {
    join: vi.fn(async (input: { peerId?: string }) => ({
      peerId: input.peerId ?? "peer-z",
      peers: [{ id: "peer-a", name: "Ada" }],
      sessionKey: null,
    })),
    poll: vi.fn(async () => ({ peers: [{ id: "peer-a", name: "Ada" }], messages: [] })),
    send,
    leave: vi.fn(async () => ({ ok: true })),
    relay,
  };
  const mesh = new RtcPeerMesh({
    channel: "meet",
    room: "room-1",
    initiatorRule: "higherId",
    signaling: signaling as unknown as HttpSignalingClient,
    rtcSettings: { stunUrls: "", turnAvailable: false, forceRelay: false },
    ports: { createPeerConnection: () => stubPeerConnection() },
  });
  return { mesh, order, relay };
}

describe("mesh relay requests", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requests relay before the first offer when the pre-check is bad", async () => {
    const { mesh, order, relay } = meshWith("symmetric");
    await mesh.join({ name: "Host", peerId: "peer-z" });
    expect(relay).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "precheck", target: "*", net: "symmetric" }),
    );
    expect(order[0]).toBe("relay:precheck:*");
    expect(order.indexOf("offer")).toBeGreaterThan(0);
    await mesh.leave();
  });

  it("requests relay once when a pair fails", async () => {
    const { mesh, relay } = meshWith("unknown");
    await mesh.join({ name: "Host", peerId: "peer-z" });
    const pc = mesh.getPeerConnection("peer-a") as RTCPeerConnection & {
      iceConnectionState: RTCIceConnectionState;
      oniceconnectionstatechange: ((event: Event) => void) | null;
    };
    const fail = () => {
      pc.iceConnectionState = "failed";
      pc.oniceconnectionstatechange?.(new Event("ice"));
    };
    fail();
    await vi.waitFor(() => expect(relay).toHaveBeenCalledTimes(1));
    expect(relay).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "failed", target: "peer-a" }),
    );
    fail();
    await Promise.resolve();
    expect(relay).toHaveBeenCalledTimes(1);
    await mesh.leave();
  });
});
