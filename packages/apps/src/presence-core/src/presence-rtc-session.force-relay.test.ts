import { afterEach, describe, expect, it, vi } from "vitest";
import { PresenceRtcSession } from "@/presence-core/src/presence-rtc-session";

const captured = vi.hoisted(() => ({
  order: [] as string[],
  configs: [] as RTCConfiguration[],
  relayInputs: [] as Array<{ reason?: string; target?: string }>,
}));

vi.mock("@/lib/rtc/log", () => ({ rtcLog: vi.fn() }));
vi.mock("@/lib/rtc/telemetry/selected-pair", () => ({ logSelectedPairTelemetry: vi.fn() }));
vi.mock("@/lib/rtc/signaling/create-client", () => ({
  createRtcSignalingClient: () => ({
    join: async (input: { peerId?: string }) => ({
      peerId: input.peerId ?? "peer-a",
      peers: [{ id: "peer-z", name: "Ada", user: "ada" }],
      sessionKey: null,
    }),
    poll: async () => ({
      peers: [{ id: "peer-z", name: "Ada", user: "ada" }],
      messages: [],
    }),
    send: async () => ({ ok: true }),
    leave: async () => ({ ok: true }),
    relay: async (input: { reason?: string; target?: string }) => {
      captured.order.push("relay");
      captured.relayInputs.push(input);
      return {
        turn: {
          urls: ["turn:turn.example:3478"],
          username: "user",
          credential: "cred",
          ttl: 3600,
        },
      };
    },
  }),
}));

function installPeerConnection(): void {
  class StubPeerConnection {
    connectionState = "new";
    iceConnectionState = "new";
    iceGatheringState = "new";
    signalingState = "stable";
    localDescription: RTCSessionDescriptionInit | null = null;
    remoteDescription = null;
    onicecandidate = null;
    ontrack = null;
    onconnectionstatechange = null;
    oniceconnectionstatechange = null;
    onicegatheringstatechange = null;
    ondatachannel = null;

    constructor(config: RTCConfiguration) {
      captured.order.push("pc");
      captured.configs.push(config);
    }

    getSenders(): RTCRtpSender[] {
      return [];
    }

    close(): void {}

    async createOffer(): Promise<RTCSessionDescriptionInit> {
      return { type: "offer", sdp: "v=0\r\n" };
    }

    async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
      this.localDescription = desc;
      if (desc.type === "offer") this.signalingState = "have-local-offer";
    }

    async setRemoteDescription(): Promise<void> {}

    async addIceCandidate(): Promise<void> {}

    createDataChannel(): RTCDataChannel {
      return {
        binaryType: "blob",
        readyState: "connecting",
        label: "presence",
        close: () => undefined,
        send: () => undefined,
      } as unknown as RTCDataChannel;
    }
  }

  vi.stubGlobal("RTCPeerConnection", StubPeerConnection);
}

describe("PresenceRtcSession force relay", () => {
  afterEach(() => {
    captured.order.length = 0;
    captured.configs.length = 0;
    captured.relayInputs.length = 0;
    vi.unstubAllGlobals();
  });

  it("mints TURN before the first principal peer connection", async () => {
    installPeerConnection();
    const session = new PresenceRtcSession({
      room: "workspace",
      rtcSettings: {
        stunUrls: "stun:stun.example:3478",
        turnAvailable: true,
        forceRelay: true,
      },
    });
    await session.join("Ada");
    expect(captured.relayInputs[0]).toEqual(
      expect.objectContaining({ reason: "precheck", target: "*" }),
    );
    expect(captured.order[0]).toBe("relay");
    expect(captured.order.indexOf("pc")).toBeGreaterThan(0);
    expect(captured.configs[0]?.iceTransportPolicy).toBe("relay");
    await session.leave();
  });
});
