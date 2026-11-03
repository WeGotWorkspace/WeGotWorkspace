import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectivitySyncRunner,
  ConnectivitySyncRunnerRegistry,
} from "@/lib/offline/core/connectivity-sync-runner";
import { isCrossTabLockTimeout } from "@/lib/offline/core/cross-tab-lock";
import {
  enqueueOutboxMutation,
  listOutboxMutations,
  markOutboxError,
  removeOutboxMutation,
} from "@/lib/offline/core/outbox-store";

describe("ConnectivitySyncRunner", () => {
  it("awaits the in-flight flush when another flush is requested", async () => {
    let resolveFlush!: () => void;
    const flushTask = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFlush = () => resolve("done");
        }),
    );
    const runner = new ConnectivitySyncRunner(flushTask);

    const first = runner.flush();
    const second = runner.flush();

    expect(flushTask).toHaveBeenCalledTimes(1);
    resolveFlush();
    await expect(first).resolves.toBe("done");
    await expect(second).resolves.toBe("done");
  });

  it("allows a new flush after the previous one completes", async () => {
    const flushTask = vi.fn(async () => "done" as const);
    const runner = new ConnectivitySyncRunner(flushTask);

    expect(await runner.flush()).toBe("done");
    expect(await runner.flush()).toBe("done");
    expect(flushTask).toHaveBeenCalledTimes(2);
  });
});

describe("ConnectivitySyncRunnerRegistry", () => {
  it("returns the same runner for the same username", () => {
    const registry = new ConnectivitySyncRunnerRegistry<void>("test");
    const flushTask = vi.fn(async () => undefined);

    const a = registry.getOrCreate("user-a", flushTask);
    const b = registry.getOrCreate("user-a", flushTask);

    expect(a).toBe(b);
  });

  it("creates distinct runners per username", () => {
    const registry = new ConnectivitySyncRunnerRegistry<void>("test");
    const flushTask = vi.fn(async () => undefined);

    const a = registry.getOrCreate("user-a", flushTask);
    const b = registry.getOrCreate("user-b", flushTask);

    expect(a).not.toBe(b);
  });

  it("ignores flushTask on subsequent getOrCreate for the same username", async () => {
    const registry = new ConnectivitySyncRunnerRegistry<string>("test");
    const firstTask = vi.fn(async () => "first");
    const secondTask = vi.fn(async () => "second");

    const runner = registry.getOrCreate("user-a", firstTask);
    registry.getOrCreate("user-a", secondTask);

    expect(await runner.flush()).toBe("first");
    expect(firstTask).toHaveBeenCalledTimes(1);
    expect(secondTask).not.toHaveBeenCalled();
  });
});

/** Web Locks as the browser runs them: one holder per name, the rest wait in order. */
function installSerialWebLocks(): void {
  const tails = new Map<string, Promise<unknown>>();
  const locks = {
    request(
      name: string,
      options: { signal?: AbortSignal } | undefined,
      callback: () => Promise<unknown>,
    ) {
      const previous = tails.get(name) ?? Promise.resolve();
      const run = new Promise((resolve, reject) => {
        let started = false;
        // Like the browser: an abort while waiting rejects; once held, it does not.
        options?.signal?.addEventListener("abort", () => {
          if (!started) reject(new DOMException("Aborted", "AbortError"));
        });
        void previous.then(() => {
          if (options?.signal?.aborted) return;
          started = true;
          Promise.resolve(callback()).then(resolve, reject);
        });
      });
      tails.set(
        name,
        previous.then(() => run.catch(() => undefined)),
      );
      return run;
    },
  };
  Object.defineProperty(navigator, "locks", { configurable: true, value: locks });
}

