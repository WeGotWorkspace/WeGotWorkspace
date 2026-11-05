import { describe, expect, it } from "vitest";
import { MeshRetryInterval } from "./mesh-retry-interval";

function clock() {
  let now = 1_000_000;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("MeshRetryInterval", () => {
  it("mesh down: waits exactly the server's retry", () => {
    const time = clock();
    const interval = new MeshRetryInterval({ now: time.now });
    expect(interval.delayFor(3_000)).toBe(3_000);
    interval.setLinked(false);
    time.advance(120_000);
    expect(interval.delayFor(3_000)).toBe(3_000);
  });

  it("mesh up: 5 s instead of 3 s once the link has held for 30 s", () => {
    const time = clock();
    const interval = new MeshRetryInterval({ now: time.now });
    interval.setLinked(true);
    expect(interval.delayFor(3_000)).toBe(3_000);
    time.advance(29_999);
    expect(interval.delayFor(3_000)).toBe(3_000);
    time.advance(1);
    expect(interval.linkHeld).toBe(true);
    expect(interval.delayFor(3_000)).toBe(5_000);
  });

  it("scales the server's retry, so a slower host stays the base", () => {
    const time = clock();
    const interval = new MeshRetryInterval({ now: time.now });
    interval.setLinked(true);
    time.advance(30_000);
    expect(interval.delayFor(6_000)).toBe(10_000);
  });

  it("a repeated up report does not restart the hold", () => {
    const time = clock();
    const interval = new MeshRetryInterval({ now: time.now });
    interval.setLinked(true);
    time.advance(20_000);
    interval.setLinked(true);
    time.advance(10_000);
    expect(interval.delayFor(3_000)).toBe(5_000);
  });

  it("mesh lost: back to the base at once", () => {
    const time = clock();
    const interval = new MeshRetryInterval({ now: time.now });
    interval.setLinked(true);
    time.advance(60_000);
    expect(interval.delayFor(3_000)).toBe(5_000);
    interval.setLinked(false);
    expect(interval.delayFor(3_000)).toBe(3_000);
  });

  it("mesh flapping: stays on the base instead of switching back and forth", () => {
    const time = clock();
    const interval = new MeshRetryInterval({ now: time.now });
    const delays = new Set<number>();
    // Up for 20 s, down for 5 s, for ten minutes.
    for (let cycle = 0; cycle < 24; cycle += 1) {
      interval.setLinked(true);
      for (let t = 0; t < 20_000; t += 1_000) {
        delays.add(interval.delayFor(3_000));
        time.advance(1_000);
      }
      interval.setLinked(false);
      delays.add(interval.delayFor(3_000));
      time.advance(5_000);
    }
    expect([...delays]).toEqual([3_000]);
  });

  it("a link that settles after flapping earns the longer interval once it holds", () => {
    const time = clock();
    const interval = new MeshRetryInterval({ now: time.now });
    for (let cycle = 0; cycle < 5; cycle += 1) {
      interval.setLinked(true);
      time.advance(10_000);
      interval.setLinked(false);
      time.advance(1_000);
    }
    interval.setLinked(true);
    time.advance(29_000);
    expect(interval.delayFor(3_000)).toBe(3_000);
    time.advance(1_000);
    expect(interval.delayFor(3_000)).toBe(5_000);
  });
});
