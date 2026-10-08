import { describe, expect, it, vi } from "vitest";
import type { MeshPeerEntry } from "@/lib/rtc/session/mesh-peer-registry";
import { acceptMeshAnswer, type MeshSdpExchange } from "@/lib/rtc/session/mesh-sdp-exchange";

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
