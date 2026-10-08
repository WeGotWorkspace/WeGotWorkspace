import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RtcPeerMesh } from "@/lib/rtc/session/peer-mesh";
import type {
  HttpSignalingClient,
  HttpSignalingPollResponse,
  HttpSignalingPollResult,
} from "@/lib/rtc/signaling/http-client";
import type { RtcSettings } from "@/lib/rtc/types";

vi.mock("@/lib/rtc/log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rtc/log")>();
  return { ...actual, rtcLog: vi.fn() };
});
vi.mock("@/lib/rtc/telemetry/selected-pair", () => ({
  logSelectedPairTelemetry: vi.fn(),
}));

const RTC_SETTINGS: RtcSettings = {
  stunUrls: "",
  turnAvailable: false,
  forceRelay: false,
};

type StubPeerConnection = {
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  signalingState: RTCSignalingState;
  localDescription: RTCSessionDescription | null;
  remoteDescription: RTCSessionDescription | null;
  onicecandidate: RTCPeerConnection["onicecandidate"];
  ontrack: RTCPeerConnection["ontrack"];
  onconnectionstatechange: RTCPeerConnection["onconnectionstatechange"];
  oniceconnectionstatechange: RTCPeerConnection["oniceconnectionstatechange"];
  __localDesc: RTCSessionDescriptionInit | null;
  __remoteDesc: RTCSessionDescriptionInit | null;
  getSenders: () => RTCRtpSender[];
  close: ReturnType<typeof vi.fn>;
  addTrack: ReturnType<typeof vi.fn>;
  createOffer: ReturnType<typeof vi.fn>;
  createAnswer: ReturnType<typeof vi.fn>;
  setLocalDescription: ReturnType<typeof vi.fn>;
  setRemoteDescription: ReturnType<typeof vi.fn>;
  addIceCandidate: ReturnType<typeof vi.fn>;
  createDataChannel: ReturnType<typeof vi.fn>;
};

function createStubPeerConnection(offerSdp?: string): RTCPeerConnection {
  const pc: StubPeerConnection = {
    connectionState: "new",
    iceConnectionState: "new",
    signalingState: "stable",
    localDescription: null,
    remoteDescription: null,
    onicecandidate: null,
    ontrack: null,
    onconnectionstatechange: null,
    oniceconnectionstatechange: null,
    __localDesc: null,
    __remoteDesc: null,
    getSenders: () => [],
    close: vi.fn(),
    addTrack: vi.fn(),
    createOffer: vi.fn(async () => ({
      type: "offer" as const,
      sdp:
        offerSdp ??
        "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=ssrc:1234 cname:test\r\n",
    })),
    createAnswer: vi.fn(async () => ({
      type: "answer" as const,
      sdp: "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
    })),
    setLocalDescription: vi.fn(async function (
      this: StubPeerConnection,
      desc: RTCSessionDescriptionInit,
    ) {
      this.__localDesc = desc;
      this.localDescription = desc as RTCSessionDescription;
      if (desc.type === "offer") this.signalingState = "have-local-offer";
      if (desc.type === "answer") this.signalingState = "stable";
    }),
    setRemoteDescription: vi.fn(async function (
      this: StubPeerConnection,
      desc: RTCSessionDescriptionInit,
    ) {
      this.__remoteDesc = desc;
      this.remoteDescription = desc as RTCSessionDescription;
      if (desc.type === "offer") this.signalingState = "have-remote-offer";
      if (desc.type === "answer") this.signalingState = "stable";
    }),
    addIceCandidate: vi.fn(async () => {}),
    createDataChannel: vi.fn((label: string, init?: RTCDataChannelInit) => ({
      label,
      id: init?.id,
      readyState: "connecting",
      binaryType: "blob",
      close: vi.fn(),
      send: vi.fn(),
    })),
  };

  return pc as unknown as RTCPeerConnection;
}

function asStubPeerConnection(pc: RTCPeerConnection): StubPeerConnection {
  return pc as unknown as StubPeerConnection;
}

type MockPollInput = { since?: number; sig?: string };

function createMockSignaling(initialJoin: {
  peerId: string;
  peers?: Array<{ id: string; name: string; user?: string }>;
  sessionKey?: string | null;
}) {
  const sends: Array<{ to: string; type: string; payload: unknown }> = [];
  let pollHandler: ((input: MockPollInput) => Promise<HttpSignalingPollResponse>) | null = null;

  const client = {
    join: vi.fn(async (input: { peerId?: string; name: string }) => ({
      peerId: input.peerId ?? initialJoin.peerId,
      peers: initialJoin.peers ?? [],
      sessionKey: initialJoin.sessionKey ?? null,
    })),
    poll: vi.fn(async (input?: unknown): Promise<HttpSignalingPollResponse> => {
      if (pollHandler) return pollHandler((input ?? {}) as MockPollInput);
      return { peers: initialJoin.peers ?? [], messages: [] };
    }),
    send: vi.fn(async (input: { to: string; type: string; payload: unknown }) => {
      sends.push({ to: input.to, type: input.type, payload: input.payload });
      return { ok: true };
    }),
    leave: vi.fn(async () => ({ ok: true })),
  };

  return {
    client,
    sends,
    setPollHandler(handler: (input: MockPollInput) => Promise<HttpSignalingPollResponse>) {
      pollHandler = handler;
    },
  };
}

function meshWithStubPc(
  signaling: ReturnType<typeof createMockSignaling>["client"],
  overrides: Partial<ConstructorParameters<typeof RtcPeerMesh>[0]> = {},
) {
  const pcs = new Map<string, StubPeerConnection>();
  return {
    pcs,
    mesh: new RtcPeerMesh({
      channel: "meet",
      room: "test-room",
      signaling: signaling as unknown as HttpSignalingClient,
      rtcSettings: RTC_SETTINGS,
      initiatorRule: "higherId",
      pollIntervals: { connectingMs: 400, steadyMs: 1200 },
      ...overrides,
      ports: {
        createPeerConnection: () => {
          const pc = createStubPeerConnection();
          pcs.set(String(pcs.size), asStubPeerConnection(pc));
          return pc;
        },
        ...overrides.ports,
      },
    }),
  };
}

