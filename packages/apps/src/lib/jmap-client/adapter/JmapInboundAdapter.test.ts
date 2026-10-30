import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JmapMethodError } from "../core/errors.js";
import type { JmapClient } from "../core/JmapClient.js";
import { JmapInboundAdapter } from "./JmapInboundAdapter";

class TestAdapter extends JmapInboundAdapter {
  pull = vi.fn<() => Promise<void>>(async () => undefined);
  refetch = vi.fn<() => Promise<void>>(async () => undefined);
  errors: unknown[] = [];
  protected readonly pushTypes = ["Note"];
  protected get jmapClient(): JmapClient {
    return { getState: () => "n1" } as unknown as JmapClient;
  }
  get accountId(): string {
    return "alice";
  }
  protected pullChanges(): Promise<void> {
    return this.pull();
  }
  protected refetchAll(): Promise<void> {
    return this.refetch();
  }
  protected reportSyncError(error: unknown): void {
    this.errors.push(error);
  }
}

describe("JmapInboundAdapter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("polls on the interval, one sync at a time, until stopped", async () => {
    const adapter = new TestAdapter();
    let finish!: () => void;
    adapter.pull.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    adapter.startPolling(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.pull).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.pull).toHaveBeenCalledTimes(2);
    adapter.stopPolling();
    await vi.advanceTimersByTimeAsync(5000);
    expect(adapter.pull).toHaveBeenCalledTimes(2);
  });

  it("refetches everything after cannotCalculateChanges and reports other errors", async () => {
    const adapter = new TestAdapter();
    adapter.pull.mockRejectedValueOnce(
      new JmapMethodError("Note/changes", "c0", { type: "cannotCalculateChanges" }),
    );
    await adapter.sync();
    expect(adapter.refetch).toHaveBeenCalledTimes(1);
    expect(adapter.errors).toEqual([]);

    const failure = new TypeError("Failed to fetch");
    adapter.pull.mockRejectedValueOnce(failure);
    await expect(adapter.syncIfStale({ Note: "n2" })).resolves.toBe(false);
    expect(adapter.errors).toEqual([failure]);
  });

  // Both rounds store their cursor: one that started first and ends last would rewind it.
  it("runs a push sync after the poll round in flight, never beside it", async () => {
    const adapter = new TestAdapter();
    let finish!: () => void;
    adapter.pull.mockImplementationOnce(() => new Promise<void>((resolve) => (finish = resolve)));
    const poll = adapter.sync();
    const push = adapter.syncIfStale({ Note: "n2" });
    await vi.advanceTimersByTimeAsync(0);
    expect(adapter.pull).toHaveBeenCalledTimes(1);
    finish();
    await poll;
    await expect(push).resolves.toBe(true);
    expect(adapter.pull).toHaveBeenCalledTimes(2);
  });

  it("a failed round does not stop the next one", async () => {
    const adapter = new TestAdapter();
    adapter.pull.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const first = adapter.syncIfStale({ Note: "n2" });
    const second = adapter.syncIfStale({ Note: "n2" });
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
  });

  // #1792: a full re-list the server refuses (requestTooLarge) must not escape sync().
  it("reports a failed refetch instead of throwing, and does not confirm the push", async () => {
    const adapter = new TestAdapter();
    const stale = () =>
      adapter.pull.mockRejectedValueOnce(
        new JmapMethodError("Note/changes", "c0", { type: "cannotCalculateChanges" }),
      );
    const tooLarge = new JmapMethodError("Note/get", "c1", { type: "requestTooLarge" });
    adapter.refetch.mockRejectedValue(tooLarge);

    stale();
    await expect(adapter.sync()).resolves.toBeUndefined();
    stale();
    await expect(adapter.syncIfStale({ Note: "n2" })).resolves.toBe(false);
    expect(adapter.errors).toEqual([tooLarge, tooLarge]);
  });
});
