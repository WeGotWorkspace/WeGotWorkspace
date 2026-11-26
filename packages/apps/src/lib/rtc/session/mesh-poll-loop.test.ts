import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signalMeetLane } from "@/lib/traffic/meet-lane-client";
import { MeshPollLoop, type MeshPollLoopContext } from "@/lib/rtc/session/mesh-poll-loop";
import {
  DOORBELL_HEARTBEAT_POLL_INTERVAL_MS,
  type MeshPollCadenceSnapshot,
} from "@/lib/rtc/session/poll-cadence";
import {
  pushHeartbeatHeaderValue,
  resetPushHeartbeatPeersForTests,
} from "@/lib/rtc/session/push-heartbeat-peers";
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

const postMessage = vi.fn();

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
  beforeEach(() => {
    resetPushHeartbeatPeersForTests(() => null);
  });

  it("arms no steady poll while push carries the peer and polls at once on a ring (#2287)", async () => {
    const bell = fakeDoorbell(true);
    const { loop, scheduled, context } = createLoop({ doorbell: bell.doorbell });

    loop.schedule(true);
    expect(scheduled).toHaveLength(0);
    expect(pushHeartbeatHeaderValue()).toBe("meet:peer-1");

    bell.ring();
    expect(scheduled.at(-1)?.delay).toBe(MEET_RTC_POLL_INTERVALS.connectingMs);
    scheduled.at(-1)?.fn();
    await flushMicrotasks();
    expect(context.poll).toHaveBeenCalledTimes(1);
    // Nobody is connecting after that poll: no timer until the next ring.
    expect(scheduled).toHaveLength(1);
  });

  it("goes back to the room's own cadence as soon as push drops", () => {
    const bell = fakeDoorbell(true);
    const { loop, scheduled, context } = createLoop({ doorbell: bell.doorbell });
    loop.schedule(true);

    bell.setConnected(false);
    expect(scheduled.at(-1)?.delay).toBe(4000);

    // Back on push: the 4 s timer is cancelled and none replaces it.
    const armed = scheduled.length;
    bell.setConnected(true);
    expect(context.cancelTimeout).toHaveBeenCalled();
    expect(scheduled).toHaveLength(armed);
  });

  it("heartbeats every 30 s on a channel the push read does not keep alive", () => {
    const bell = fakeDoorbell(true);
    const { loop, scheduled } = createLoop({
      doorbell: bell.doorbell,
      cadence: () => ({ ...stableMeetCadence(), channel: "chat" }),
    });

    loop.schedule(true);
    expect(scheduled.at(-1)?.delay).toBe(DOORBELL_HEARTBEAT_POLL_INTERVAL_MS);
    expect(pushHeartbeatHeaderValue()).toBeNull();
  });

  it("keeps the 30 s heartbeat when the capped push header leaves its peer out", () => {
    const data = new Map<string, string>([
      [
        "wgw.rtc.pushPeers.other",
        JSON.stringify({
          at: Date.now(),
          peers: Array.from(
            { length: 32 },
            (_, index) => `collab:${index.toString(16).padStart(16, "0")}`,
          ),
        }),
      ],
    ]);
    resetPushHeartbeatPeersForTests(() => ({
      get length() {
        return data.size;
      },
      key: (index) => [...data.keys()][index] ?? null,
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => void data.set(key, value),
      removeItem: (key) => void data.delete(key),
    }));
    const bell = fakeDoorbell(true);
    const { loop, scheduled } = createLoop({ doorbell: bell.doorbell });

    loop.schedule(true);
    expect(pushHeartbeatHeaderValue()).not.toContain("meet:peer-1");
    expect(scheduled.at(-1)?.delay).toBe(DOORBELL_HEARTBEAT_POLL_INTERVAL_MS);
  });

  it("names its current peer on push reads and drops it when it stops", () => {
    let myId = "peer-1";
    const bell = fakeDoorbell(true);
    const { loop } = createLoop({ doorbell: bell.doorbell, myId: () => myId });

    loop.schedule(true);
    expect(pushHeartbeatHeaderValue()).toBe("meet:peer-1");

    myId = "peer-9";
    loop.schedule(true);
    expect(pushHeartbeatHeaderValue()).toBe("meet:peer-9");

    loop.stop();
    expect(pushHeartbeatHeaderValue()).toBeNull();
  });

  it("keeps a kicked poll when push connects right after the ring", async () => {
    const bell = fakeDoorbell(false);
    const { loop, scheduled, context } = createLoop({ doorbell: bell.doorbell });
    loop.schedule(true);

    bell.ring();
    bell.setConnected(true);
    expect(scheduled.at(-1)?.delay).toBe(MEET_RTC_POLL_INTERVALS.connectingMs);
    scheduled.at(-1)?.fn();
    await flushMicrotasks();
    expect(context.poll).toHaveBeenCalledTimes(1);
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

describe("MeshPollLoop Meet call lane signals (#2419)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { serviceWorker: { controller: { postMessage } } });
    postMessage.mockClear();
    signalMeetLane("left", 0);
    postMessage.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const signals = () => postMessage.mock.calls.map(([message]) => message.signal as string);

  it("tells the worker a Meet room is in a call and re-sends it while quiet", () => {
    const { loop } = createLoop();
    loop.schedule(true);
    expect(signals()).toEqual(["call"]);
    vi.setSystemTime(Date.now() + 20_000);
    vi.advanceTimersByTime(15_000);
    expect(signals().filter((signal) => signal === "call").length).toBeGreaterThan(1);
    loop.stop();
    expect(signals().at(-1)).toBe("left");
  });

  it("opens the negotiation window only while a peer is being dialled", () => {
    const connected = createLoop();
    connected.loop.schedule(false);
    expect(signals()).not.toContain("negotiating");
    connected.loop.stop();
    postMessage.mockClear();
    const dialling = createLoop({
      cadence: () => ({ ...stableMeetCadence(), linkStateOf: () => null }),
    });
    dialling.loop.schedule(false);
    expect(signals()).toContain("negotiating");
    dialling.loop.stop();
  });

  it("stays silent for other channels", () => {
    const { loop } = createLoop({ cadence: () => ({ ...stableMeetCadence(), channel: "collab" }) });
    loop.schedule(false);
    loop.stop();
    expect(postMessage).not.toHaveBeenCalled();
  });
});
