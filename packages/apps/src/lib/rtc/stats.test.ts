import { describe, expect, it } from "vitest";
import { selectedPairIsRelay } from "@/lib/rtc/stats";

function stats(entries: Array<[string, Record<string, unknown>]>): RTCStatsReport {
  return new Map(entries) as unknown as RTCStatsReport;
}

function connection(report: RTCStatsReport): RTCPeerConnection {
  return { getStats: async () => report } as RTCPeerConnection;
}

describe("selectedPairIsRelay", () => {
  it("follows transport.selectedCandidatePairId when Chrome nominates more than one pair", async () => {
    const report = stats([
      ["transport", { type: "transport", selectedCandidatePairId: "pair-direct" }],
      ["pair-relay", { type: "candidate-pair", nominated: true, localCandidateId: "local-relay" }],
      [
        "pair-direct",
        { type: "candidate-pair", nominated: true, localCandidateId: "local-direct" },
      ],
      ["local-relay", { type: "local-candidate", candidateType: "relay" }],
      ["local-direct", { type: "local-candidate", candidateType: "host" }],
    ]);
    expect(await selectedPairIsRelay(connection(report))).toBe(false);

    const relaySelected = stats([
      ["transport", { type: "transport", selectedCandidatePairId: "pair-relay" }],
      ["pair-relay", { type: "candidate-pair", nominated: true, localCandidateId: "local-relay" }],
      [
        "pair-direct",
        { type: "candidate-pair", nominated: true, localCandidateId: "local-direct" },
      ],
      ["local-relay", { type: "local-candidate", candidateType: "relay" }],
      ["local-direct", { type: "local-candidate", candidateType: "host" }],
    ]);
    expect(await selectedPairIsRelay(connection(relaySelected))).toBe(true);
  });

  it("falls back to selected or nominated when the transport has no pair id", async () => {
    const selected = stats([
      ["pair", { type: "candidate-pair", selected: true, localCandidateId: "local" }],
      ["local", { type: "local-candidate", candidateType: "relay" }],
    ]);
    expect(await selectedPairIsRelay(connection(selected))).toBe(true);

    const nominated = stats([
      ["pair", { type: "candidate-pair", nominated: true, localCandidateId: "local" }],
      ["local", { type: "local-candidate", candidateType: "host" }],
    ]);
    expect(await selectedPairIsRelay(connection(nominated))).toBe(false);

    const idle = stats([
      ["pair", { type: "candidate-pair", localCandidateId: "local" }],
      ["local", { type: "local-candidate", candidateType: "relay" }],
    ]);
    expect(await selectedPairIsRelay(connection(idle))).toBe(false);
  });
});
