import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackgroundSyncRateLimitedError,
  createBackgroundSyncPacer,
  createBrowserSlots,
  createMemorySlots,
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

describe("shared slots", () => {
  it("two tabs drawing from one schedule go no faster than one", async () => {
    let clock = 1_000_000;
    const slots = createMemorySlots();
    const tab = () =>
      createBackgroundSyncPacer({
        requestsPerMinute: 20,
        slots,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      });
    const [docs, drive] = [tab(), tab()];
    const starts: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      await (index % 2 === 0 ? docs : drive).acquire();
      starts.push(clock);
    }
    // Six requests over two tabs, still one every 3 s.
    expect(starts.map((at) => at - 1_000_000)).toEqual([0, 3_000, 6_000, 9_000, 12_000, 15_000]);
  });
});

describe("waiting for a slot", () => {
  it("lets a click during the wait for a slot go first", async () => {
    let clock = 1_000_000;
    const pacer = createBackgroundSyncPacer({
      requestsPerMinute: 20,
      userIdleMs: 1_500,
      now: () => clock,
      sleep: async (ms) => {
        // The user clicks late in the wait for the second slot (+3 s).
        if (clock - 1_000_000 < 2_500 && clock + ms > 1_002_500) {
          clock = 1_002_500;
          pacer.noteUserActivity();
          return;
        }
        clock += ms;
      },
    });
    await pacer.acquire();
    await pacer.acquire();
    // The slot at +3 s is not used before the click's 1.5 s pause ends at +4 s.
    expect(clock - 1_000_000).toBe(4_000);
  });
});

/** A Web Lock stand-in: runs callbacks one at a time, like `navigator.locks.request`. */
function fakeLocks() {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    request: (_name: string, callback: () => unknown) => {
      const run = tail.then(() => callback());
      tail = run.catch(() => undefined);
      return run;
    },
  };
}

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    values,
  };
}

describe("createBrowserSlots", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubBrowser(locks: unknown, storage = memoryStorage()) {
    vi.stubGlobal("navigator", { locks });
    vi.stubGlobal("localStorage", storage);
    return storage;
  }

  it("hands two tabs consecutive slots from one shared schedule", async () => {
    const storage = stubBrowser(fakeLocks());
    const [tabA, tabB] = [createBrowserSlots(), createBrowserSlots()];
    const claims = await Promise.all([
      tabA.claim(10_000, 3_000, "first"),
      tabB.claim(10_000, 3_000, "first"),
      tabA.claim(10_000, 3_000, "first"),
    ]);
    expect(claims).toEqual([{ slot: 10_000 }, { slot: 13_000 }, { slot: 16_000 }]);
    expect(storage.values.get("wgw.backgroundSync.nextSlotAt")).toBe("19000");
  });

  it("ignores a stored slot more than ten intervals ahead", async () => {
    const storage = memoryStorage();
    storage.setItem("wgw.backgroundSync.nextSlotAt", String(10_000 + 31_000));
    stubBrowser(fakeLocks(), storage);
    expect(await createBrowserSlots().claim(10_000, 3_000)).toEqual({ slot: 10_000 });
  });

  it("keeps a stored slot within ten intervals", async () => {
    const storage = memoryStorage();
    storage.setItem("wgw.backgroundSync.nextSlotAt", String(10_000 + 24_000));
    stubBrowser(fakeLocks(), storage);
    // Bulk work does not book that slot ahead: it asks again when it is free.
    expect(await createBrowserSlots().claim(10_000, 3_000)).toEqual({ heldUntil: 34_000 });
    expect(await createBrowserSlots().claim(10_000, 3_000, "first")).toEqual({ slot: 34_000 });
  });

  it("never treats a full live queue as stale: twelve waiters at once stay one interval apart", async () => {
    const storage = stubBrowser(fakeLocks());
    const tabs = [createBrowserSlots(), createBrowserSlots(), createBrowserSlots()];
    const claims = await Promise.all(
      Array.from({ length: 12 }, (_, index) => tabs[index % 3]!.claim(10_000, 3_000, "first")),
    );
    // Nine slots (and the last one's hold) fit the horizon; the rest reserve
    // nothing and ask again once the queue has moved on.
    expect(claims.slice(0, 9)).toEqual(
      Array.from({ length: 9 }, (_, index) => ({ slot: 10_000 + index * 3_000 })),
    );
    expect(claims.slice(9)).toEqual(Array.from({ length: 3 }, () => ({ heldUntil: 13_000 })));
    expect(storage.values.get("wgw.backgroundSync.nextSlotAt")).toBe("37000");
  });

  it("twelve contact-page waiters in three tabs (the only claims that queue) start strictly one interval apart", async () => {
    stubBrowser(fakeLocks());
    let clock = 10_000;
    const timers: { at: number; resolve: () => void }[] = [];
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push({ at: clock + ms, resolve });
      });
    const starts: number[] = [];
    const tabs = Array.from({ length: 3 }, () =>
      createBackgroundSyncPacer({
        requestsPerMinute: 20,
        slots: createBrowserSlots(),
        now: () => clock,
        sleep,
      }),
    );
    const waiters = Array.from({ length: 12 }, (_, index) =>
      tabs[index % 3]!.acquire(undefined, "first").then(() => starts.push(clock)),
    );
    // Run the fake clock, waking sleepers in time order.
    while (starts.length < 12) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      timers.sort((left, right) => left.at - right.at);
      const next = timers.shift();
      if (!next) continue;
      clock = Math.max(clock, next.at);
      next.resolve();
    }
    await Promise.all(waiters);
    expect(starts).toEqual(Array.from({ length: 12 }, (_, index) => 10_000 + index * 3_000));
  });

  it("shares a contacts hold across tabs: another tab's Docs claim waits for it", async () => {
    const storage = stubBrowser(fakeLocks());
    const [contactsTab, docsTab] = [createBrowserSlots(), createBrowserSlots()];
    expect(await contactsTab.claim(10_000, 3_000, "first")).toEqual({ slot: 10_000 });
    expect(await docsTab.claim(10_500, 3_000, "bulk")).toEqual({ heldUntil: 16_000 });
    expect(storage.values.get("wgw.backgroundSync.nextSlotAt")).toBe("13000");
    expect(await docsTab.claim(16_000, 3_000, "bulk")).toEqual({ slot: 16_000 });
  });

  it("falls back to the tab's own schedule without Web Locks", async () => {
    const storage = stubBrowser(undefined);
    const slots = createBrowserSlots();
    expect(await slots.claim(10_000, 3_000, "first")).toEqual({ slot: 10_000 });
    expect(await slots.claim(10_000, 3_000, "first")).toEqual({ slot: 13_000 });
    expect(storage.values.size).toBe(0);
  });

  it("falls back to the tab's own schedule when the lock or storage fails", async () => {
    stubBrowser({
      request: () => Promise.reject(new DOMException("denied", "SecurityError")),
    });
    const slots = createBrowserSlots();
    expect(await slots.claim(10_000, 3_000, "first")).toEqual({ slot: 10_000 });
    expect(await slots.claim(10_000, 3_000, "first")).toEqual({ slot: 13_000 });
  });
});

