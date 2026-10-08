import { describe, expect, it } from "vitest";
import { MeshPeerDialer } from "@/lib/rtc/session/mesh-peer-dialer";
import { MeshPeerRegistry } from "@/lib/rtc/session/mesh-peer-registry";
import type { TurnCredentials } from "@/lib/rtc/types";

const TURN: TurnCredentials = {
  urls: ["turn:turn.example:3478"],
  username: "user",
  credential: "cred",
  ttl: 3600,
};

function stubPc(): RTCPeerConnection {
  const pc = {
    connectionState: "new",
    iceConnectionState: "new",
    signalingState: "stable" as RTCSignalingState,
    localDescription: null as RTCSessionDescription | null,
    remoteDescription: null,
    getSenders: () => [],
    close: () => undefined,
    createOffer: async () => ({ type: "offer" as const, sdp: "v=0\r\n" }),
    setLocalDescription: async function (
      this: { signalingState: RTCSignalingState; localDescription: RTCSessionDescription | null },
      desc: RTCSessionDescriptionInit,
    ) {
      this.localDescription = desc as RTCSessionDescription;
      if (desc.type === "offer") this.signalingState = "have-local-offer";
    },
    createDataChannel: () => ({ close: () => undefined }),
  };
  return pc as unknown as RTCPeerConnection;
}

function harness(options?: { forceRelay?: boolean; turnAvailable?: boolean }) {
  const peers = new MeshPeerRegistry(undefined);
  const logs: Array<{ event: string; details?: unknown }> = [];
  const configs: RTCConfiguration[] = [];
  const offers: string[] = [];
  let now = 1_000_000;
  const dialer = new MeshPeerDialer({
    channel: "collab",
    rtcSettings: {
      stunUrls: "stun:stun.example:3478",
      turnAvailable: options?.turnAvailable ?? true,
      forceRelay: options?.forceRelay ?? false,
    },
    peers,
    createPeerConnection: (config) => {
      configs.push(config);
      return stubPc();
    },
    localPeerId: () => "peer-a",
    isInitiator: () => true,
    log: (event, details) => logs.push({ event, details }),
    formatOutbound: (description) => description,
    sendSignal: async (_to, type) => {
      if (type === "offer") offers.push("offer");
    },
    onRemoteSignalError: () => undefined,
    removePeer: (id) => {
      peers.close(id);
    },
    wirePeerConnection: () => undefined,
    now: () => now,
  });
  return {
    dialer,
    peers,
    logs,
    configs,
    offers,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("MeshPeerDialer initial mode", () => {
  it("does not open a peer connection when force-relay has no credentials", async () => {
    const { dialer, logs, configs, offers, peers } = harness({
      forceRelay: true,
      turnAvailable: true,
    });
    expect(dialer.needsRelayCredentials()).toBe(true);
    expect(dialer.initialMode()).toBe("direct");
    await dialer.connectTo("peer-z", "Ada");
    await dialer.connectTo("peer-y", "Bea");
    expect(peers.size).toBe(0);
    expect(configs).toEqual([]);
    expect(offers).toEqual([]);
    expect(logs.filter((row) => row.event === "relay-mode-without-credentials")).toEqual([
      { event: "relay-mode-without-credentials", details: { remoteId: "peer-z" } },
    ]);
  });

  it("uses relay once credentials have been fetched", async () => {
    const { dialer, configs, peers } = harness({ forceRelay: true, turnAvailable: true });
    dialer.setTurn(TURN);
    expect(dialer.needsRelayCredentials()).toBe(false);
    expect(dialer.initialMode()).toBe("relay");
    await dialer.connectTo("peer-z", "Ada");
    const entry = peers.get("peer-z");
    expect(entry?.mode).toBe("relay");
    expect(configs[0]?.iceTransportPolicy).toBe("relay");
  });

  it("still dials an ICE restart while force-relay credentials are missing", async () => {
    const { dialer, offers, peers, configs } = harness({ forceRelay: true, turnAvailable: true });
    await dialer.connectTo("peer-z", "Ada", "relay");
    expect(offers).toEqual(["offer"]);
    expect(peers.get("peer-z")?.mode).toBe("relay");
    expect(configs).toHaveLength(1);
  });
});

describe("MeshPeerDialer offer pending", () => {
  it("sends one offer when the same peer is dialed again 100ms later", async () => {
    const { dialer, logs, offers, advance } = harness();
    await dialer.connectTo("peer-z", "Ada");
    advance(100);
    await dialer.connectTo("peer-z", "Ada");
    expect(offers).toEqual(["offer"]);
    expect(logs).toContainEqual({
      event: "peer-skipped",
      details: { remoteId: "peer-z", reason: "offer-pending" },
    });
  });

  it("allows another offer once the pending offer is 10s old", async () => {
    const { dialer, logs, offers, peers, advance } = harness();
    await dialer.connectTo("peer-z", "Ada");
    const entry = peers.get("peer-z");
    if (!entry) throw new Error("missing entry");
    entry.signalSent = false;
    advance(10_000);
    await dialer.connectTo("peer-z", "Ada");
    expect(offers).toEqual(["offer", "offer"]);
    expect(
      logs.filter(
        (row) =>
          row.event === "peer-skipped" &&
          (row.details as { reason?: string } | undefined)?.reason === "offer-pending",
      ),
    ).toEqual([]);
  });

  it("does not skip an ICE restart while an offer is pending", async () => {
    const { dialer, logs, offers, peers } = harness();
    await dialer.connectTo("peer-z", "Ada");
    const entry = peers.get("peer-z");
    if (!entry) throw new Error("missing entry");
    entry.signalSent = false;
    await dialer.connectTo("peer-z", "Ada", "relay");
    expect(offers).toEqual(["offer", "offer"]);
    expect(
      logs.filter(
        (row) =>
          row.event === "peer-skipped" &&
          (row.details as { reason?: string } | undefined)?.reason === "offer-pending",
      ),
    ).toEqual([]);
  });
});
