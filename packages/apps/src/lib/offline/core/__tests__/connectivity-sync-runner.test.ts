import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ConnectivitySyncRunner,
  ConnectivitySyncRunnerRegistry,
} from "@/lib/offline/core/connectivity-sync-runner";
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
    request(name: string, _options: unknown, callback: () => Promise<unknown>) {
      const run = (tails.get(name) ?? Promise.resolve()).then(() => callback());
      tails.set(
        name,
        run.catch(() => undefined),
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
});
