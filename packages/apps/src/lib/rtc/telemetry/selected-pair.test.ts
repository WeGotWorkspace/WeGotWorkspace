import { describe, expect, it } from "vitest";
import { readSelectedPairSummary } from "@/lib/rtc/telemetry/selected-pair";

function stats(entries: Array<[string, Record<string, unknown>]>): RTCStatsReport {
  return new Map(entries) as unknown as RTCStatsReport;
}

function connection(report: RTCStatsReport): RTCPeerConnection {
  return { getStats: async () => report } as RTCPeerConnection;
}

describe("readSelectedPairSummary", () => {
  it("uses the transport pair when Chrome nominates a relay pair as well", async () => {
    const report = stats([
      ["transport", { id: "transport", type: "transport", selectedCandidatePairId: "pair-direct" }],
      [
        "pair-relay",
        {
          id: "pair-relay",
          type: "candidate-pair",
          nominated: true,
          state: "succeeded",
          localCandidateId: "local-relay",
        },
      ],
      [
        "pair-direct",
        {
          id: "pair-direct",
          type: "candidate-pair",
          nominated: true,
          state: "succeeded",
          localCandidateId: "local-direct",
        },
      ],
      [
        "local-relay",
        { id: "local-relay", type: "local-candidate", candidateType: "relay", protocol: "udp" },
      ],
      [
        "local-direct",
        { id: "local-direct", type: "local-candidate", candidateType: "host", protocol: "udp" },
      ],
    ]);

    const summary = await readSelectedPairSummary(connection(report));
    expect(summary?.localType).toBe("host");
  });

  it("falls back to a succeeded nominated pair when the transport has no id", async () => {
    const report = stats([
      [
        "pair",
        {
          id: "pair",
          type: "candidate-pair",
          nominated: true,
          state: "succeeded",
          localCandidateId: "local",
        },
      ],
      ["local", { id: "local", type: "local-candidate", candidateType: "srflx", protocol: "udp" }],
    ]);

    const summary = await readSelectedPairSummary(connection(report));
    expect(summary?.localType).toBe("srflx");
  });

  it("returns null when no pair is selected", async () => {
    const report = stats([
      ["pair", { id: "pair", type: "candidate-pair", localCandidateId: "local" }],
      ["local", { id: "local", type: "local-candidate", candidateType: "host" }],
    ]);

    expect(await readSelectedPairSummary(connection(report))).toBeNull();
  });
});
