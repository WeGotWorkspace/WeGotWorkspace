import { describe, expect, it, vi } from "vitest";
import { MeshPollLoop, type MeshPollLoopContext } from "@/lib/rtc/session/mesh-poll-loop";
import type { MeshPollCadenceSnapshot } from "@/lib/rtc/session/poll-cadence";
import { MEET_RTC_POLL_INTERVALS } from "@/lib/rtc/types";

function stableMeetCadence(): MeshPollCadenceSnapshot {
  return {
    channel: "meet",
    bindingKind: "media",
    rtcSignalsEnabled: true,
    roomPeers: [{ id: "peer-2", name: "Alex" }],
    linkStateOf: () => "connected",
    hidden: false,
    peerConnectionCount: 1,
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

function createLoop(overrides: Partial<MeshPollLoopContext> = {}) {
  const scheduled: Array<{ delay: number; fn: () => void }> = [];
  const context: MeshPollLoopContext = {
    myId: () => "peer-1",
    poll: vi.fn(async () => ({ peers: [], messages: [] })),
    pollInput: () => ({ room: "room-1" }),
    setRosterSig: vi.fn(),
    onPoll: vi.fn(async () => {}),
    pollIntervals: () => MEET_RTC_POLL_INTERVALS,
    cadence: () => stableMeetCadence(),
    shouldRecover: () => false,
    recover: vi.fn(async () => {}),
    isVisible: () => true,
    log: vi.fn(),
    scheduleTimeout: ((fn: () => void, delay: number) => {
      scheduled.push({ delay, fn: fn as () => void });
      return scheduled.length as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout,
    cancelTimeout: vi.fn() as typeof clearTimeout,
    ...overrides,
  };
  return { loop: new MeshPollLoop(context), context, scheduled };
}

describe("MeshPollLoop.kick", () => {
  it("schedules at connectingMs when idle, not the steady idle delay", () => {
    const { loop, scheduled } = createLoop();
    loop.kick();
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.delay).toBe(MEET_RTC_POLL_INTERVALS.connectingMs);
    expect(scheduled[0]?.delay).toBe(400);
  });

  it("defers a kick during an in-flight poll and uses connectingMs on the next schedule", async () => {
    let resolvePoll!: (value: { peers: []; messages: [] }) => void;
    const poll = vi.fn(
      () =>
        new Promise<{ peers: []; messages: [] }>((resolve) => {
          resolvePoll = resolve;
        }),
    );
    const { loop, scheduled } = createLoop({ poll });

    loop.schedule(false);
    expect(scheduled[0]?.delay).toBe(400);
    scheduled[0]?.fn();
    expect(poll).toHaveBeenCalledTimes(1);

    loop.kick();
    // Still only the original timer; kick is deferred while in flight.
    expect(scheduled).toHaveLength(1);

    resolvePoll({ peers: [], messages: [] });
    await flushMicrotasks();

    expect(scheduled).toHaveLength(2);
    expect(scheduled[1]?.delay).toBe(MEET_RTC_POLL_INTERVALS.connectingMs);
  });

  it("release clears a pending kick so the next schedule is steady", async () => {
    let resolvePoll!: (value: { peers: []; messages: [] }) => void;
    const poll = vi.fn(
      () =>
        new Promise<{ peers: []; messages: [] }>((resolve) => {
          resolvePoll = resolve;
        }),
    );
    const { loop, scheduled } = createLoop({ poll });

    loop.schedule(false);
    scheduled[0]?.fn();
    loop.kick();
    loop.release();
    resolvePoll({ peers: [], messages: [] });
    await flushMicrotasks();

    // release cleared pendingKick; finally still schedules, but as steady (4000 ms idle).
    expect(scheduled.length).toBeGreaterThanOrEqual(2);
    expect(scheduled[scheduled.length - 1]?.delay).toBe(4000);
  });
});
