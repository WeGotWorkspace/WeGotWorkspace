import { describe, expect, it, vi } from "vitest";
import { MeshPeerDialer } from "@/lib/rtc/session/mesh-peer-dialer";
import { MeshPeerRegistry, type MeshPeerEntry } from "@/lib/rtc/session/mesh-peer-registry";
import {
  acceptMeshAnswer,
  acceptMeshOffer,
  type MeshSdpExchange,
} from "@/lib/rtc/session/mesh-sdp-exchange";
import type { TurnCredentials } from "@/lib/rtc/types";

function exchangeFor(
  signalingState: RTCSignalingState,
  setRemoteDescription: ReturnType<typeof vi.fn>,
  log: MeshSdpExchange["log"],
): MeshSdpExchange {
  const pc = {
    signalingState,
    setRemoteDescription,
    addIceCandidate: vi.fn(async () => undefined),
  } as unknown as RTCPeerConnection;
  const entry = { pc, pendingIce: [] } as unknown as MeshPeerEntry;
  return {
    getPeer: () => entry,
    createEntry: () => entry,
    formatInbound: (payload) => payload as RTCSessionDescriptionInit,
    formatOutbound: (description) => description,
    sendSignal: async () => undefined,
    onSignalError: () => undefined,
    onSignaled: () => undefined,
    needsRelayCredentials: () => false,
    prepareRelay: async () => undefined,
    log,
  };
}

const answer = { type: "answer" as const, sdp: "v=0\r\n" };

describe("acceptMeshAnswer", () => {
  it("ignores an answer that arrives in stable and does not set the remote description", async () => {
    const setRemoteDescription = vi.fn(async () => undefined);
    const logs: Array<{ event: string; details?: unknown }> = [];
    await acceptMeshAnswer(
      exchangeFor("stable", setRemoteDescription, (event, details) =>
        logs.push({ event, details }),
      ),
      "peer-z",
      answer,
    );
    expect(setRemoteDescription).not.toHaveBeenCalled();
    expect(logs).toContainEqual({
      event: "answer-ignored",
      details: { remoteId: "peer-z", signalingState: "stable" },
    });
  });

  it("applies an answer while the local offer is still outstanding", async () => {
    const setRemoteDescription = vi.fn(async () => undefined);
    await acceptMeshAnswer(
      exchangeFor("have-local-offer", setRemoteDescription, () => undefined),
      "peer-z",
      answer,
    );
    expect(setRemoteDescription).toHaveBeenCalledWith(answer);
  });
});

const TURN: TurnCredentials = {
  urls: ["turn:turn.example:3478"],
  username: "user",
  credential: "cred",
  ttl: 3600,
};

const offer = { type: "offer" as const, sdp: "v=0\r\n" };

function answerablePc(): RTCPeerConnection {
  const pc = {
    connectionState: "new",
    iceConnectionState: "new",
    signalingState: "stable" as RTCSignalingState,
    localDescription: null as RTCSessionDescription | null,
    remoteDescription: null as RTCSessionDescription | null,
    getSenders: () => [],
    close: () => undefined,
    setRemoteDescription: async function (desc: RTCSessionDescriptionInit) {
      this.remoteDescription = desc as RTCSessionDescription;
      this.signalingState = "have-remote-offer";
    },
    createAnswer: async () => ({ type: "answer" as const, sdp: "v=0\r\n" }),
    setLocalDescription: async function (desc: RTCSessionDescriptionInit) {
      this.localDescription = desc as RTCSessionDescription;
      if (desc.type === "answer") this.signalingState = "stable";
    },
    addIceCandidate: async () => undefined,
    createDataChannel: () => ({ close: () => undefined }),
  };
  return pc as unknown as RTCPeerConnection;
}

function offerExchange(mint: "ok" | "fail") {
  const peers = new MeshPeerRegistry(undefined);
  const logs: Array<{ event: string; details?: unknown }> = [];
  const answers: string[] = [];
  const dialer = new MeshPeerDialer({
    channel: "collab",
    rtcSettings: {
      stunUrls: "stun:stun.example:3478",
      turnAvailable: true,
      forceRelay: true,
    },
    peers,
    createPeerConnection: () => answerablePc(),
    localPeerId: () => "peer-a",
    isInitiator: () => false,
    log: (event, details) => logs.push({ event, details }),
    formatOutbound: (description) => description,
    sendSignal: async () => undefined,
    onRemoteSignalError: () => undefined,
    removePeer: (id) => {
      peers.close(id);
    },
    wirePeerConnection: () => undefined,
  });
  const exchange: MeshSdpExchange = {
    getPeer: (id) => peers.get(id),
    createEntry: (id, name, initiator) => dialer.createEntry(id, name, initiator),
    needsRelayCredentials: () => dialer.needsRelayCredentials(),
    prepareRelay: async () => {
      if (mint === "ok") dialer.setTurn(TURN);
    },
    formatInbound: (payload) => payload as RTCSessionDescriptionInit,
    formatOutbound: (description) => description,
    sendSignal: async (_to, type) => {
      if (type === "answer") answers.push(type);
    },
    onSignalError: () => undefined,
    onSignaled: () => undefined,
    log: (event, details) => logs.push({ event, details }),
  };
  return { exchange, peers, logs, answers };
}

describe("acceptMeshOffer", () => {
  it("creates a relay peer connection when the credential mint succeeds", async () => {
    const { exchange, peers, answers } = offerExchange("ok");
    await acceptMeshOffer(exchange, "peer-z", "Ada", offer);
    expect(peers.get("peer-z")?.mode).toBe("relay");
    expect(answers).toEqual(["answer"]);
  });

  it("drops the offer and creates no peer connection when the mint fails", async () => {
    const { exchange, peers, logs, answers } = offerExchange("fail");
    await acceptMeshOffer(exchange, "peer-z", "Ada", offer);
    expect(peers.size).toBe(0);
    expect(answers).toEqual([]);
    expect(logs).toContainEqual({
      event: "offer-dropped",
      details: { from: "peer-z", reason: "relay-credentials-missing" },
    });
  });
});
