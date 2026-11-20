import { describe, expect, it, vi } from "vitest";
import { MeshPollLoop, type MeshPollLoopContext } from "@/lib/rtc/session/mesh-poll-loop";
import {
  DOORBELL_HEARTBEAT_POLL_INTERVAL_MS,
  type MeshPollCadenceSnapshot,
} from "@/lib/rtc/session/poll-cadence";
import type { RoomDoorbell } from "@/lib/rtc/session/room-doorbell";
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
    doorbell: null,
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

function fakeDoorbell(connected: boolean) {
  const rings = new Set<() => void>();
  const statuses = new Set<(connected: boolean) => void>();
  let now = connected;
  const doorbell: RoomDoorbell = {
    get connected() {
      return now;
    },
    subscribe: (onRing) => {
      rings.add(onRing);
      return () => rings.delete(onRing);
    },
    subscribeStatus: (listener) => {
      statuses.add(listener);
      return () => statuses.delete(listener);
    },
  };
  return {
    doorbell,
    rings,
    ring: () => rings.forEach((onRing) => onRing()),
    setConnected(next: boolean) {
      now = next;
      statuses.forEach((listener) => listener(next));
    },
  };
}

describe("MeshPollLoop behind the push doorbell (#2294)", () => {
  it("heartbeats while push is connected and polls at once when the doorbell rings", async () => {
    const bell = fakeDoorbell(true);
    const { loop, scheduled, context } = createLoop({ doorbell: bell.doorbell });

    loop.schedule(true);
    expect(scheduled.at(-1)?.delay).toBe(DOORBELL_HEARTBEAT_POLL_INTERVAL_MS);

    bell.ring();
    expect(scheduled.at(-1)?.delay).toBe(MEET_RTC_POLL_INTERVALS.connectingMs);
    scheduled.at(-1)?.fn();
    await flushMicrotasks();
    expect(context.poll).toHaveBeenCalledTimes(1);
    // Nobody is connecting after that poll: back to the heartbeat.
    expect(scheduled.at(-1)?.delay).toBe(DOORBELL_HEARTBEAT_POLL_INTERVAL_MS);
  });

  it("goes back to the room's own cadence as soon as push drops", () => {
    const bell = fakeDoorbell(true);
    const { loop, scheduled } = createLoop({ doorbell: bell.doorbell });
    loop.schedule(true);

    bell.setConnected(false);
    expect(scheduled.at(-1)?.delay).toBe(4000);

    bell.setConnected(true);
    expect(scheduled.at(-1)?.delay).toBe(DOORBELL_HEARTBEAT_POLL_INTERVAL_MS);
  });

  it("ignores rings after stop and unsubscribes on release", () => {
    const bell = fakeDoorbell(true);
    const { loop, scheduled } = createLoop({ doorbell: bell.doorbell });
    loop.schedule(true);
    const before = scheduled.length;

    loop.stop();
    bell.ring();
    expect(scheduled).toHaveLength(before);

    loop.release();
    expect(bell.rings.size).toBe(0);
  });
});