async function flushAsyncWork() {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve();
  }
}

describe("RtcPeerMesh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules poll with bound timers after join", async () => {
    const signaling = createMockSignaling({ peerId: "PEER_HIGH_ID" });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const { mesh } = meshWithStubPc(signaling.client);
    await mesh.join({ name: "Host", peerId: "PEER_HIGH_ID" });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 400);
    await mesh.leave();
    setTimeoutSpy.mockRestore();
  });

  it("backs off collab polling to 2s when the room is empty", async () => {
    const signaling = createMockSignaling({ peerId: "peer-a", peers: [] });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const mesh = new RtcPeerMesh({
      channel: "collab",
      room: "docs/test.md",
      signaling: signaling.client as unknown as HttpSignalingClient,
      rtcSettings: RTC_SETTINGS,
      pollIntervals: { connectingMs: 400, steadyMs: 1200 },
      binding: {
        kind: "data",
        label: "collab",
        attachInitiator: () => ({ readyState: "open" }) as RTCDataChannel,
        attachReceiver: () => undefined,
        linkState: () => "connected",
      },
    });

    await mesh.join({ name: "Host", peerId: "peer-a" });
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 400);

    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 2000);
    await mesh.leave();
    setTimeoutSpy.mockRestore();
  });

  it("backs off meet polling when topology is stable", async () => {
    const signaling = createMockSignaling({ peerId: "peer-a", peers: [] });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const mesh = new RtcPeerMesh({
      channel: "meet",
      room: "test-room",
      signaling: signaling.client as unknown as HttpSignalingClient,
      rtcSettings: RTC_SETTINGS,
      pollIntervals: { connectingMs: 400, steadyMs: 1200 },
      binding: {
        kind: "media",
        attach: () => new MediaStream(),
      },
    });

    await mesh.join({ name: "Host", peerId: "peer-a" });
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 400);

    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 4000);
    await mesh.leave();
    setTimeoutSpy.mockRestore();
  });

  it("keeps fast meet polling while knockers are waiting", async () => {
    const signaling = createMockSignaling({
      peerId: "peer-a",
      peers: [{ id: "k1", name: "__wgw_knock__:Guest" }],
    });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const mesh = new RtcPeerMesh({
      channel: "meet",
      room: "test-room",
      signaling: signaling.client as unknown as HttpSignalingClient,
      rtcSettings: RTC_SETTINGS,
      pollIntervals: { connectingMs: 400, steadyMs: 1200 },
      binding: {
        kind: "media",
        attach: () => new MediaStream(),
      },
    });

    await mesh.join({ name: "Host", peerId: "peer-a" });
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 1200);
    await mesh.leave();
    setTimeoutSpy.mockRestore();
  });

  it("keeps fast meet polling while waiting for admission", async () => {
    const signaling = createMockSignaling({ peerId: "peer-a", peers: [] });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const mesh = new RtcPeerMesh({
      channel: "meet",
      room: "test-room",
      signaling: signaling.client as unknown as HttpSignalingClient,
      rtcSettings: RTC_SETTINGS,
      pollIntervals: { connectingMs: 400, steadyMs: 1200 },
      binding: {
        kind: "media",
        attach: () => new MediaStream(),
      },
      shouldHandleRtcSignals: () => false,
    });

    await mesh.join({ name: "Guest", peerId: "peer-a" });
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 1200);
    await mesh.leave();
    setTimeoutSpy.mockRestore();
  });

  it("backs off polling when the tab is hidden and no peer connections exist", async () => {
    const signaling = createMockSignaling({ peerId: "peer-a", peers: [] });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const { mesh } = meshWithStubPc(signaling.client, {
      channel: "chat",
      ports: {
        visibility: {
          getState: () => "hidden",
          subscribe: () => () => {},
        },
      },
    });

    await mesh.join({ name: "Host", peerId: "peer-a" });
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 60000);
    await mesh.leave();
    setTimeoutSpy.mockRestore();
  });

  it("keeps normal cadence when hidden with peer connections present", async () => {
    const signaling = createMockSignaling({
      peerId: "ZZZZZZZZZZ",
      peers: [{ id: "AAAAAAAAAA", name: "Guest" }],
    });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const { mesh } = meshWithStubPc(signaling.client, {
      ports: {
        visibility: {
          getState: () => "hidden",
          subscribe: () => () => {},
        },
      },
    });

    await mesh.join({ name: "Host", peerId: "ZZZZZZZZZZ" });
    await flushAsyncWork();
    expect(mesh.getPeerIds()).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 1200);
    await mesh.leave();
    setTimeoutSpy.mockRestore();
  });

  it("restores fast polling when visibility returns", async () => {
    const signaling = createMockSignaling({ peerId: "peer-a", peers: [] });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    let visibilityState: DocumentVisibilityState = "hidden";
    let visibilityListener: (() => void) | null = null;
    const unsubscribe = vi.fn();

    const { mesh } = meshWithStubPc(signaling.client, {
      channel: "chat",
      ports: {
        visibility: {
          getState: () => visibilityState,
          subscribe: (listener) => {
            visibilityListener = listener;
            return unsubscribe;
          },
        },
      },
    });

    await mesh.join({ name: "Host", peerId: "peer-a" });
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 60000);

    visibilityState = "visible";
    visibilityListener!();

    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 400);

    await mesh.leave();
    expect(unsubscribe).toHaveBeenCalled();
    setTimeoutSpy.mockRestore();
  });

  it("echoes rosterSig on subsequent polls and skips unchanged responses", async () => {
    const onPollData = vi.fn();
    const signaling = createMockSignaling({ peerId: "peer-a", peers: [] });
    const { mesh } = meshWithStubPc(signaling.client, { onPollData });

    await mesh.join({ name: "Host", peerId: "peer-a" });
    expect(onPollData).toHaveBeenCalledTimes(1);

    signaling.setPollHandler(async () => ({
      peers: [{ id: "peer-b", name: "Guest" }],
      messages: [],
      rosterSig: "sig-1",
    }));
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();
    expect(onPollData).toHaveBeenCalledTimes(2);

    signaling.setPollHandler(async () => ({ unchanged: true }));
    await vi.advanceTimersByTimeAsync(1200);
    await flushAsyncWork();

    const lastPollInput = signaling.client.poll.mock.calls.at(-1)?.[0] as
      { sig?: string } | undefined;
    expect(lastPollInput?.sig).toBe("sig-1");
    expect(onPollData).toHaveBeenCalledTimes(2);
    expect(mesh.getRoomPeers()).toEqual([{ id: "peer-b", name: "Guest" }]);

    await mesh.leave();
  });

  it("keeps steady polling for channels without idle backoff", async () => {
    const signaling = createMockSignaling({ peerId: "peer-a", peers: [] });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    const mesh = new RtcPeerMesh({
      channel: "chat",
      room: "test-room",
      signaling: signaling.client as unknown as HttpSignalingClient,
      rtcSettings: RTC_SETTINGS,
      pollIntervals: { connectingMs: 400, steadyMs: 1200 },
    });

    await mesh.join({ name: "Host", peerId: "peer-a" });
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 400);

    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 1200);
    await mesh.leave();
    setTimeoutSpy.mockRestore();
  });

  it("sends offer when meet higherId initiator sees a new peer", async () => {
    const signaling = createMockSignaling({
      peerId: "ZZZZZZZZZZ",
      peers: [{ id: "AAAAAAAAAA", name: "Guest" }],
    });
    const { mesh } = meshWithStubPc(signaling.client);

    await mesh.join({ name: "Host", peerId: "ZZZZZZZZZZ" });
    await flushAsyncWork();

    expect(signaling.sends.some((s) => s.type === "offer" && s.to === "AAAAAAAAAA")).toBe(true);
    await mesh.leave();
  });

  it("does not send offer when meet higherId peer is lower id", async () => {
    const signaling = createMockSignaling({
      peerId: "AAAAAAAAAA",
      peers: [{ id: "ZZZZZZZZZZ", name: "Host" }],
    });
    const { mesh } = meshWithStubPc(signaling.client);

    await mesh.join({ name: "Guest", peerId: "AAAAAAAAAA" });

    expect(signaling.sends.some((s) => s.type === "offer")).toBe(false);
    await mesh.leave();
  });

  it("answers an inbound offer", async () => {
    const signaling = createMockSignaling({ peerId: "AAAAAAAAAA", peers: [] });
    const { mesh } = meshWithStubPc(signaling.client);

    await mesh.join({ name: "Guest", peerId: "AAAAAAAAAA" });

    signaling.setPollHandler(async () => ({
      peers: [{ id: "ZZZZZZZZZZ", name: "Host" }],
      messages: [
        {
          from: "ZZZZZZZZZZ",
          type: "offer",
          payload: {
            type: "offer",
            sdp: "v=0\r\no=-\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
          },
        },
      ],
    }));

    await vi.advanceTimersByTimeAsync(400);

    expect(signaling.sends.some((s) => s.type === "answer" && s.to === "ZZZZZZZZZZ")).toBe(true);
    await mesh.leave();
  });

  it("passes outbound SDP through formatOutbound without rewriting local descriptions", async () => {
    const offerWithSsrc =
      "v=0\r\no=-\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=ssrc:9999 cname:keep-me\r\n";
    const outboundSpy = vi.fn((desc: RTCSessionDescriptionInit) => desc);
    const signaling = createMockSignaling({
      peerId: "ZZZZZZZZZZ",
      peers: [{ id: "AAAAAAAAAA", name: "Guest" }],
    });

    const pcs: StubPeerConnection[] = [];
    const mesh = new RtcPeerMesh({
      channel: "meet",
      room: "test-room",
      signaling: signaling.client as unknown as HttpSignalingClient,
      rtcSettings: RTC_SETTINGS,
      initiatorRule: "higherId",
      formatOutboundDescription: outboundSpy,
      ports: {
        createPeerConnection: () => {
          const pc = createStubPeerConnection(offerWithSsrc);
          pcs.push(asStubPeerConnection(pc));
          return pc;
        },
      },
    });

    await mesh.join({ name: "Host", peerId: "ZZZZZZZZZZ" });
    await flushAsyncWork();

    expect(outboundSpy).toHaveBeenCalled();
    const sentOffer = signaling.sends.find((s) => s.type === "offer");
    const payload = sentOffer?.payload as { sdp?: string };
    expect(payload?.sdp).toContain("a=ssrc:9999");
    expect(pcs[0]?.__localDesc?.sdp).toContain("a=ssrc:9999");
    await mesh.leave();
  });

  it("runs onPollData before handling rtc signals", async () => {
    let pollDataBeforeAnswer = false;
    const signaling = createMockSignaling({ peerId: "AAAAAAAAAA", peers: [] });
    const { mesh } = meshWithStubPc(signaling.client, {
      onPollData: async () => {
        if (!signaling.sends.some((s) => s.type === "answer")) {
          pollDataBeforeAnswer = true;
        }
      },
    });

    await mesh.join({ name: "Guest", peerId: "AAAAAAAAAA" });

    signaling.setPollHandler(async () => ({
      peers: [{ id: "ZZZZZZZZZZ", name: "Host" }],
      messages: [
        {
          from: "ZZZZZZZZZZ",
          type: "offer",
          payload: {
            type: "offer",
            sdp: "v=0\r\no=-\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
          },
        },
      ],
    }));

    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(pollDataBeforeAnswer).toBe(true);
    expect(signaling.sends.some((s) => s.type === "answer")).toBe(true);
    await mesh.leave();
  });

  it("skips rtc connect when shouldConnectToPeer returns false", async () => {
    const signaling = createMockSignaling({
      peerId: "ZZZZZZZZZZ",
      peers: [{ id: "AAAAAAAAAA", name: "__wgw_knock__:Guest" }],
    });
    const { mesh } = meshWithStubPc(signaling.client, {
      shouldConnectToPeer: (peer) => !peer.name.startsWith("__wgw_knock__:"),
    });

    await mesh.join({ name: "Host", peerId: "ZZZZZZZZZZ" });

    expect(mesh.getPeerIds()).toHaveLength(0);
    expect(signaling.sends.some((s) => s.type === "offer")).toBe(false);
    await mesh.leave();
  });

  it("passes the guest session key on updateJoinName so admit rejoin keeps the owner marker", async () => {
    const signaling = createMockSignaling({
      peerId: "guest-1",
      peers: [{ id: "host-1", name: "Admin" }],
      sessionKey: "guest-session-key",
    });
    const { mesh } = meshWithStubPc(signaling.client, {
      shouldConnectToPeer: () => false,
      shouldHandleRtcSignals: () => false,
    });

    await mesh.join({ name: "__wgw_knock__:Ada", peerId: "guest-1" });
    await mesh.updateJoinName("Ada");

    expect(signaling.client.join).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: "Ada",
        peerId: "guest-1",
        sessionKey: "guest-session-key",
      }),
    );
    await mesh.leave();
  });

  it("ignores inbound offers when shouldAcceptOffer returns false", async () => {
    const signaling = createMockSignaling({ peerId: "AAAAAAAAAA", peers: [] });
    const { mesh, pcs } = meshWithStubPc(signaling.client, {
      channel: "collab",
      initiatorRule: "lowerId",
      shouldConnectToPeer: () => false,
      shouldAcceptOffer: (from) => from !== "ZZZZZZZZZZ",
    });

    await mesh.join({ name: "Guest", peerId: "AAAAAAAAAA" });

    signaling.setPollHandler(async () => ({
      peers: [{ id: "ZZZZZZZZZZ", name: "Host" }],
      messages: [
        {
          from: "ZZZZZZZZZZ",
          type: "offer",
          payload: {
            type: "offer",
            sdp: "v=0\r\no=-\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
          },
        },
      ],
    }));

    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(mesh.getPeerIds()).toHaveLength(0);
    expect(signaling.sends.some((s) => s.type === "answer")).toBe(false);
    expect(pcs.size).toBe(0);
    await mesh.leave();
  });

  it("retryRoomPeerConnections dials peers skipped by shouldConnectToPeer on the last poll", async () => {
    let skipIce = true;
    const signaling = createMockSignaling({
      peerId: "ZZZZZZZZZZ",
      peers: [{ id: "AAAAAAAAAA", name: "Guest", user: "guest" }],
    });
    const { mesh } = meshWithStubPc(signaling.client, {
      channel: "collab",
      shouldConnectToPeer: () => !skipIce,
    });

    await mesh.join({ name: "Host", peerId: "ZZZZZZZZZZ" });
    expect(mesh.getPeerIds()).toHaveLength(0);
    expect(signaling.sends.some((s) => s.type === "offer")).toBe(false);

    skipIce = false;
    mesh.retryRoomPeerConnections();
    await flushAsyncWork();

    expect(mesh.getPeerIds()).toHaveLength(1);
    expect(signaling.sends.some((s) => s.type === "offer")).toBe(true);
    await mesh.leave();
  });

  it("retryPeerConnection dials only that peer and leaves a connected peer untouched", async () => {
    const allow = new Set<string>();
    const signaling = createMockSignaling({
      peerId: "ZZZZZZZZZZ",
      peers: [
        { id: "AAAAAAAAAA", name: "Connected" },
        { id: "BBBBBBBBBB", name: "Fresh" },
      ],
    });
    const { mesh } = meshWithStubPc(signaling.client, {
      initiatorRule: "higherId",
      shouldConnectToPeer: (peer) => allow.has(peer.id),
    });

    await mesh.join({ name: "Host", peerId: "ZZZZZZZZZZ" });
    allow.add("AAAAAAAAAA");
    mesh.retryPeerConnection("AAAAAAAAAA");
    await flushAsyncWork();

    const connected = mesh.getPeerConnection("AAAAAAAAAA");
    expect(connected).toBeTruthy();
    (connected as unknown as { connectionState: RTCPeerConnectionState }).connectionState =
      "connected";
    const offersTo = (id: string) =>
      signaling.sends.filter((send) => send.to === id && send.type === "offer").length;
    const connectedOffers = offersTo("AAAAAAAAAA");
    expect(connectedOffers).toBeGreaterThan(0);
    expect(mesh.getPeerIds()).toEqual(["AAAAAAAAAA"]);

    allow.add("BBBBBBBBBB");
    mesh.retryPeerConnection("BBBBBBBBBB");
    await flushAsyncWork();

    expect(mesh.getPeerIds().sort()).toEqual(["AAAAAAAAAA", "BBBBBBBBBB"]);
    expect(offersTo("BBBBBBBBBB")).toBe(1);
    expect(offersTo("AAAAAAAAAA")).toBe(connectedOffers);
    expect(mesh.getPeerConnection("AAAAAAAAAA")).toBe(connected);

    mesh.retryPeerConnection("AAAAAAAAAA");
    await flushAsyncWork();
    expect(offersTo("AAAAAAAAAA")).toBe(connectedOffers);
    expect(mesh.getPeerConnection("AAAAAAAAAA")).toBe(connected);
    await mesh.leave();
  });

  it("retryRoomPeerConnections schedules an immediate poll for non-initiator peers", async () => {
    let skipIce = true;
    const signaling = createMockSignaling({
      peerId: "ZZZZZZZZZZ",
      peers: [{ id: "AAAAAAAAAA", name: "Host", user: "host" }],
    });
    const { mesh } = meshWithStubPc(signaling.client, {
      channel: "collab",
      initiatorRule: "lowerId",
      shouldConnectToPeer: () => !skipIce,
    });

    await mesh.join({ name: "Guest", peerId: "ZZZZZZZZZZ" });
    signaling.client.poll.mockClear();

    skipIce = false;
    mesh.retryRoomPeerConnections();
    await vi.advanceTimersByTimeAsync(400);

    expect(signaling.sends.some((s) => s.type === "offer")).toBe(false);
    expect(signaling.client.poll).toHaveBeenCalled();
    await mesh.leave();
  });

  it("abortPeerConnection tears down an in-flight peer without onPeerRemoved", async () => {
    const signaling = createMockSignaling({
      peerId: "AAAAAAAAAA",
      peers: [{ id: "BBBBBBBBBB", name: "Remote" }],
    });
    const onPeerRemoved = vi.fn();
    const { mesh, pcs } = meshWithStubPc(signaling.client, { onPeerRemoved });

    await mesh.join({ name: "Host", peerId: "AAAAAAAAAA" });
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(mesh.getPeerIds()).toContain("BBBBBBBBBB");
    const pcCountBeforeAbort = pcs.size;
    mesh.abortPeerConnection("BBBBBBBBBB");
    expect(mesh.getPeerIds()).not.toContain("BBBBBBBBBB");
    expect(onPeerRemoved).not.toHaveBeenCalled();
    expect(pcs.size).toBe(pcCountBeforeAbort);
    await mesh.leave();
  });

  it("does not reschedule polling after leave while a poll is in flight", async () => {
    const signaling = createMockSignaling({ peerId: "peer-a", peers: [] });
    let resolvePoll: ((value: HttpSignalingPollResult) => void) | null = null;
    signaling.setPollHandler(
      () =>
        new Promise<HttpSignalingPollResult>((resolve) => {
          resolvePoll = resolve;
        }),
    );

    const { mesh } = meshWithStubPc(signaling.client);
    await mesh.join({ name: "Host", peerId: "peer-a" });

    await vi.advanceTimersByTimeAsync(400);
    expect(signaling.client.poll).toHaveBeenCalledTimes(1);
    expect(resolvePoll).not.toBeNull();

    const leavePromise = mesh.leave();
    await flushAsyncWork();
    resolvePoll!({ peers: [], messages: [] });
    await leavePromise;
    await flushAsyncWork();

    await vi.advanceTimersByTimeAsync(5000);
    expect(signaling.client.poll).toHaveBeenCalledTimes(1);
  });

  it("ignores chat messages during rtc signal handling", async () => {
    const signaling = createMockSignaling({ peerId: "AAAAAAAAAA", peers: [] });
    const { mesh } = meshWithStubPc(signaling.client);

    await mesh.join({ name: "Guest", peerId: "AAAAAAAAAA" });

    signaling.setPollHandler(async () => ({
      peers: [{ id: "ZZZZZZZZZZ", name: "Host" }],
      messages: [
        {
          from: "ZZZZZZZZZZ",
          type: "chat",
          payload: { text: "hello" },
        },
      ],
    }));

    await vi.advanceTimersByTimeAsync(400);

    expect(signaling.sends.some((s) => s.type === "answer")).toBe(false);
    await mesh.leave();
  });

  it("keeps both peer ids when the same user joins from two browsers", async () => {
    const signaling = createMockSignaling({
      peerId: "aaaaaaaaaaaaaaaa",
      peers: [{ id: "z1cef2020cc59fb1", name: "Wouter", user: "wouter" }],
    });
    const { mesh } = meshWithStubPc(signaling.client, {
      channel: "collab",
      initiatorRule: "lowerId",
    });

    await mesh.join({ name: "Admin", peerId: "aaaaaaaaaaaaaaaa" });
    await flushAsyncWork();
    expect(signaling.sends.some((s) => s.type === "offer" && s.to === "z1cef2020cc59fb1")).toBe(
      true,
    );

    signaling.setPollHandler(async () => ({
      peers: [
        { id: "z1cef2020cc59fb1", name: "Wouter", user: "wouter" },
        { id: "z7e0deadbeef0001", name: "Wouter", user: "wouter" },
      ],
      messages: [],
    }));
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(
      mesh
        .getRoomPeers()
        .map((peer) => peer.id)
        .sort(),
    ).toEqual(["z1cef2020cc59fb1", "z7e0deadbeef0001"]);
    expect(signaling.sends.some((s) => s.type === "offer" && s.to === "z7e0deadbeef0001")).toBe(
      true,
    );
    await mesh.leave();
  });

  it("dials a hinted peer when the same user is already on the roster", async () => {
    const signaling = createMockSignaling({
      peerId: "aaaaaaaaaaaaaaaa",
      peers: [{ id: "b7e0deadbeef0001", name: "Wouter", user: "wouter" }],
    });
    const { mesh } = meshWithStubPc(signaling.client, {
      channel: "collab",
      initiatorRule: "lowerId",
    });

    await mesh.join({ name: "Admin", peerId: "aaaaaaaaaaaaaaaa" });
    await flushAsyncWork();
    const offersAfterJoin = signaling.sends.filter((s) => s.type === "offer").length;

    mesh.applyPeerHint([{ id: "c0ffee0000000001", name: "Wouter", user: "wouter" }]);
    await flushAsyncWork();

    expect(signaling.sends.filter((s) => s.type === "offer").length).toBeGreaterThan(
      offersAfterJoin,
    );
    expect(signaling.sends.some((s) => s.to === "c0ffee0000000001")).toBe(true);
    await mesh.leave();
  });

  it("dials a hinted peer immediately when the local side is the collab initiator", async () => {
    const signaling = createMockSignaling({ peerId: "AAAAAAAAAA", peers: [] });
    const { mesh } = meshWithStubPc(signaling.client, {
      channel: "collab",
      initiatorRule: "lowerId",
    });

    await mesh.join({ name: "Alex", peerId: "AAAAAAAAAA" });
    mesh.applyPeerHint([{ id: "ZZZZZZZZZZ", name: "Zed" }]);
    await flushAsyncWork();

    expect(signaling.sends.some((s) => s.type === "offer" && s.to === "ZZZZZZZZZZ")).toBe(true);
    await mesh.leave();
  });

  it("kicks an immediate poll for hinted peers where the remote side initiates", async () => {
    const signaling = createMockSignaling({ peerId: "ZZZZZZZZZZ", peers: [] });
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const { mesh } = meshWithStubPc(signaling.client, {
      channel: "collab",
      initiatorRule: "lowerId",
    });

    await mesh.join({ name: "Zed", peerId: "ZZZZZZZZZZ" });
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 1200);
    const pollsBeforeHint = signaling.client.poll.mock.calls.length;

    mesh.applyPeerHint([{ id: "AAAAAAAAAA", name: "Alex" }]);

    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 400);
    expect(signaling.sends.some((s) => s.type === "offer")).toBe(false);

    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();
    expect(signaling.client.poll.mock.calls.length).toBe(pollsBeforeHint + 1);

    await mesh.leave();
    setTimeoutSpy.mockRestore();
  });

  it("ignores hinted peers that are already known", async () => {
    const signaling = createMockSignaling({
      peerId: "AAAAAAAAAA",
      peers: [{ id: "ZZZZZZZZZZ", name: "Zed" }],
    });
    const { mesh, pcs } = meshWithStubPc(signaling.client, {
      channel: "collab",
      initiatorRule: "lowerId",
    });

    await mesh.join({ name: "Alex", peerId: "AAAAAAAAAA" });
    await flushAsyncWork();
    const pcCountAfterJoin = pcs.size;
    const offersAfterJoin = signaling.sends.filter((s) => s.type === "offer").length;

    mesh.applyPeerHint([{ id: "ZZZZZZZZZZ", name: "Zed" }]);
    await flushAsyncWork();

    expect(pcs.size).toBe(pcCountAfterJoin);
    expect(signaling.sends.filter((s) => s.type === "offer").length).toBe(offersAfterJoin);
    await mesh.leave();
  });

  it("ignores hints that include the local peer id", async () => {
    const signaling = createMockSignaling({ peerId: "AAAAAAAAAA", peers: [] });
    const { mesh, pcs } = meshWithStubPc(signaling.client, {
      channel: "collab",
      initiatorRule: "lowerId",
    });

    await mesh.join({ name: "Alex", peerId: "AAAAAAAAAA" });
    mesh.applyPeerHint([{ id: "AAAAAAAAAA", name: "Alex" }]);
    await flushAsyncWork();

    expect(pcs.size).toBe(0);
    expect(signaling.sends.some((s) => s.type === "offer")).toBe(false);
    await mesh.leave();
  });

  it("recovers unknown_peer by re-joining the same peer id", async () => {
    const signaling = createMockSignaling({ peerId: "PEER_HIGH_ID", peers: [] });
    const { mesh } = meshWithStubPc(signaling.client, { recoverOnUnknownPeer: true });
    await mesh.join({ name: "Host", peerId: "PEER_HIGH_ID" });
    signaling.client.join.mockClear();
    signaling.client.poll.mockRejectedValueOnce(new Error("unknown_peer"));

    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(signaling.client.join).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Host", peerId: "PEER_HIGH_ID" }),
    );
    await mesh.leave();
  });

  it("does not run overlapping poll requests when poll is rescheduled", async () => {
    const signaling = createMockSignaling({ peerId: "peer-a", peers: [] });
    let resolvePoll: ((value: HttpSignalingPollResult) => void) | null = null;
    signaling.client.poll.mockImplementation(
      () =>
        new Promise<HttpSignalingPollResult>((resolve) => {
          resolvePoll = resolve;
        }),
    );

    const { mesh } = meshWithStubPc(signaling.client);
    await mesh.join({ name: "Host", peerId: "peer-a" });
    signaling.client.poll.mockClear();

    await vi.advanceTimersByTimeAsync(400);
    expect(signaling.client.poll).toHaveBeenCalledTimes(1);

    const meshWithSchedule = mesh as unknown as { schedulePoll: (steady?: boolean) => void };
    meshWithSchedule.schedulePoll(true);
    meshWithSchedule.schedulePoll(true);
    await vi.advanceTimersByTimeAsync(1200);

    expect(signaling.client.poll).toHaveBeenCalledTimes(1);

    resolvePoll!({ peers: [], messages: [] });
    await flushAsyncWork();
    await mesh.leave();
  });
});

