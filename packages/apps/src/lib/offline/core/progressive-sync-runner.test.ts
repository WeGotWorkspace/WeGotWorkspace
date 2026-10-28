import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BackgroundSyncRateLimitedError } from "@/lib/offline/core/background-sync-pacer";
import {
  MAX_RATE_LIMITED_ATTEMPTS,
  runProgressiveSync,
} from "@/lib/offline/core/progressive-sync-runner";
import { readMeta } from "@/lib/offline/core/meta-store";

describe("runProgressiveSync", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("runs items with bounded concurrency and writes progress", async () => {
    const syncOne = vi.fn(async () => undefined);
    const result = await runProgressiveSync({
      username: "alice",
      metaKey: "test:progress",
      items: ["a", "b", "c"],
      concurrency: 2,
      syncOne,
    });

    expect(syncOne).toHaveBeenCalledTimes(3);
    expect(result.total).toBe(3);
    expect(result.synced).toBe(3);
    expect(result.failed).toBe(0);
    expect(result.running).toBe(false);

    const raw = await readMeta("alice", "test:progress");
    expect(raw).toBeTruthy();
  });

  it("counts failures without stopping the queue", async () => {
    const syncOne = vi.fn(async (item: string) => {
      if (item === "bad") throw new Error("fail");
    });
    const result = await runProgressiveSync({
      username: "bob",
      metaKey: "test:progress-fail",
      items: ["ok", "bad"],
      syncOne,
    });
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(1);
  });

  it("retries a rate-limited item and tells the pacer the Retry-After", async () => {
    const pacer = { reportRateLimited: vi.fn(), reportSuccess: vi.fn() };
    let calls = 0;
    const syncOne = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new BackgroundSyncRateLimitedError("429", 12_000);
    });
    const result = await runProgressiveSync({
      username: "carol",
      metaKey: "test:progress-429",
      items: ["only"],
      syncOne,
      pacer,
    });
    expect(syncOne).toHaveBeenCalledTimes(2);
    expect(pacer.reportRateLimited).toHaveBeenCalledWith(12_000);
    expect(pacer.reportSuccess).toHaveBeenCalledTimes(1);
    expect(result.synced).toBe(1);
    expect(result.failed).toBe(0);
  });

  it("gives up on an item after the last rate-limited attempt", async () => {
    const pacer = { reportRateLimited: vi.fn(), reportSuccess: vi.fn() };
    const syncOne = vi.fn(async () => {
      throw { status: 429 };
    });
    const result = await runProgressiveSync({
      username: "dave",
      metaKey: "test:progress-429-cap",
      items: ["stuck"],
      syncOne,
      pacer,
    });
    expect(syncOne).toHaveBeenCalledTimes(MAX_RATE_LIMITED_ATTEMPTS);
    expect(pacer.reportRateLimited).toHaveBeenCalledWith(null);
    expect(result.failed).toBe(1);
  });

  it("does not retry other failures", async () => {
    const pacer = { reportRateLimited: vi.fn(), reportSuccess: vi.fn() };
    const syncOne = vi.fn(async () => {
      throw Object.assign(new Error("server error"), { status: 500 });
    });
    const result = await runProgressiveSync({
      username: "erin",
      metaKey: "test:progress-500",
      items: ["broken"],
      syncOne,
      pacer,
    });
    expect(syncOne).toHaveBeenCalledTimes(1);
    expect(pacer.reportRateLimited).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
  });

  it("stops without counting failures once aborted", async () => {
    const controller = new AbortController();
    const syncOne = vi.fn(async () => {
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });
    const result = await runProgressiveSync({
      username: "frank",
      metaKey: "test:progress-abort",
      items: ["a", "b", "c"],
      concurrency: 1,
      syncOne,
      signal: controller.signal,
    });
    expect(syncOne).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(0);
    expect(result.running).toBe(false);
  });
});
