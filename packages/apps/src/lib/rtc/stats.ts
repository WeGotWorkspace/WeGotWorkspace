type CandidatePairStats = RTCStats & {
  selected?: boolean;
  nominated?: boolean;
  localCandidateId?: string;
};

type TransportStats = RTCStats & {
  selectedCandidatePairId?: string;
};

/**
 * `getStats` selected pair is a relay. Re-run after every ICE restart.
 *
 * Chrome omits `pair.selected` and can mark more than one pair `nominated`.
 * `transport.selectedCandidatePairId` is the pair actually in use.
 */
export async function selectedPairIsRelay(pc: RTCPeerConnection): Promise<boolean> {
  const stats = await pc.getStats();
  const selectedId = selectedCandidatePairId(stats);
  if (selectedId) {
    const pair = stats.get(selectedId);
    if (!pair || pair.type !== "candidate-pair") return false;
    return pairUsesRelay(stats, pair as CandidatePairStats);
  }
  let relay = false;
  stats.forEach((report) => {
    if (report.type !== "candidate-pair") return;
    const pair = report as CandidatePairStats;
    if (!pair.selected && !pair.nominated) return;
    if (pairUsesRelay(stats, pair)) relay = true;
  });
  return relay;
}

function selectedCandidatePairId(stats: RTCStatsReport): string | null {
  let selectedId: string | null = null;
  stats.forEach((report) => {
    if (selectedId || report.type !== "transport") return;
    const id = (report as TransportStats).selectedCandidatePairId;
    if (typeof id === "string" && id.length > 0) selectedId = id;
  });
  return selectedId;
}

function pairUsesRelay(stats: RTCStatsReport, pair: CandidatePairStats): boolean {
  const local = pair.localCandidateId ? stats.get(pair.localCandidateId) : undefined;
  const kind = local && "candidateType" in local ? String(local.candidateType) : "";
  return kind === "relay";
}