describe("RtcPeerMesh principal roster cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries a failed principal peer instead of ghosting it", async () => {
    const signaling = createMockSignaling({
      peerId: "AAAAAAAAAA",
      peers: [{ id: "BBBBBBBBBB", name: "Remote", user: "remote" }],
    });
    const { mesh, pcs } = meshWithStubPc(signaling.client, {
      channel: "principal",
      initiatorRule: "lowerId",
    });

    await mesh.join({ name: "Host", peerId: "AAAAAAAAAA" });
    await flushAsyncWork();

    const failedPc = mesh.getPeerConnection("BBBBBBBBBB");
    expect(failedPc).toBeTruthy();
    const pcsBeforeFailure = pcs.size;

    const stub = asStubPeerConnection(failedPc!);
    stub.connectionState = "failed";
    const onStateChange = stub.onconnectionstatechange as ((ev: Event) => void) | null;
    onStateChange?.(new Event("connectionstatechange"));
    await flushAsyncWork();

    expect(mesh.getPeerConnection("BBBBBBBBBB")).toBeNull();

    await vi.advanceTimersByTimeAsync(10_000);
    await flushAsyncWork();

    expect(mesh.getPeerConnection("BBBBBBBBBB")).toBeTruthy();
    expect(pcs.size).toBeGreaterThan(pcsBeforeFailure);

    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();
    expect(mesh.getRoomPeers().map((peer) => peer.id)).toContain("BBBBBBBBBB");

    await mesh.leave();
  });

  it("keeps two same-user principal peers from different browsers", async () => {
    const { rtcLog } = await import("@/lib/rtc/log");
    vi.mocked(rtcLog).mockClear();
    const signaling = createMockSignaling({
      peerId: "admin-abc123",
      peers: [{ id: "wouter-old123456", name: "Wouter", user: "wouter" }],
    });
    const { mesh } = meshWithStubPc(signaling.client, {
      channel: "principal",
      initiatorRule: "lowerId",
    });

    await mesh.join({ name: "Admin", peerId: "admin-abc123" });
    await flushAsyncWork();

    signaling.setPollHandler(async () => ({
      peers: [
        { id: "wouter-old123456", name: "Wouter", user: "wouter" },
        { id: "wouter-new789012", name: "Wouter", user: "wouter" },
      ],
      messages: [],
    }));
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(
      mesh
        .getRoomPeers()
        .map((peer) => peer.id)
        .sort(),
    ).toEqual(["wouter-new789012", "wouter-old123456"]);
    expect(vi.mocked(rtcLog).mock.calls.some((call) => call[1] === "roster-ghost-dropped")).toBe(
      false,
    );
    await mesh.leave();
  });

  it("caps concurrent principal dials per poll cycle", async () => {
    const ghostPeers = Array.from({ length: 5 }, (_, index) => ({
      id: `ghost-${index}-000000`,
      name: `Ghost ${index}`,
      user: `user${index}`,
    }));
    const signaling = createMockSignaling({
      peerId: "admin-abc123",
      peers: ghostPeers,
    });
    const { mesh, pcs } = meshWithStubPc(signaling.client, {
      channel: "principal",
      initiatorRule: "lowerId",
    });

    await mesh.join({ name: "Admin", peerId: "admin-abc123" });
    await flushAsyncWork();

    expect(pcs.size).toBeLessThanOrEqual(3);
    await mesh.leave();
  });

  it("drops a ghost peer when signaling returns invalid_peer", async () => {
    const signaling = createMockSignaling({
      peerId: "admin-abc123",
      peers: [{ id: "wouter-stale123", name: "Wouter", user: "wouter" }],
    });
    signaling.client.send = vi.fn(async ({ to }) => {
      if (to === "wouter-stale123") {
        throw new Error("invalid_peer");
      }
      return { ok: true };
    });
    const { mesh, pcs } = meshWithStubPc(signaling.client, {
      channel: "principal",
      initiatorRule: "lowerId",
    });

    await mesh.join({ name: "Admin", peerId: "admin-abc123" });
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(pcs.has("wouter-stale123")).toBe(false);
    expect(mesh.getRoomPeers().some((peer) => peer.id === "wouter-stale123")).toBe(false);
    await mesh.leave();
  });
});

