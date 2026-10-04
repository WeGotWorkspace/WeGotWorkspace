import { describe, expect, it } from "vitest";
import type { RtcPollIntervals } from "@/lib/rtc/types";
import { steadyPollDelayMs, type MeshPollCadenceSnapshot } from "./poll-cadence";

function hiddenCollab(): MeshPollCadenceSnapshot {
  return {
    channel: "collab",
    bindingKind: "data",
    rtcSignalsEnabled: true,
    roomPeers: [{ id: "aa".repeat(8), name: "Ada" }],
    linkStateOf: () => "connecting",
    hidden: true,
    peerConnectionCount: 0,
  };
}

describe("steadyPollDelayMs", () => {
  it("lets HTTP fallback cap the hidden-tab backoff at one second", () => {
    const intervals: RtcPollIntervals = {
      connectingMs: 400,
      steadyMs: 1000,
      maxDelayMs: 1000,
    };
    expect(steadyPollDelayMs(intervals, hiddenCollab())).toBe(1000);
  });
});
