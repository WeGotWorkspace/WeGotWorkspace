import { describe, expect, it } from "vitest";
import { enqueueMeshJoin, meshJoinTails } from "@/lib/rtc/session/mesh-join-queue";

async function flushMicrotasks(): Promise<void> {
  for (let step = 0; step < 8; step += 1) {
    await Promise.resolve();
  }
}

describe("enqueueMeshJoin", () => {
  it("removes the queue entry after every join has settled", async () => {
    const key = "mesh-join-queue-settled";
    await enqueueMeshJoin(key, async () => "first");
    await enqueueMeshJoin(key, async () => "second");

    let releaseFirst: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const overlap = "mesh-join-queue-overlap";
    const first = enqueueMeshJoin(overlap, async () => {
      await gate;
      return "held";
    });
    const second = enqueueMeshJoin(overlap, async () => "queued");
    expect(meshJoinTails.has(overlap)).toBe(true);
    releaseFirst();
    await first;
    await second;
    await flushMicrotasks();

    expect(meshJoinTails.size).toBe(0);
  });
});
