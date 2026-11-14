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

  it("polls fast while a new peer is dialled, and stops once it is past the window", () => {
    const dialing = collab({ roomPeers: [peer], isDialing: () => true });
    expect(steadyPollDelayMs(intervals, dialing)).toBe(1_200);
    const ghost = collab({ roomPeers: [peer], isDialing: () => false });
    expect(steadyPollDelayMs(intervals, ghost)).toBe(2_000);
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

  it("caps even a linked room at the HTTP fallback's idle poll", () => {
    const capped: RtcPollIntervals = { connectingMs: 400, steadyMs: 2_000, maxDelayMs: 2_000 };
    const linked = collab({ roomPeers: [peer], linkStateOf: () => "connected" });
    expect(steadyPollDelayMs(capped, linked)).toBe(2_000);
  });
});
