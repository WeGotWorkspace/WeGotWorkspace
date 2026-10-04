import { rtcSdpMeta } from "@/lib/rtc/log";
import { icePayloadCandidates } from "@/lib/rtc/session/ice-batch";
import type { MeshPeerEntry } from "@/lib/rtc/session/mesh-peer-registry";
import { flushPendingIce, safeSetRemoteDescription } from "@/lib/rtc/session/sdp";

/**
 * Offer, answer, and ICE application for one mesh. Kept off `RtcPeerMesh` so
 * that file stays under the 800-line ceiling.
 */
export type MeshSdpExchange = {
  getPeer: (remoteId: string) => MeshPeerEntry | undefined;
  createEntry: (remoteId: string, remoteName: string, initiator: boolean) => MeshPeerEntry;
  formatInbound: (payload: unknown, fallbackType: RTCSdpType) => RTCSessionDescriptionInit | null;
  formatOutbound: (description: RTCSessionDescriptionInit) => RTCSessionDescriptionInit;
  sendSignal: (to: string, type: string, payload: unknown) => Promise<void>;
  onSignalError: (remoteId: string, error: unknown) => void;
  onSignaled: (remoteId: string) => void;
  log: (event: string, details?: unknown) => void;
};

async function rollBackIfUnstable(pc: RTCPeerConnection): Promise<void> {
  if (pc.signalingState === "stable") return;
  try {
    await pc.setLocalDescription({ type: "rollback" });
  } catch {
    // Ignore rollback failures on incompatible states.
  }
}

export async function acceptMeshOffer(
  exchange: MeshSdpExchange,
  from: string,
  peerName: string,
  payload: unknown,
): Promise<void> {
  exchange.log("offer-received", { from, ...rtcSdpMeta(payload) });
  const sdp = exchange.formatInbound(payload, "offer");
  if (!sdp) return;
  const entry = exchange.getPeer(from) ?? exchange.createEntry(from, peerName, false);
  await rollBackIfUnstable(entry.pc);
  await safeSetRemoteDescription(entry.pc, sdp);
  await flushPendingIce(entry.pc, entry.pendingIce);
  const answer = await entry.pc.createAnswer();
  const formatted = exchange.formatOutbound(answer);
  await entry.pc.setLocalDescription(formatted);
  try {
    await exchange.sendSignal(from, "answer", entry.pc.localDescription);
  } catch (error) {
    exchange.onSignalError(from, error);
    return;
  }
  entry.signalSent = true;
  exchange.onSignaled(from);
  exchange.log("answer-sent", { to: from, ...rtcSdpMeta(entry.pc.localDescription) });
}

export async function acceptMeshAnswer(
  exchange: MeshSdpExchange,
  from: string,
  payload: unknown,
): Promise<void> {
  exchange.log("answer-received", { from, ...rtcSdpMeta(payload) });
  const entry = exchange.getPeer(from);
  if (!entry) return;
  const sdp = exchange.formatInbound(payload, "answer");
  if (!sdp) return;
  if (entry.pc.signalingState === "stable") return;
  await safeSetRemoteDescription(entry.pc, sdp);
  await flushPendingIce(entry.pc, entry.pendingIce);
}

export async function acceptMeshIce(
  exchange: MeshSdpExchange,
  from: string,
  payload: unknown,
): Promise<void> {
  const entry = exchange.getPeer(from);
  if (!entry) return;
  for (const candidate of icePayloadCandidates(payload)) {
    if (!entry.pc.remoteDescription) {
      entry.pendingIce.push(candidate);
      continue;
    }
    try {
      await entry.pc.addIceCandidate(candidate);
    } catch {
      if (!entry.pc.remoteDescription) entry.pendingIce.push(candidate);
    }
  }
}
