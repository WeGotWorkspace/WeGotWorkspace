import { describe, expect, it } from "vitest";
import {
  BackgroundSyncRateLimitedError,
  createBackgroundSyncPacer,
  isRateLimitedError,
  parseRetryAfterMs,
  retryAfterMsFromError,
} from "@/lib/offline/core/background-sync-pacer";

/** A pacer on a fake clock: `sleep` advances time instead of waiting. */
function fakeClockPacer(options: { requestsPerMinute?: number; userIdleMs?: number } = {}) {
  let clock = 1_000_000;
  const sleeps: number[] = [];
  const pacer = createBackgroundSyncPacer({
    ...options,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  return {
    pacer,
    sleeps,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

async function acquireTimes(
  pacer: ReturnType<typeof createBackgroundSyncPacer>,
  now: () => number,
  count: number,
): Promise<number[]> {
  const starts: number[] = [];
  for (let i = 0; i < count; i += 1) {
    await pacer.acquire();
    starts.push(now());
  }
  return starts;
}

describe("parseRetryAfterMs", () => {
  it("reads delay-seconds", () => {
    expect(parseRetryAfterMs("12")).toBe(12_000);
    expect(parseRetryAfterMs(" 0 ")).toBe(0);
  });

  it("reads an HTTP date relative to now", () => {
    const now = Date.parse("Wed, 28 Oct 2026 10:00:00 GMT");
    expect(parseRetryAfterMs("Wed, 28 Oct 2026 10:00:30 GMT", now)).toBe(30_000);
    expect(parseRetryAfterMs("Wed, 28 Oct 2026 09:59:00 GMT", now)).toBe(0);
  });

  it("returns null when the header is absent or invalid", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("")).toBeNull();
    expect(parseRetryAfterMs("soon")).toBeNull();
  });
});

describe("rate-limited errors", () => {
  it("recognises any error with status 429 and reads its Retry-After", () => {
    const error = new BackgroundSyncRateLimitedError("429", 7_000);
    expect(isRateLimitedError(error)).toBe(true);
    expect(retryAfterMsFromError(error)).toBe(7_000);
    expect(isRateLimitedError({ status: 429 })).toBe(true);
    expect(isRateLimitedError({ status: 500 })).toBe(false);
    expect(isRateLimitedError(new Error("GET failed (429)"))).toBe(false);
    expect(retryAfterMsFromError({ status: 429 })).toBeNull();
  });
});

describe("createBackgroundSyncPacer", () => {
  it("spaces requests to the configured rate", async () => {
    const { pacer, now } = fakeClockPacer({ requestsPerMinute: 120 });
    const starts = await acquireTimes(pacer, now, 5);
    const gaps = starts.slice(1).map((start, i) => start - starts[i]!);
    expect(gaps).toEqual([500, 500, 500, 500]);
  });

  it("never lets more than the configured number through in a minute", async () => {
    const { pacer, now } = fakeClockPacer({ requestsPerMinute: 120 });
    const starts = await acquireTimes(pacer, now, 300);
    const first = starts[0]!;
    expect(starts.filter((start) => start - first < 60_000)).toHaveLength(120);
  });

  it("waits for Retry-After after a 429", async () => {
    const { pacer, now } = fakeClockPacer({ requestsPerMinute: 120 });
    await pacer.acquire();
    const limitedAt = now();
    pacer.reportRateLimited(30_000);
    await pacer.acquire();
    expect(now() - limitedAt).toBe(30_000);
  });

  it("backs off exponentially without Retry-After and resets after a success", async () => {
    const { pacer, now } = fakeClockPacer({ requestsPerMinute: 120 });
    const waits: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const at = now();
      pacer.reportRateLimited(null);
      await pacer.acquire();
      waits.push(now() - at);
    }
    expect(waits).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000]);

    pacer.reportSuccess();
    const at = now();
    pacer.reportRateLimited(null);
    await pacer.acquire();
    expect(now() - at).toBe(5_000);
  });

  it("pauses background requests after a click or key press", async () => {
    const { pacer, now, advance } = fakeClockPacer({ requestsPerMinute: 120, userIdleMs: 1_500 });
    await pacer.acquire();
    advance(10_000);
    pacer.noteUserActivity();
    const at = now();
    await pacer.acquire();
    expect(now() - at).toBe(1_500);
  });

  it("rejects with AbortError once the sync is aborted", async () => {
    const pacer = createBackgroundSyncPacer();
    const controller = new AbortController();
    controller.abort();
    await expect(pacer.acquire(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });

  it("stops waiting when aborted during a backoff", async () => {
    const pacer = createBackgroundSyncPacer();
    pacer.reportRateLimited(60_000);
    const controller = new AbortController();
    const pending = pacer.acquire(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