describe("ConnectivitySyncRunnerRegistry across tabs", () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, "locks");
  });

  it("does not hang behind a stuck tab, and sends its own rows once that tab lets go", async () => {
    installSerialWebLocks();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let release!: () => void;
      const stuckTab = new ConnectivitySyncRunnerRegistry<void>("hang").getOrCreate(
        "ada",
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
      const otherTask = vi.fn(async () => undefined);
      const otherTab = new ConnectivitySyncRunnerRegistry<void>("hang").getOrCreate(
        "ada",
        otherTask,
      );
      // IndexedDB answers outside the fake clock.
      const settle = async () => {
        for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
      };

      void stuckTab.flush();
      let settled = false;
      void otherTab.flush().then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await settle();
      expect(settled).toBe(true);
      expect(otherTask).not.toHaveBeenCalled();

      // The stuck tab finishes; this tab's queued retry now gets the lock.
      release();
      await settle();
      await vi.advanceTimersByTimeAsync(5_000);
      await settle();
      expect(otherTask).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("tells a lock timeout apart from an AbortError thrown by the flush itself", () => {
    expect(isCrossTabLockTimeout(new DOMException("aborted fetch", "AbortError"))).toBe(false);
  });

  it("never runs two tabs' flushes of one domain and account at the same time", async () => {
    installSerialWebLocks();
    // Two registries stand in for two tabs: each has its own in-tab runner.
    const tabA = new ConnectivitySyncRunnerRegistry<void>("docs");
    const tabB = new ConnectivitySyncRunnerRegistry<void>("docs");
    let running = 0;
    let overlapped = false;
    const flushTask = async () => {
      running += 1;
      if (running > 1) overlapped = true;
      await new Promise((resolve) => setTimeout(resolve, 10));
      running -= 1;
    };

    await Promise.all([
      tabA.getOrCreate("ada", flushTask).flush(),
      tabB.getOrCreate("ada", flushTask).flush(),
    ]);

    expect(overlapped).toBe(false);
  });

  it("lets different domains flush side by side", async () => {
    installSerialWebLocks();
    const order: string[] = [];
    const slow = (name: string) => async () => {
      order.push(`${name}:start`);
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push(`${name}:end`);
    };

    await Promise.all([
      new ConnectivitySyncRunnerRegistry<void>("docs").getOrCreate("ada", slow("docs")).flush(),
      new ConnectivitySyncRunnerRegistry<void>("tasks").getOrCreate("ada", slow("tasks")).flush(),
    ]);

    expect(order.slice(0, 2).sort()).toEqual(["docs:start", "tasks:start"]);
  });
});

describe("ConnectivitySyncRunnerRegistry retries", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, "onLine");
  });

  it("tries again by itself after a busy server (429), without a reconnect", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const username = "retry-user";
    await enqueueOutboxMutation(username, {
      id: "row-1",
      domain: "retry",
      op: "upsert",
      payload: "{}",
    });
    let calls = 0;
    const flushTask = vi.fn(async () => {
      calls += 1;
      if (calls === 1) await markOutboxError(username, "row-1", "failed (429)", 429);
      else await removeOutboxMutation(username, "row-1");
    });
    const runner = new ConnectivitySyncRunnerRegistry("retry").getOrCreate(username, flushTask);

    await runner.flush();
    expect(flushTask).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(flushTask).toHaveBeenCalledTimes(2);
    expect(await listOutboxMutations(username)).toHaveLength(0);
  });

  it("does not retry a conflict: a person decides that one", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const username = "conflict-user";
    await enqueueOutboxMutation(username, {
      id: "row-1",
      domain: "retry",
      op: "upsert",
      payload: "{}",
    });
    const flushTask = vi.fn(async () => {
      await markOutboxError(username, "row-1", "stateMismatch");
    });
    const runner = new ConnectivitySyncRunnerRegistry("retry").getOrCreate(username, flushTask);

    await runner.flush();
    await vi.advanceTimersByTimeAsync(400_000);

    expect(flushTask).toHaveBeenCalledTimes(1);
  });

  it("starts the ladder again on a flush it did not start itself (Retry, reconnect)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const username = "ladder-user";
    await enqueueOutboxMutation(username, {
      id: "row-1",
      domain: "retry",
      op: "upsert",
      payload: "{}",
    });
    const flushTask = vi.fn(async () => {
      await markOutboxError(username, "row-1", "failed (503)", 503);
    });
    const runner = new ConnectivitySyncRunnerRegistry("retry").getOrCreate(username, flushTask);

    // IndexedDB answers outside the fake clock: let it settle between steps.
    const settle = async () => {
      for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
    };
    const step = async (ms: number) => {
      await vi.advanceTimersByTimeAsync(ms);
      await settle();
    };

    await runner.flush();
    await settle();
    for (const delay of [5_000, 15_000, 60_000, 300_000]) await step(delay);
    expect(flushTask).toHaveBeenCalledTimes(5);
    await step(600_000);
    expect(flushTask).toHaveBeenCalledTimes(5);

    // The person presses Retry: the server is still failing, so the ladder runs again.
    await runner.flush();
    await settle();
    await step(5_000);
    expect(flushTask).toHaveBeenCalledTimes(7);
  });
});
