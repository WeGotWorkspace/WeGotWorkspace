import { describe, expect, it } from "vitest";
import {
  isLinkDownHint,
  LINK_CONNECT_GRACE_MS,
  LINK_DIAL_MIN_GAP_MS,
  reduceLink,
  type LinkContext,
  type LinkEffect,
  type LinkPeerState,
} from "@/lib/rtc/link/link-supervisor";

function nonLog(effects: LinkEffect[]): LinkEffect[] {
  return effects.filter((effect) => effect.type !== "log");
}

function logs(effects: LinkEffect[]): LinkEffect[] {
  return effects.filter((effect) => effect.type === "log");
}

function peer(partial: Partial<LinkPeerState> & Pick<LinkPeerState, "phase">): LinkPeerState {
  return {
    since: 0,
    downSince: null,
    attempt: 0,
    lastDialAt: null,
    ...partial,
  };
}

function ctx(now: number, initiatorIds: ReadonlySet<string> = new Set(["p"])): LinkContext {
  return { now, isInitiator: (id) => initiatorIds.has(id) };
}

describe("reduceLink T1–T16", () => {
  it("T1 adds a rostered peer as pending", () => {
    const { state, effects } = reduceLink(new Map(), { type: "roster", peerIds: ["p"] }, ctx(0));
    expect(state.get("p")).toEqual(peer({ phase: "pending", since: 0 }));
    expect(nonLog(effects)).toEqual([
      { type: "schedule", peerId: "p", delayMs: LINK_CONNECT_GRACE_MS },
    ]);
  });

  it("T2 removes a peer that left the roster", () => {
    const before = new Map([["p", peer({ phase: "pending" })]]);
    const { state, effects } = reduceLink(before, { type: "roster", peerIds: [] }, ctx(0));
    expect(state.has("p")).toBe(false);
    expect(nonLog(effects)).toEqual([{ type: "cancel", peerId: "p" }]);
  });

  it("T3 marks a pending peer up when its link opens", () => {
    const before = new Map([["p", peer({ phase: "pending", since: 0 })]]);
    const { state, effects } = reduceLink(
      before,
      { type: "observe", peerId: "p", obs: "open" },
      ctx(4000),
    );
    expect(state.get("p")).toEqual(peer({ phase: "up", since: 4000, attempt: 0, downSince: null }));
    expect(nonLog(effects)).toEqual([{ type: "cancel", peerId: "p" }]);
  });

  it("T4 initiator dials when grace expires", () => {
    const before = new Map([["p", peer({ phase: "pending", since: 0 })]]);
    const { state, effects } = reduceLink(before, { type: "timer", peerId: "p" }, ctx(10_000));
    expect(state.get("p")).toMatchObject({
      phase: "down",
      attempt: 1,
      lastDialAt: 10_000,
      downSince: 10_000,
    });
    expect(nonLog(effects)).toEqual([
      { type: "dial", peerId: "p" },
      { type: "schedule", peerId: "p", delayMs: 5_000 },
    ]);
  });

  it("T5 non-initiator hints when grace expires", () => {
    const before = new Map([["p", peer({ phase: "pending", since: 0 })]]);
    const { state, effects } = reduceLink(
      before,
      { type: "timer", peerId: "p" },
      ctx(10_000, new Set()),
    );
    expect(state.get("p")).toMatchObject({ phase: "down", attempt: 1 });
    expect(nonLog(effects)).toEqual([
      { type: "hint", peerId: "p", hint: { v: 1, since: 10_000 } },
      { type: "schedule", peerId: "p", delayMs: 5_000 },
    ]);
  });

  it("T6 backs off 5, 10, 20, 30, 60, 60 s", () => {
    let map = new Map([
      ["p", peer({ phase: "down", since: 0, downSince: 0, attempt: 1, lastDialAt: 0 })],
    ]);
    const schedules: number[] = [];
    let now = 5_000;
    for (let i = 0; i < 5; i += 1) {
      const reduced = reduceLink(map, { type: "timer", peerId: "p" }, ctx(now));
      map = reduced.state;
      const schedule = nonLog(reduced.effects).find((effect) => effect.type === "schedule");
      if (schedule?.type === "schedule") schedules.push(schedule.delayMs);
      now += 5_000;
    }
    expect(map.get("p")?.attempt).toBe(6);
    expect(schedules).toEqual([10_000, 20_000, 30_000, 60_000, 60_000]);
  });

  it("T7 initiator dials immediately when an up link fails", () => {
    const before = new Map([["p", peer({ phase: "up", since: 0 })]]);
    const { state, effects } = reduceLink(
      before,
      { type: "observe", peerId: "p", obs: "failed" },
      ctx(1_000),
    );
    expect(state.get("p")).toMatchObject({ phase: "down", attempt: 1, lastDialAt: 1_000 });
    expect(nonLog(effects)).toEqual([
      { type: "dial", peerId: "p" },
      { type: "schedule", peerId: "p", delayMs: 5_000 },
    ]);
  });

  it("T8 non-initiator hints when an up link is absent", () => {
    const before = new Map([["p", peer({ phase: "up", since: 0 })]]);
    const { state, effects } = reduceLink(
      before,
      { type: "observe", peerId: "p", obs: "absent" },
      ctx(1_000, new Set()),
    );
    expect(state.get("p")).toMatchObject({ phase: "down", attempt: 1 });
    expect(nonLog(effects)).toEqual([
      { type: "hint", peerId: "p", hint: { v: 1, since: 1_000 } },
      { type: "schedule", peerId: "p", delayMs: 5_000 },
    ]);
  });

  it("T9 an up link that reconnects gets a grace period", () => {
    const before = new Map([["p", peer({ phase: "up", since: 0 })]]);
    const { state, effects } = reduceLink(
      before,
      { type: "observe", peerId: "p", obs: "connecting" },
      ctx(2_000),
    );
    expect(state.get("p")).toMatchObject({ phase: "pending", since: 2_000 });
    expect(nonLog(effects)).toEqual([
      { type: "schedule", peerId: "p", delayMs: LINK_CONNECT_GRACE_MS },
    ]);
  });

  it("T10 a hint makes an up initiator redial", () => {
    const before = new Map([["p", peer({ phase: "up", since: 0 })]]);
    const { state, effects } = reduceLink(before, { type: "hint", peerId: "p" }, ctx(50_000));
    expect(state.get("p")).toMatchObject({ phase: "down", attempt: 1, lastDialAt: 50_000 });
    expect(nonLog(effects)).toEqual([
      { type: "dial", peerId: "p" },
      { type: "schedule", peerId: "p", delayMs: 5_000 },
    ]);
    expect(logs(effects)).toContainEqual({
      type: "log",
      event: "link-hint-received",
      details: { remoteId: "p" },
    });
  });

  it("T11 a hint within 3 s of the last dial does nothing", () => {
    const before = new Map([
      ["p", peer({ phase: "down", since: 0, downSince: 0, attempt: 1, lastDialAt: 1_000 })],
    ]);
    const { state, effects } = reduceLink(before, { type: "hint", peerId: "p" }, ctx(3_500));
    expect(state.get("p")).toEqual(before.get("p"));
    expect(nonLog(effects)).toEqual([]);
    expect(3_500 - 1_000).toBeLessThan(LINK_DIAL_MIN_GAP_MS);
  });

  it("T12 a hint after 3 s dials again without rescheduling", () => {
    const before = new Map([
      ["p", peer({ phase: "down", since: 0, downSince: 0, attempt: 1, lastDialAt: 1_000 })],
    ]);
    const { state, effects } = reduceLink(before, { type: "hint", peerId: "p" }, ctx(4_000));
    expect(state.get("p")?.lastDialAt).toBe(4_000);
    expect(nonLog(effects)).toEqual([{ type: "dial", peerId: "p" }]);
  });

  it("T13 a non-initiator ignores hints", () => {
    const before = new Map([["p", peer({ phase: "up", since: 0 })]]);
    const { state, effects } = reduceLink(
      before,
      { type: "hint", peerId: "p" },
      ctx(1_000, new Set()),
    );
    expect(state.get("p")).toEqual(before.get("p"));
    expect(nonLog(effects)).toEqual([]);
    expect(logs(effects)).toContainEqual({
      type: "log",
      event: "link-hint-ignored",
      details: { remoteId: "p" },
    });
  });

  it("T14 network change retries down peers from attempt 0", () => {
    const before = new Map([
      ["p", peer({ phase: "down", since: 0, downSince: 0, attempt: 4, lastDialAt: 9_000 })],
      ["q", peer({ phase: "up", since: 0 })],
    ]);
    const { state, effects } = reduceLink(
      before,
      { type: "network-change" },
      ctx(20_000, new Set(["p", "q"])),
    );
    expect(state.get("p")).toMatchObject({ attempt: 1, lastDialAt: 20_000 });
    expect(state.get("q")).toEqual(before.get("q"));
    expect(nonLog(effects)).toEqual([
      { type: "dial", peerId: "p" },
      { type: "schedule", peerId: "p", delayMs: 5_000 },
    ]);
  });

  it("T15 events for unknown peers are ignored", () => {
    const empty = new Map<string, LinkPeerState>();
    for (const event of [
      { type: "observe" as const, peerId: "x", obs: "open" as const },
      { type: "timer" as const, peerId: "x" },
      { type: "hint" as const, peerId: "x" },
    ]) {
      const { state, effects } = reduceLink(empty, event, ctx(0));
      expect(state.size).toBe(0);
      expect(nonLog(effects)).toEqual([]);
    }
  });

  it("T16 isLinkDownHint accepts and rejects payloads", () => {
    expect(isLinkDownHint({ v: 1, since: 5 })).toBe(true);
    expect(isLinkDownHint(null)).toBe(false);
    expect(isLinkDownHint({ v: 2, since: 5 })).toBe(false);
    expect(isLinkDownHint({ v: 1 })).toBe(false);
  });
});
