import type { SignalingChannel } from "@/lib/rtc/types";
import { rtcLog } from "@/lib/rtc/log";

export type SelectedPairSummary = {
  state?: string;
  rtt?: number;
  localType?: string;
  localProtocol?: string;
  remoteType?: string;
  remoteProtocol?: string;
};

/**
 * Chrome omits `pair.selected` and can nominate more than one pair.
 * `transport.selectedCandidatePairId` is the pair actually in use.
 * Same rule as `selectedPairIsRelay`.
 */
function selectedCandidatePairId(report: RTCStatsReport): string | null {
  for (const row of report.values()) {
    if (row.type !== "transport") continue;
    const id = (row as RTCStats & { selectedCandidatePairId?: string }).selectedCandidatePairId;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return null;
}

export async function readSelectedPairSummary(
  pc: RTCPeerConnection,
): Promise<SelectedPairSummary | null> {
  const report = await pc.getStats();
  const candidateById = new Map<string, RTCStats>();
  let fallback: RTCStats | null = null;

  for (const row of report.values()) {
    if (row.type === "local-candidate" || row.type === "remote-candidate") {
      candidateById.set(row.id, row);
    }
    if (row.type !== "candidate-pair") continue;
    const pair = row as RTCStats & {
      selected?: boolean;
      nominated?: boolean;
      state?: string;
    };
    const maybeSelected =
      pair.selected === true || (pair.nominated === true && pair.state === "succeeded");
    if (maybeSelected) fallback = row;
  }

  const selectedId = selectedCandidatePairId(report);
  const chosen = selectedId ? (report.get(selectedId) ?? null) : fallback;
  const selectedPair = chosen?.type === "candidate-pair" ? chosen : null;

  const pair = selectedPair as
    | (RTCStats & {
        state?: string;
        localCandidateId?: string;
        remoteCandidateId?: string;
        currentRoundTripTime?: number;
      })
    | null;
  if (!pair) return null;

  const local = pair.localCandidateId ? candidateById.get(pair.localCandidateId) : null;
  const remote = pair.remoteCandidateId ? candidateById.get(pair.remoteCandidateId) : null;

  return {
    state: pair.state,
    rtt: pair.currentRoundTripTime,
    localType: (local as RTCStats & { candidateType?: string })?.candidateType,
    localProtocol: (local as RTCStats & { protocol?: string })?.protocol,
    remoteType: (remote as RTCStats & { candidateType?: string })?.candidateType,
    remoteProtocol: (remote as RTCStats & { protocol?: string })?.protocol,
  };
}

export async function logSelectedPairTelemetry(
  channel: SignalingChannel,
  peerId: string | null,
  remoteId: string,
  pc: RTCPeerConnection,
  reason: "connected" | "failed" | "relay-fallback",
): Promise<void> {
  try {
    const selectedPair = await readSelectedPairSummary(pc);
    rtcLog({ channel, peerId }, "selected-pair", {
      remoteId,
      reason,
      connectionState: pc.connectionState,
      iceConnectionState: pc.iceConnectionState,
      selectedPair,
    });
  } catch (error) {
    rtcLog({ channel, peerId }, "selected-pair-error", { remoteId, reason, error });
  }
}
