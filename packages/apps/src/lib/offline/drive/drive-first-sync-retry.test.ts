import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  online: true,
  firstSyncDone: false,
  lastPass: null as "tree" | "crawl" | null,
}));

vi.mock("@/lib/offline/core/browser-online", () => ({
  getConnectivitySnapshot: () => state.online,
}));
vi.mock("@/lib/offline/drive/drive-tree-sync", () => ({
  readDriveTreeFirstSyncDone: async () => state.firstSyncDone,
  readDriveTreeLastPass: async () => state.lastPass,
}));

import {
  FIRST_SYNC_RETRY_BASE_MS,
  syncUntilFirstSyncDone,
} from "@/lib/offline/drive/drive-first-sync-retry";

describe("syncUntilFirstSyncDone (#2063 C3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    state.online = true;
    state.firstSyncDone = false;
    state.lastPass = null;
  });
  afterEach(() => vi.useRealTimers());

  it("runs a failed first sync again with a backoff until it finishes", async () => {
    const sync = vi.fn().mockRejectedValueOnce(new Error("429")).mockResolvedValue(undefined);
    syncUntilFirstSyncDone("ada", sync, {
      signal: new AbortController().signal,
      isCurrent: () => true,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(sync).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FIRST_SYNC_RETRY_BASE_MS);
    expect(sync).toHaveBeenCalledTimes(2);

    state.firstSyncDone = true;
    await vi.advanceTimersByTimeAsync(10 * FIRST_SYNC_RETRY_BASE_MS);
    expect(sync).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("never runs again once the first sync is done", async () => {
    state.firstSyncDone = true;
    const sync = vi.fn().mockRejectedValue(new Error("content sync failed"));
    syncUntilFirstSyncDone("ada", sync, {
      signal: new AbortController().signal,
      isCurrent: () => true,
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("stops after a finished crawl on a server without the keyset", async () => {
    const sync = vi.fn().mockImplementation(async () => {
      // The crawl finished: last pass "crawl", `firstSyncDone` stays unset.
      state.lastPass = "crawl";
    });
    syncUntilFirstSyncDone("ada", sync, {
      signal: new AbortController().signal,
      isCurrent: () => true,
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("keeps running after a walk cut off between its last pass and firstSyncDone", async () => {
    state.lastPass = "tree";
    const sync = vi.fn().mockResolvedValue(undefined);
    syncUntilFirstSyncDone("ada", sync, {
      signal: new AbortController().signal,
      isCurrent: () => true,
    });
    await vi.advanceTimersByTimeAsync(FIRST_SYNC_RETRY_BASE_MS);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("stops offline, on abort, and when a newer trigger owns the retries", async () => {
    const sync = vi.fn().mockResolvedValue(undefined);

    state.online = false;
    syncUntilFirstSyncDone("ada", sync, {
      signal: new AbortController().signal,
      isCurrent: () => true,
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sync).toHaveBeenCalledTimes(1);

    state.online = true;
    const controller = new AbortController();
    syncUntilFirstSyncDone("ada", sync, { signal: controller.signal, isCurrent: () => true });
    controller.abort();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sync).toHaveBeenCalledTimes(2);

    syncUntilFirstSyncDone("ada", sync, {
      signal: new AbortController().signal,
      isCurrent: () => false,
    });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(sync).toHaveBeenCalledTimes(3);
  });
});
