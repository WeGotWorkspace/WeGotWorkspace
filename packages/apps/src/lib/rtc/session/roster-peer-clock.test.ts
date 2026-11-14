import { describe, expect, it } from "vitest";
import { RosterPeerClock, UNLINKED_PEER_FAST_WINDOW_MS } from "./roster-peer-clock";

describe("RosterPeerClock", () => {
  it("gives a new unlinked peer the fast window, then lets it go", () => {
    let now = 1_000;
    const clock = new RosterPeerClock(() => now);
    clock.noteRoster(["ghost"]);
    expect(clock.isDialing("ghost", false)).toBe(true);
    now += UNLINKED_PEER_FAST_WINDOW_MS - 1;
    expect(clock.isDialing("ghost", false)).toBe(true);
    now += 1;
    expect(clock.isDialing("ghost", false)).toBe(false);
  });

  it("starts a fresh window when a link drops", () => {
    let now = 0;
    const clock = new RosterPeerClock(() => now);
    clock.noteRoster(["bea"]);
    now += 60_000;
    expect(clock.isDialing("bea", true)).toBe(false);
    now += 60_000;
    expect(clock.isDialing("bea", false)).toBe(true);
    now += UNLINKED_PEER_FAST_WINDOW_MS;
    expect(clock.isDialing("bea", false)).toBe(false);
  });

  it("forgets a peer that left the roster", () => {
    let now = 0;
    const clock = new RosterPeerClock(() => now);
    clock.noteRoster(["bea"]);
    now += UNLINKED_PEER_FAST_WINDOW_MS;
    expect(clock.isDialing("bea", false)).toBe(false);
    clock.noteRoster([]);
    clock.noteRoster(["bea"]);
    expect(clock.isDialing("bea", false)).toBe(true);
  });
});
