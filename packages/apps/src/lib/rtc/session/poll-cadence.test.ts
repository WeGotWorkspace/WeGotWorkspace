import { describe, expect, it } from "vitest";
import type { RtcPollIntervals } from "@/lib/rtc/types";
import {
  hasStableCollabTopology,
  steadyPollDelayMs,
  type MeshPollCadenceSnapshot,
} from "./poll-cadence";

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

  it("polls an empty collab room every 2s and a fully linked room every 5s", () => {
    const intervals: RtcPollIntervals = { connectingMs: 400, steadyMs: 1200 };
    const alone: MeshPollCadenceSnapshot = {
      channel: "collab",
      bindingKind: "data",
      rtcSignalsEnabled: true,
      roomPeers: [],
      linkStateOf: () => null,
      hidden: false,
      peerConnectionCount: 0,
    };
    const stable: MeshPollCadenceSnapshot = {
      ...alone,
      roomPeers: [{ id: "aa".repeat(8), name: "Ada" }],
      linkStateOf: () => "connected",
      peerConnectionCount: 1,
    };

    expect(hasStableCollabTopology(alone)).toBe(false);
    expect(steadyPollDelayMs(intervals, alone)).toBe(2_000);
    expect(hasStableCollabTopology(stable)).toBe(true);
    expect(steadyPollDelayMs(intervals, stable)).toBe(5_000);
  });
});