describe("priority", () => {
  /** Two pacers (a Contacts tab and a Docs tab) on one fake clock and one schedule. */
  function sharedSchedule() {
    let clock = 0;
    const slots = createMemorySlots();
    const timers: { at: number; resolve: () => void }[] = [];
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        timers.push({ at: clock + ms, resolve });
      });
    const tab = () =>
      createBackgroundSyncPacer({ requestsPerMinute: 20, slots, now: () => clock, sleep });
    /** Runs the clock forward, waking sleepers in time order, until `until`. */
    async function runUntil(until: number) {
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        timers.sort((left, right) => left.at - right.at);
        const next = timers[0];
        if (!next || next.at > until) break;
        timers.shift();
        clock = next.at;
        next.resolve();
      }
      clock = until;
    }
    return { tab, runUntil, now: () => clock };
  }

  it("bulk work never books slots ahead of a contact page that comes later", async () => {
    const slots = createMemorySlots();
    // Three Docs and Drive syncs ask at once: one gets the free slot, the others
    // reserve nothing and ask again when the next slot is free.
    expect(await slots.claim(10_000, 3_000, "bulk")).toEqual({ slot: 10_000 });
    expect(await slots.claim(10_000, 3_000, "bulk")).toEqual({ heldUntil: 13_000 });
    expect(await slots.claim(10_000, 3_000, "bulk")).toEqual({ heldUntil: 13_000 });
    // A contact page that arrives later still gets the very next slot.
    expect(await slots.claim(11_000, 3_000, "first")).toEqual({ slot: 13_000 });
  });

  it("contact pages take every slot while they flow; Docs bodies wait for them", async () => {
    const { tab, runUntil, now } = sharedSchedule();
    const [contacts, docs] = [tab(), tab()];
    const log: string[] = [];
    let docsRunning = true;
    void (async () => {
      while (docsRunning) {
        await docs.acquire(undefined, "bulk");
        log.push(`docs ${now()}`);
      }
    })();
    void (async () => {
      for (let page = 0; page < 4; page += 1) {
        await contacts.acquire(undefined, "first");
        log.push(`contacts ${now()}`);
      }
    })();

    await runUntil(30_000);
    docsRunning = false;

    // Docs took the very first slot before the contacts download began; then
    // contacts pages own the schedule until their hold lapses.
    expect(log.slice(0, 6)).toEqual([
      "docs 0",
      "contacts 3000",
      "contacts 6000",
      "contacts 9000",
      "contacts 12000",
      "docs 18000",
    ]);
  });

  it("bulk work alone keeps the plain pace", async () => {
    const { tab, runUntil, now } = sharedSchedule();
    const docs = tab();
    const starts: number[] = [];
    void (async () => {
      for (let index = 0; index < 3; index += 1) {
        await docs.acquire();
        starts.push(now());
      }
    })();
    await runUntil(10_000);
    expect(starts).toEqual([0, 3_000, 6_000]);
  });
});
