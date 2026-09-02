import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RtcPeerMesh } from "@/lib/rtc/session/peer-mesh";
import type {
  HttpSignalingClient,
  HttpSignalingPollResponse,
  HttpSignalingPollResult,
} from "@/lib/rtc/signaling/http-client";
import type { RtcSettings } from "@/lib/rtc/types";

vi.mock("@/lib/rtc/log", () => ({ rtcLog: vi.fn() }));
vi.mock("@/lib/rtc/telemetry/selected-pair", () => ({
  logSelectedPairTelemetry: vi.fn(),
}));

const RTC_SETTINGS: RtcSettings = {
  stunUrls: "",
  turnUrls: "",
  turnUsername: "",
  turnPassword: "",
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
  };

  return pc as unknown as RTCPeerConnection;
}

function asStubPeerConnection(pc: RTCPeerConnection): StubPeerConnection {
  return pc as unknown as StubPeerConnection;
}

function createMockSignaling(initialJoin: {
  peerId: string;
  peers?: Array<{ id: string; name: string }>;
  sessionKey?: string | null;
}) {
  const sends: Array<{ to: string; type: string; payload: unknown }> = [];
  let pollHandler: (() => Promise<HttpSignalingPollResponse>) | null = null;

  const client = {
    join: vi.fn(async (input: { peerId?: string; name: string }) => ({
      peerId: input.peerId ?? initialJoin.peerId,
      peers: initialJoin.peers ?? [],
      sessionKey: initialJoin.sessionKey ?? null,
    })),
    poll: vi.fn(async (_input?: unknown): Promise<HttpSignalingPollResponse> => {
      if (pollHandler) return pollHandler();
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
    setPollHandler(handler: () => Promise<HttpSignalingPollResponse>) {
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

  it("backs off collab polling when topology is stable", async () => {
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

    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 15000);
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
      | { sig?: string }
      | undefined;
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
