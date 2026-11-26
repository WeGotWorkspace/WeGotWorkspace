import { describe, expect, it } from "vitest";
import { MEET_LANE, RequestGovernor } from "./request-governor";

function harness(options: { status?: number; burst?: number } = {}) {
  const burst = options.burst ?? 3;
  let clock = 1_000_000;
  const sent: string[] = [];
  const governor = new RequestGovernor({
    backgroundPerMinute: 30,
    burst,
    bulkPerMinute: 20,
    coalesceTtlMs: 15_000,
    maxWaitMs: 30_000,
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    fetch: async (request) => {
      sent.push(new URL(request.url).pathname);
      return new Response("{}", { status: options.status ?? 200 });
    },
  });
  return { governor, sent, burst, advance: (ms: number) => (clock += ms), now: () => clock };
}

const get = (path: string, headers: Record<string, string> = {}) =>
  new Request(`https://suite.test/api/v1${path}`, { headers });
const member = (path: string) => get(path, { Authorization: "Bearer a" });

/** Drains the burst so the next governed request has to wait for a token. */
async function emptyBucket(h: ReturnType<typeof harness>) {
  for (let i = 0; i < h.burst; i += 1)
    await h.governor.handle(get("/files/x/changes"), "background");
}

/** How long (fake clock) a governed request waited before it was sent. */
async function waited(h: ReturnType<typeof harness>, request: Request) {
  const before = h.now();
  await h.governor.handle(request, "background");
  return h.now() - before;
}

const MEET_POLL = "/rooms/call-1/events?peerId=a";

describe("Meet signaling lane (#2419)", () => {
  it("queues a Meet room poll behind the background budget while the lane is closed", async () => {
    const h = harness();
    await emptyBucket(h);
    expect(await waited(h, member(MEET_POLL))).toBeGreaterThan(1_000);
  });

  it("lets Meet room polls and the doorbell read skip the queue after a join", async () => {
    const h = harness();
    await emptyBucket(h);
    h.governor.signalMeetLane("join");
    expect(await waited(h, member(MEET_POLL))).toBe(0);
    expect(await waited(h, member("/jmap/events/*/state/0"))).toBe(0);
    expect(h.governor.meetLaneOpen()).toBe(true);
  });

  it("closes the window after MEET_LANE.windowMs without a signal", async () => {
    const h = harness();
    h.governor.signalMeetLane("join");
    h.advance(MEET_LANE.windowMs - 1);
    expect(h.governor.meetLaneOpen()).toBe(true);
    h.advance(2);
    expect(h.governor.meetLaneOpen()).toBe(false);
    await emptyBucket(h);
    expect(await waited(h, member(MEET_POLL))).toBeGreaterThan(1_000);
  });

  it("extends on negotiating signals but never beyond maxOpenMs", () => {
    const h2 = harness();
    h2.governor.signalMeetLane("join");
    h2.advance(20_000);
    h2.governor.signalMeetLane("negotiating");
    h2.advance(MEET_LANE.maxOpenMs - 20_000 + 1);
    expect(h2.governor.meetLaneOpen()).toBe(false);
  });

  it("closes at once on left", async () => {
    const h = harness();
    h.governor.signalMeetLane("join");
    h.governor.signalMeetLane("left");
    expect(h.governor.meetLaneOpen()).toBe(false);
    await emptyBucket(h);
    expect(await waited(h, member("/jmap/events/*/state/0"))).toBeGreaterThan(0);
  });

  it("never applies to non-Meet traffic, however open the lane is", async () => {
    const h = harness();
    await emptyBucket(h);
    h.governor.signalMeetLane("join");
    const others = [
      "/rooms/p_workspace/events?peerId=a", // presence room
      "/rooms/f_abc/events?peerId=a", // collab file room
      "/files/threads/changes",
      "/notifications",
    ];
    for (const path of others) {
      expect(await waited(h, member(path))).toBeGreaterThan(0);
      await emptyBucket(h);
    }
  });

  it("keeps the doorbell on the queue unless a call or negotiation is on", async () => {
    const h = harness();
    await emptyBucket(h);
    expect(await waited(h, member("/jmap/events/*/state/0"))).toBeGreaterThan(0);
    await emptyBucket(h);
    h.governor.signalMeetLane("call");
    expect(await waited(h, member("/jmap/events/*/state/0"))).toBe(0);
    // A call alone does not open the room-poll lane.
    await emptyBucket(h);
    expect(await waited(h, member(MEET_POLL))).toBeGreaterThan(0);
  });

  it("bounds the lane: past its bucket a poll waits in the queue again", async () => {
    const h = harness({ burst: 40 });
    await emptyBucket(h);
    h.governor.signalMeetLane("join");
    let free = 0;
    for (let i = 0; i < 40; i += 1) {
      if ((await waited(h, member(MEET_POLL))) === 0) free += 1;
      else break;
    }
    expect(free).toBe(MEET_LANE.burst);
  });

  it("charges the lane to the background bucket so the average stays at the budget", async () => {
    const h = harness({ burst: 10 });
    await emptyBucket(h);
    h.governor.signalMeetLane("join");
    for (let i = 0; i < 5; i += 1) await h.governor.handle(member(MEET_POLL), "background");
    h.governor.signalMeetLane("left");
    // The bucket is in debt: the next background poll waits for it to recover.
    expect(await waited(h, member("/files/x/changes"))).toBeGreaterThan(5_000);
  });

  it("stops a member's lane at half a burst of debt", async () => {
    const h = harness({ burst: 10 });
    h.governor.signalMeetLane("join");
    let free = 0;
    for (let i = 0; i < 12; i += 1) {
      if ((await waited(h, member(MEET_POLL))) !== 0) break;
      free += 1;
    }
    // 10 tokens, floor -5: 15 charged polls at most, the lane bucket (10) ends it first.
    expect(free).toBe(MEET_LANE.burst);
    const tight = harness({ burst: 4 });
    tight.governor.signalMeetLane("join");
    let tightFree = 0;
    for (let i = 0; i < 12; i += 1) {
      if ((await waited(tight, member(MEET_POLL))) !== 0) break;
      tightFree += 1;
    }
    // 4 tokens, floor -2: six charged polls, then the queue.
    expect(tightFree).toBe(6);
  });

  it("gives an unauthenticated guest one extra burst per join, exempt from the bucket", async () => {
    const h = harness();
    await emptyBucket(h);
    h.governor.signalMeetLane("join");
    let free = 0;
    for (let i = 0; i < 60; i += 1) {
      if ((await waited(h, get(MEET_POLL))) === 0) free += 1;
      else break;
    }
    expect(free).toBe(MEET_LANE.burst + MEET_LANE.guestBonus);
    // Guest polls took nothing from the background bucket.
    h.governor.signalMeetLane("left");
    h.advance(120_000);
    expect(await waited(h, member("/files/x/changes"))).toBe(0);
  });

  it("respects the shared brake: a 503 sends lane polls back to the queue", async () => {
    const h = harness({ status: 503 });
    h.governor.signalMeetLane("join");
    await h.governor.handle(member(MEET_POLL), "background");
    expect(await waited(h, member(MEET_POLL))).toBeGreaterThan(0);
  });

  it("does not touch writes: signaling posts always go straight through", async () => {
    const h = harness();
    await emptyBucket(h);
    const before = h.now();
    await h.governor.handle(
      new Request("https://suite.test/api/v1/rooms/call-1/events", { method: "POST", body: "{}" }),
      "write",
    );
    expect(h.now() - before).toBe(0);
  });
});