/**
 * The server only deletes what the cursor acks (#1086), so a row this client
 * skips is redelivered forever and a row it acks without handling is lost.
 */
describe("RtcPeerMesh delivery cursor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function pollSince(signaling: ReturnType<typeof createMockSignaling>): number | undefined {
    const input = signaling.client.poll.mock.calls.at(-1)?.[0] as { since?: number } | undefined;
    return input?.since;
  }

  it("acks chat and control rows, so no chat line is delivered twice", async () => {
    const delivered: string[] = [];
    const signaling = createMockSignaling({ peerId: "AAAAAAAAAA", peers: [] });
    const { mesh } = meshWithStubPc(signaling.client, {
      onPollData: (data) => {
        for (const message of data.messages) {
          delivered.push(String((message.payload as { text?: string }).text));
        }
      },
    });

    await mesh.join({ name: "Guest", peerId: "AAAAAAAAAA" });
    const mailbox = [
      { id: 4, from: "ZZZZZZZZZZ", type: "chat", payload: { text: "hello" } },
      { id: 9, from: "ZZZZZZZZZZ", type: "chat", payload: { text: "__wgw_meet_control__:{}" } },
    ];
    signaling.setPollHandler(async (input) => ({
      peers: [{ id: "ZZZZZZZZZZ", name: "Host" }],
      messages: mailbox.filter((message) => message.id > (input.since ?? 0)),
    }));

    for (let poll = 0; poll < 3; poll += 1) {
      await vi.advanceTimersByTimeAsync(poll === 0 ? 400 : 1200);
      await flushAsyncWork();
    }

    // The cursor cleared both rows, control line included, after one delivery.
    expect(delivered).toEqual(["hello", "__wgw_meet_control__:{}"]);
    expect(pollSince(signaling)).toBe(9);
    await mesh.leave();
  });

  it("acks while rtc signals are disabled, so a lobby guest is not resent its admit", async () => {
    const onPollData = vi.fn();
    const signaling = createMockSignaling({ peerId: "guest-1", peers: [] });
    const { mesh } = meshWithStubPc(signaling.client, {
      onPollData,
      shouldConnectToPeer: () => false,
      shouldHandleRtcSignals: () => false,
    });

    await mesh.join({ name: "__wgw_knock__:Ada", peerId: "guest-1" });
    const admit = {
      id: 12,
      from: "host-1",
      type: "chat",
      payload: { text: '__wgw_meet_control__:{"kind":"admit","peerId":"guest-1"}' },
    };
    signaling.setPollHandler(async (input) => ({
      peers: [{ id: "host-1", name: "Host" }],
      messages: (input.since ?? 0) < admit.id ? [admit] : [],
    }));

    for (let poll = 0; poll < 3; poll += 1) {
      await vi.advanceTimersByTimeAsync(poll === 0 ? 400 : 1200);
      await flushAsyncWork();
    }

    // The waiting client handles no RTC signal, but it still acked the admit, so
    // it was handed to the app exactly once (join poll + the one that carried it).
    expect(pollSince(signaling)).toBe(12);
    const admits = onPollData.mock.calls.filter((call) => call[0].messages.length > 0);
    expect(admits).toHaveLength(1);
    await mesh.leave();
  });

  it("re-polls the same cursor after a dropped response and handles the offer once", async () => {
    const signaling = createMockSignaling({ peerId: "AAAAAAAAAA", peers: [] });
    const { mesh } = meshWithStubPc(signaling.client, {
      channel: "collab",
      initiatorRule: "lowerId",
      shouldConnectToPeer: () => false,
      onPollError: vi.fn(),
    });

    await mesh.join({ name: "Guest", peerId: "AAAAAAAAAA" });

    // A mailbox that only serves what the cursor has not acked, like the server.
    const mailbox: HttpSignalingPollResult["messages"] = [
      {
        id: 5,
        from: "ZZZZZZZZZZ",
        type: "offer",
        payload: {
          type: "offer",
          sdp: "v=0\r\no=-\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n",
        },
      },
    ];
    const serveMailbox = async (input: MockPollInput): Promise<HttpSignalingPollResult> => ({
      peers: [{ id: "ZZZZZZZZZZ", name: "Host" }],
      messages: mailbox.filter((message) => (message.id ?? 0) > (input.since ?? 0)),
    });

    // The response carrying the offer never arrives.
    signaling.setPollHandler(async () => {
      throw new Error("network dropped");
    });
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();
    expect(pollSince(signaling)).toBe(0);
    expect(signaling.sends.filter((send) => send.type === "answer")).toHaveLength(0);

    // The cursor did not move, so the next poll gets the offer redelivered.
    signaling.setPollHandler(serveMailbox);
    await vi.advanceTimersByTimeAsync(1200);
    await flushAsyncWork();

    expect(signaling.sends.filter((send) => send.type === "answer")).toHaveLength(1);

    // Acked now, so the same row is not served — nor answered — a second time.
    await vi.advanceTimersByTimeAsync(1200);
    await flushAsyncWork();
    expect(pollSince(signaling)).toBe(5);
    expect(signaling.sends.filter((send) => send.type === "answer")).toHaveLength(1);

    await mesh.leave();
  });

  it("keeps polling after a poll is aborted mid-flight", async () => {
    const onPollError = vi.fn();
    const signaling = createMockSignaling({ peerId: "peer-a", peers: [] });
    const { mesh } = meshWithStubPc(signaling.client, { onPollError });

    await mesh.join({ name: "Host", peerId: "peer-a" });

    // What AbortSignal.timeout(10_000) does to a hung request.
    signaling.setPollHandler(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(onPollError).toHaveBeenCalledTimes(1);
    const pollsAfterAbort = signaling.client.poll.mock.calls.length;

    // pollInFlight was released, so the loop is still alive.
    signaling.setPollHandler(async () => ({ peers: [], messages: [] }));
    await vi.advanceTimersByTimeAsync(1200);
    await flushAsyncWork();

    expect(signaling.client.poll.mock.calls.length).toBeGreaterThan(pollsAfterAbort);
    await mesh.leave();
  });

  it("resets the cursor on leave so a fresh join starts from zero", async () => {
    const signaling = createMockSignaling({ peerId: "peer-a", peers: [] });
    const { mesh } = meshWithStubPc(signaling.client);

    await mesh.join({ name: "Host", peerId: "peer-a" });
    signaling.setPollHandler(async (input) => ({
      peers: [],
      messages:
        (input.since ?? 0) < 21
          ? [{ id: 21, from: "host-1", type: "chat", payload: { text: "hi" } }]
          : [],
    }));
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();
    await vi.advanceTimersByTimeAsync(1200);
    await flushAsyncWork();
    expect(pollSince(signaling)).toBe(21);

    await mesh.leave();
    signaling.setPollHandler(async () => ({ peers: [], messages: [] }));
    await mesh.join({ name: "Host", peerId: "peer-a" });
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();

    expect(pollSince(signaling)).toBe(0);
    await mesh.leave();
  });

  it("opens the negotiated meet channel when either side builds a peer connection", async () => {
    const init = { negotiated: true, id: 1, ordered: true };
    const offerSdp = "v=0\r\no=-\r\ns=-\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";

    const hostSignaling = createMockSignaling({
      peerId: "ZZZZZZZZZZ",
      peers: [{ id: "AAAAAAAAAA", name: "Guest" }],
    });
    const host = meshWithStubPc(hostSignaling.client);
    await host.mesh.join({ name: "Host", peerId: "ZZZZZZZZZZ" });
    await flushAsyncWork();
    const offerPc = [...host.pcs.values()][0];
    expect(offerPc?.createDataChannel).toHaveBeenCalledTimes(1);
    expect(offerPc?.createDataChannel).toHaveBeenCalledWith("meet", init);
    await host.mesh.leave();

    const guestSignaling = createMockSignaling({ peerId: "AAAAAAAAAA", peers: [] });
    const guest = meshWithStubPc(guestSignaling.client);
    await guest.mesh.join({ name: "Guest", peerId: "AAAAAAAAAA" });
    guestSignaling.setPollHandler(async () => ({
      peers: [{ id: "ZZZZZZZZZZ", name: "Host" }],
      messages: [
        {
          from: "ZZZZZZZZZZ",
          type: "offer",
          payload: { type: "offer", sdp: offerSdp },
        },
      ],
    }));
    await vi.advanceTimersByTimeAsync(400);
    await flushAsyncWork();
    const answerPc = [...guest.pcs.values()][0];
    expect(answerPc?.createDataChannel).toHaveBeenCalledTimes(1);
    expect(answerPc?.createDataChannel).toHaveBeenCalledWith("meet", init);
    await guest.mesh.leave();
  });
});
