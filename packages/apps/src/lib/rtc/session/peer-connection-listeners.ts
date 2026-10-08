import { parseCandidateProtocol, parseCandidateType } from "@/lib/rtc/session/sdp";
import type { MeshPeerEntry } from "@/lib/rtc/session/mesh-peer-registry";
import { logSelectedPairTelemetry } from "@/lib/rtc/telemetry/selected-pair";
import type { SignalingChannel } from "@/lib/rtc/types";

/** What the listeners need from the mesh that owns the peer entry. */
export type PeerConnectionListenerContext = {
  channel: SignalingChannel;
  localPeerId: () => string | null;
  log: (event: string, details?: unknown) => void;
  sendIceCandidate: (remoteId: string, candidate: RTCIceCandidateInit) => void;
  onConnected: (remoteId: string) => void;
  onFailure: (remoteId: string, entry: MeshPeerEntry) => void;
  onIceState?: (remoteId: string, state: RTCIceConnectionState) => void;
  onLinkChange: () => void;
};

/**
 * Attach the `RTCPeerConnection` event handlers of one mesh peer: trickling local
 * ICE candidates out, logging every state transition, and reporting selected-pair
 * telemetry when the link comes up or dies.
 */
export function wirePeerConnectionListeners(
  remoteId: string,
  entry: MeshPeerEntry,
  context: PeerConnectionListenerContext,
): void {
  const { pc } = entry;
  const telemetry = (reason: "connected" | "failed") => {
    void logSelectedPairTelemetry(context.channel, context.localPeerId(), remoteId, pc, reason);
  };

  pc.onicecandidate = (event) => {
    const candidate = event.candidate?.toJSON();
    if (
      !candidate ||
      typeof candidate.candidate !== "string" ||
      candidate.candidate.trim() === ""
    ) {
      if (event.candidate === null) context.log("ice-candidate-local-end", { remoteId });
      return;
    }
    context.log("ice-candidate-local", {
      remoteId,
      mode: entry.mode,
      candidateType: parseCandidateType(candidate.candidate),
      protocol: parseCandidateProtocol(candidate.candidate),
    });
    context.sendIceCandidate(remoteId, candidate);
  };

  pc.onconnectionstatechange = () => {
    context.log("pc-connection-state", {
      remoteId,
      mode: entry.mode,
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
    });
    if (pc.connectionState === "connected") {
      telemetry("connected");
      context.onConnected(remoteId);
    }
    if (pc.connectionState === "failed") {
      telemetry("failed");
      context.onFailure(remoteId, entry);
    }
    context.onLinkChange();
  };

  pc.oniceconnectionstatechange = () => {
    context.log("ice-connection-state", {
      remoteId,
      iceConnectionState: pc.iceConnectionState,
      connectionState: pc.connectionState,
    });
    if (pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed") {
      telemetry("connected");
    }
    if (pc.iceConnectionState === "failed") {
      context.onFailure(remoteId, entry);
    }
    context.onIceState?.(remoteId, pc.iceConnectionState);
    context.onLinkChange();
  };

  pc.onicegatheringstatechange = () => {
    context.log("ice-gathering-state", { remoteId, iceGatheringState: pc.iceGatheringState });
  };
}
