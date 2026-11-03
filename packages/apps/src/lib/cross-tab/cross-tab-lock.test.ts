import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createCrossTabLock,
  CROSS_TAB_LOCK_STALE_MS,
  crossTabLockStorageKey,
} from "@/lib/cross-tab/cross-tab-lock";
import { simulateOrigin } from "@/lib/cross-tab/test-utils/simulated-origin";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("withCrossTabLock with Web Locks", () => {
  it("requests the caller's name and returns the task's own result type", async () => {
    const request = vi.fn(
      async (_name: string, _options: LockOptions, callback: () => Promise<unknown>) => callback(),
    );
    const origin = simulateOrigin();
    const lock = createCrossTabLock(
      origin.tab("a", { locks: { request } as unknown as LockManager }),
    );

    const result = await lock("wgw-drive-uploader:alice", async () => ({ uploaded: 2 }));

    expect(result).toEqual({ uploaded: 2 });
    expect(request).toHaveBeenCalledWith(
      "wgw-drive-uploader:alice",
      { mode: "exclusive" },
      expect.any(Function),
    );
    expect(origin.storage.size).toBe(0);
  });

  it("makes a second tab wait and then run once the holder is done", async () => {
    const origin = simulateOrigin();
    const tabA = createCrossTabLock(origin.tab("a", { locks: navigator.locks }));
    const tabB = createCrossTabLock(origin.tab("b", { locks: navigator.locks }));
    const releaseA = deferred();
    const order: string[] = [];

    const a = tabA("web-lock-wait", async () => {
      order.push("a:start");
      await releaseA.promise;
      order.push("a:end");
    });
    await Promise.resolve();
    const b = tabB("web-lock-wait", async () => {
      order.push("b:start");
      return "b";
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(order).toEqual(["a:start"]);

    releaseA.resolve();
    await expect(b).resolves.toBe("b");
    await a;
    expect(order).toEqual(["a:start", "a:end", "b:start"]);
  });

  it("does not let two names block each other", async () => {
    const origin = simulateOrigin();
    const lock = createCrossTabLock(origin.tab("a", { locks: navigator.locks }));
    const result = await lock("outer-web", () => lock("inner-web", async () => "nested"));
    expect(result).toBe("nested");
  });

  it("would deadlock if one name were nested inside itself", async () => {
    const origin = simulateOrigin();
    const lock = createCrossTabLock(origin.tab("a", { locks: navigator.locks }));
    const outcome = await Promise.race([
      lock("shared-name", () => lock("shared-name", async () => "inner")),
      new Promise((resolve) => setTimeout(() => resolve("stuck"), 50)),
    ]);
    expect(outcome).toBe("stuck");
  });
});

describe("withCrossTabLock fallback (no Web Locks)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds a heartbeat record while the task runs and removes it after", async () => {
    const origin = simulateOrigin();
    const lock = createCrossTabLock(origin.tab("a"));
    const key = crossTabLockStorageKey("fallback-record");
    const done = deferred();

    const run = lock("fallback-record", async () => {
      await done.promise;
      return 7;
    });
    await vi.advanceTimersByTimeAsync(100);
    const first = JSON.parse(origin.storage.get(key)!) as { heartbeatAt: number };

    await vi.advanceTimersByTimeAsync(10_000);
    const later = JSON.parse(origin.storage.get(key)!) as { heartbeatAt: number };
    expect(later.heartbeatAt).toBeGreaterThan(first.heartbeatAt);

    done.resolve();
    await expect(run).resolves.toBe(7);
    expect(origin.storage.has(key)).toBe(false);
  });

  it("keeps a long task locked past the stale timeout thanks to the heartbeat", async () => {
    const origin = simulateOrigin();
    const tabA = createCrossTabLock(origin.tab("a"));
    const tabB = createCrossTabLock(origin.tab("b"));
    const done = deferred();
    let bRan = false;

    const a = tabA("long-upload", () => done.promise);
    await vi.advanceTimersByTimeAsync(100);
    const b = tabB("long-upload", async () => {
      bRan = true;
    });

    await vi.advanceTimersByTimeAsync(CROSS_TAB_LOCK_STALE_MS * 3);
    expect(bRan).toBe(false);

    done.resolve();
    await a;
    await vi.advanceTimersByTimeAsync(1_000);
    await b;
    expect(bRan).toBe(true);
  });

  it("waits and takes over when the holder releases, without returning early", async () => {
    const origin = simulateOrigin();
    const tabA = createCrossTabLock(origin.tab("a"));
    const tabB = createCrossTabLock(origin.tab("b"));
    const done = deferred();
    const order: string[] = [];

    const a = tabA("handoff", async () => {
      order.push("a");
      await done.promise;
    });
    await vi.advanceTimersByTimeAsync(100);
    const b = tabB("handoff", async () => {
      order.push("b");
      return "b-result";
    });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(order).toEqual(["a"]);

    done.resolve();
    await a;
    await vi.advanceTimersByTimeAsync(100);
    await expect(b).resolves.toBe("b-result");
    expect(order).toEqual(["a", "b"]);
  });

  it("takes over a stale record left by a tab that died", async () => {
    const origin = simulateOrigin();
    const key = crossTabLockStorageKey("stale-holder");
    origin.storage.set(key, JSON.stringify({ owner: "dead-tab", heartbeatAt: Date.now() }));
    const lock = createCrossTabLock(origin.tab("b"));
    let ran = false;

    const run = lock("stale-holder", async () => {
      ran = true;
    });
    await vi.advanceTimersByTimeAsync(CROSS_TAB_LOCK_STALE_MS - 1_000);
    expect(ran).toBe(false);

    await vi.advanceTimersByTimeAsync(2_000);
    await run;
    expect(ran).toBe(true);
  });

  it("hands over right away when the holder's tab closes", async () => {
    const origin = simulateOrigin();
    const tabA = createCrossTabLock(origin.tab("a"));
    const tabB = createCrossTabLock(origin.tab("b"));
    let bRan = false;

    void tabA("closing-tab", () => new Promise<void>(() => undefined));
    await vi.advanceTimersByTimeAsync(100);
    const b = tabB("closing-tab", async () => {
      bRan = true;
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(bRan).toBe(false);

    origin.closeTab("a");
    await vi.advanceTimersByTimeAsync(200);
    await b;
    expect(bRan).toBe(true);
  });

  it("aborts the task's signal when another tab took the record", async () => {
    const origin = simulateOrigin();
    const lock = createCrossTabLock(origin.tab("a"));
    const key = crossTabLockStorageKey("lost-lock");
    let seen: AbortSignal | null = null;
    const done = deferred();

    const run = lock("lost-lock", async ({ signal }) => {
      seen = signal;
      await done.promise;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(seen!.aborted).toBe(false);

    origin.storage.set(key, JSON.stringify({ owner: "other", heartbeatAt: Date.now() }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(seen!.aborted).toBe(true);
    done.resolve();
    await run;
    expect(origin.storage.get(key)).toContain("other");
  });

  it("queues same-tab callers of one name and keeps names apart", async () => {
    const origin = simulateOrigin();
    const lock = createCrossTabLock(origin.tab("a"));
    const order: string[] = [];
    const first = deferred();

    const one = lock("queue", async () => {
      order.push("one");
      await first.promise;
    });
    const two = lock("queue", async () => {
      order.push("two");
    });
    const other = lock("other-name", async () => {
      order.push("other");
    });
    await vi.advanceTimersByTimeAsync(200);
    expect(order).toEqual(["one", "other"]);

    first.resolve();
    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([one, two, other]);
    expect(order).toEqual(["one", "other", "two"]);
  });

  it("only lets one of two racing tabs win the record", async () => {
    const origin = simulateOrigin();
    const tabs = [createCrossTabLock(origin.tab("a")), createCrossTabLock(origin.tab("b"))];
    let active = 0;
    let maxActive = 0;
    const runs = tabs.map((lock) =>
      lock("race", async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 300));
        active -= 1;
      }),
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.all(runs);
    expect(maxActive).toBe(1);
  });

  it("stops waiting when the caller aborts", async () => {
    const origin = simulateOrigin();
    const tabA = createCrossTabLock(origin.tab("a"));
    const tabB = createCrossTabLock(origin.tab("b"));
    void tabA("abort-wait", () => new Promise<void>(() => undefined));
    await vi.advanceTimersByTimeAsync(100);
    const controller = new AbortController();
    const waiting = tabB("abort-wait", async () => "never", { signal: controller.signal });
    const settled = expect(waiting).rejects.toBeTruthy();
    controller.abort();
    await vi.advanceTimersByTimeAsync(10);
    await settled;
  });

  it("still runs the task under the in-tab queue without localStorage", async () => {
    const origin = simulateOrigin();
    const env = { ...origin.tab("a"), storage: () => null };
    const lock = createCrossTabLock(env);
    const order: string[] = [];
    const first = deferred();
    const one = lock("no-storage", async () => {
      order.push("one");
      await first.promise;
    });
    const two = lock("no-storage", async () => {
      order.push("two");
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(order).toEqual(["one"]);
    first.resolve();
    await Promise.all([one, two]);
    expect(order).toEqual(["one", "two"]);
  });
});
