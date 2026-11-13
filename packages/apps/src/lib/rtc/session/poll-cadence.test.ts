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

describe("collab idle cadence (#2156)", () => {
  const intervals: RtcPollIntervals = { connectingMs: 400, steadyMs: 1200 };
  const peer = { id: "bb".repeat(8), name: "Bea" };
  function collab(overrides: Partial<MeshPollCadenceSnapshot>): MeshPollCadenceSnapshot {
    return {
      channel: "collab",
      bindingKind: "data",
      rtcSignalsEnabled: true,
      roomPeers: [],
      linkStateOf: () => null,
      hidden: false,
      peerConnectionCount: 0,
      ...overrides,
    };
  }

  it("keeps the 2s alone poll for a minute after the roster changed, then waits 15s", () => {
    expect(steadyPollDelayMs(intervals, collab({ quietForMs: 59_999 }))).toBe(2_000);
    expect(steadyPollDelayMs(intervals, collab({ quietForMs: 60_000 }))).toBe(15_000);
  });

  it("polls fast while a new peer is dialled, and stops once it is past the window", () => {
    const dialing = collab({ roomPeers: [peer], isDialing: () => true, quietForMs: 90_000 });
    expect(steadyPollDelayMs(intervals, dialing)).toBe(1_200);
    const ghost = collab({ roomPeers: [peer], isDialing: () => false, quietForMs: 90_000 });
    expect(steadyPollDelayMs(intervals, ghost)).toBe(15_000);
  });

  it("counts a peer linked through collab reuse as linked", () => {
    const reused = collab({
      roomPeers: [peer],
      isDialing: (_id, linkedNow) => !linkedNow,
      linkedElsewhere: (id) => id === peer.id,
    });
    expect(hasStableCollabTopology(reused)).toBe(true);
    expect(steadyPollDelayMs(intervals, reused)).toBe(5_000);
  });

  it("lets the HTTP fallback cap the idle backoff", () => {
    const capped: RtcPollIntervals = { connectingMs: 400, steadyMs: 3_000, maxDelayMs: 3_000 };
    expect(steadyPollDelayMs(capped, collab({ quietForMs: 90_000 }))).toBe(3_000);
  });
});
