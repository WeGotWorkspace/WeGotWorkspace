import { describe, expect, it } from "vitest";
import type { RtcPollIntervals } from "@/lib/rtc/types";
import {
  DOORBELL_HEARTBEAT_POLL_INTERVAL_MS,
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

describe("behind the push doorbell (#2294)", () => {
  const intervals: RtcPollIntervals = { connectingMs: 400, steadyMs: 1200 };
  const alone = (channel: MeshPollCadenceSnapshot["channel"], doorbell: boolean) =>
    ({
      channel,
      bindingKind: channel === "meet" ? "media" : "data",
      rtcSignalsEnabled: true,
      roomPeers: [],
      linkStateOf: () => null,
      hidden: false,
      peerConnectionCount: 0,
      doorbell,
    }) satisfies MeshPollCadenceSnapshot;

  it("a lone peer only heartbeats, below every channel's peer timeout (60-90 s)", () => {
    for (const channel of ["collab", "principal", "meet"] as const) {
      const delay = steadyPollDelayMs(intervals, alone(channel, true));
      expect(delay).toBe(DOORBELL_HEARTBEAT_POLL_INTERVAL_MS);
      expect(delay).toBeLessThan(60_000);
    }
  });

  it("arms no steady poll when the push read carries the peer (#2287), but still dials fast", () => {
    const carried = { ...alone("meet", true), pushHeartbeat: true };
    expect(steadyPollDelayMs(intervals, carried)).toBe(Number.POSITIVE_INFINITY);
    expect(steadyPollDelayMs(intervals, { ...carried, hidden: true })).toBe(
      Number.POSITIVE_INFINITY,
    );
    const dialing: MeshPollCadenceSnapshot = {
      ...carried,
      roomPeers: [{ id: "bb".repeat(8), name: "Bo" }],
      linkStateOf: () => "connecting",
      isDialing: () => true,
    };
    expect(steadyPollDelayMs(intervals, dialing)).toBe(intervals.steadyMs);
    // Push down: the peer's own cadence, whatever the heartbeat flag says.
    expect(steadyPollDelayMs(intervals, { ...carried, doorbell: false })).toBe(
      steadyPollDelayMs(intervals, alone("meet", false)),
    );
  });

  it("keeps today's cadence while push is down", () => {
    expect(steadyPollDelayMs(intervals, alone("collab", false))).toBe(2_000);
    expect(steadyPollDelayMs(intervals, alone("principal", false))).toBe(1_200);
  });

  it("keeps the connecting cadence while a peer is being dialled", () => {
    const snapshot: MeshPollCadenceSnapshot = {
      ...alone("collab", true),
      roomPeers: [{ id: "bb".repeat(8), name: "Bo" }],
      linkStateOf: () => "connecting",
      isDialing: () => true,
    };
    expect(steadyPollDelayMs(intervals, snapshot)).toBe(intervals.steadyMs);

    // Past the dial window the peer no longer counts: back to the heartbeat.
    expect(steadyPollDelayMs(intervals, { ...snapshot, isDialing: () => false })).toBe(
      DOORBELL_HEARTBEAT_POLL_INTERVAL_MS,
    );
  });

  it("heartbeats a fully linked room too, and never polls faster than before", () => {
    const linked: MeshPollCadenceSnapshot = {
      ...alone("meet", true),
      roomPeers: [{ id: "peer-2", name: "Alex" }],
      linkStateOf: () => "connected",
      peerConnectionCount: 1,
    };
    expect(steadyPollDelayMs(intervals, linked)).toBe(DOORBELL_HEARTBEAT_POLL_INTERVAL_MS);
    expect(
      steadyPollDelayMs({ connectingMs: 400, steadyMs: 40_000 }, alone("principal", true)),
    ).toBe(40_000);
  });

  it("leaves the HTTP fallback's one-second cap alone", () => {
    expect(steadyPollDelayMs({ ...intervals, maxDelayMs: 1_000 }, alone("collab", true))).toBe(
      1_000,
    );
  });
});
