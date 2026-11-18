import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JmapClient } from "../core/JmapClient.js";
import { JmapInboundAdapter, SHARED_ROUND_WAIT_MS } from "./JmapInboundAdapter";
import { FakeSyncBrowser, type FakeSyncTab } from "./mock/fake-sync-tabs";

/** The server's Note state; a remote change moves it on. */
const server = { state: "n1" };

/** One tab's adapter: a pull reads the changes since its cursor and stores the server's state. */
class TabAdapter extends JmapInboundAdapter {
  #states = new Map<string, string>([["Note", "n1"]]);
  /** The cursor each pull started from. */
  pulledFrom: string[] = [];
  /** The cache write the next pull starts and does not wait for. */
  nextWrite: Promise<unknown> | undefined;
  repaints = 0;
  protected readonly pushTypes = ["Note"];
  protected get jmapClient(): JmapClient {
    return {
      getState: (_account: string, type: string) => this.#states.get(type),
      setState: (_account: string, type: string, state: string) => this.#states.set(type, state),
    } as unknown as JmapClient;
  }
  get accountId(): string {
    return "alice";
  }
  get cursor(): string | undefined {
    return this.#states.get("Note");
  }
  protected async pullChanges(): Promise<void> {
    this.pulledFrom.push(this.cursor ?? "");
    this.#states.set("Note", server.state);
    if (this.nextWrite) this.ingesting(this.nextWrite);
    this.nextWrite = undefined;
  }
  protected async refetchAll(): Promise<void> {}
  protected reportSyncError(): void {}
}

const settle = async () => {
  for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(1);
};

function open(tab: FakeSyncTab) {
  const adapter = new TabAdapter();
  const close = adapter.shareAcrossTabs(tab.share, () => {
    adapter.repaints += 1;
  });
  return { adapter, close };
}

describe("JmapInboundAdapter shared across tabs (#2252)", () => {
  let browser: FakeSyncBrowser;

  beforeEach(() => {
    vi.useFakeTimers();
    server.state = "n1";
    browser = new FakeSyncBrowser();
  });
  afterEach(() => vi.useRealTimers());

  /** Two tabs; the first owns the sync and has made its catch-up round. */
  async function twoTabs() {
    const tabA = browser.tab("a");
    const a = open(tabA);
    await settle();
    const tabB = browser.tab("b");
    const b = open(tabB);
    await settle();
    a.adapter.pulledFrom.length = 0;
    return { tabA, tabB, a, b };
  }

  it("a tab that opens later runs no push round and no poll; the first tab does", async () => {
    const { a, b } = await twoTabs();
    a.adapter.startPolling(1000);
    b.adapter.startPolling(1000);

    // The push reaches both tabs; the later tab confirms on the first tab's round.
    server.state = "n2";
    const inB = b.adapter.syncIfStale({ Note: "n2" });
    const inA = a.adapter.syncIfStale({ Note: "n2" });
    await settle();
    await expect(inA).resolves.toBe(true);
    await expect(inB).resolves.toBe(true);
    expect(a.adapter.pulledFrom).toEqual(["n1"]);
    expect(b.adapter.pulledFrom).toEqual([]);
    expect(b.adapter.cursor).toBe("n2");
    expect(b.adapter.repaints).toBe(1);

    await vi.advanceTimersByTimeAsync(3000);
    expect(a.adapter.pulledFrom).toHaveLength(4);
    expect(b.adapter.pulledFrom).toEqual([]);
    a.adapter.stopPolling();
    b.adapter.stopPolling();
  });

  it("a push the tab is not behind on is confirmed at once, without a round", async () => {
    const { b } = await twoTabs();
    await expect(b.adapter.syncIfStale({ Note: "n1" })).resolves.toBe(true);
    expect(b.adapter.pulledFrom).toEqual([]);
  });

  // The syncing tab loaded after the change: it has nothing to pull and stays silent.
  it("a tab behind on a push pulls for itself when the syncing tab tells it nothing", async () => {
    const { a, b } = await twoTabs();
    server.state = "n2";
    const inB = b.adapter.syncIfStale({ Note: "n2" });

    await vi.advanceTimersByTimeAsync(SHARED_ROUND_WAIT_MS - 1);
    expect(b.adapter.pulledFrom).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    await expect(inB).resolves.toBe(true);
    expect(b.adapter.pulledFrom).toEqual(["n1"]);
    expect(a.adapter.pulledFrom).toEqual([]);
  });

  // A push held for 5 s would hold up every push after it (the hub runs one at a time).
  it("a push that waits when the tab takes over the sync pulls at once", async () => {
    const { a, b } = await twoTabs();
    server.state = "n2";
    const inB = b.adapter.syncIfStale({ Note: "n2" });

    a.close();
    await settle();

    await expect(inB).resolves.toBe(true);
    expect(b.adapter.cursor).toBe("n2");
  });

  it("a push that arrives before the first tab holds the lock does not wait", async () => {
    const adapter = new TabAdapter();
    const close = adapter.shareAcrossTabs(browser.tab("a").share, () => undefined);
    server.state = "n2";
    const pushed = adapter.syncIfStale({ Note: "n2" });

    await settle();

    await expect(pushed).resolves.toBe(true);
    expect(adapter.cursor).toBe("n2");
    close();
  });

  it("the syncing tab tells the others about a push round that found nothing", async () => {
    const { a, b } = await twoTabs();
    // A push for a state the round is already past: b is behind on it, a pulls nothing new.
    const inB = b.adapter.syncIfStale({ Note: "n0" });
    await a.adapter.syncIfStale({ Note: "n0" });
    await settle();

    await expect(inB).resolves.toBe(true);
    expect(b.adapter.pulledFrom).toEqual([]);
  });

  it("an explicit sync runs in any tab", async () => {
    const { b } = await twoTabs();
    await b.adapter.sync();
    expect(b.adapter.pulledFrom).toEqual(["n1"]);
  });

  it("the other tab gets the cursor and repaints once the round's writes are in the cache", async () => {
    const { a, b } = await twoTabs();
    let written!: () => void;
    a.adapter.nextWrite = new Promise<void>((resolve) => (written = resolve));

    server.state = "n2";
    await a.adapter.sync();
    await settle();
    expect(b.adapter.repaints).toBe(0);
    expect(b.adapter.cursor).toBe("n1");

    written();
    await settle();
    expect(b.adapter.repaints).toBe(1);
    expect(b.adapter.cursor).toBe("n2");
  });

  it("a round that found nothing tells the other tabs nothing", async () => {
    const { a, b } = await twoTabs();
    await a.adapter.sync();
    await a.adapter.sync();
    await settle();
    expect(b.adapter.repaints).toBe(0);
  });

  it("owner closes: the next tab catches up from the shared cursor", async () => {
    const { a, b } = await twoTabs();
    server.state = "n2";
    await a.adapter.sync();
    await settle();

    server.state = "n3";
    a.close();
    await settle();

    expect(b.adapter.pulledFrom).toEqual(["n2"]);
    expect(b.adapter.cursor).toBe("n3");
    // It owns the sync now: a push round runs here.
    server.state = "n4";
    await b.adapter.syncIfStale({ Note: "n4" });
    expect(b.adapter.pulledFrom).toEqual(["n2", "n3"]);
  });

  it("owner closes before its write landed: the next tab reads that change again", async () => {
    const { a, b } = await twoTabs();
    a.adapter.nextWrite = new Promise<void>(() => undefined);
    server.state = "n2";
    await a.adapter.sync();
    await settle();

    a.close();
    await settle();

    // Not from n2: nothing says the change a's cursor covers is in the cache.
    expect(b.adapter.pulledFrom).toEqual(["n1"]);
  });

  it("a failed cache write shares no cursor, then or later; the other tabs still repaint", async () => {
    const { a, b } = await twoTabs();
    a.adapter.nextWrite = Promise.reject(new Error("quota"));
    server.state = "n2";
    await a.adapter.sync();
    await settle();
    expect(b.adapter.repaints).toBe(1);
    expect(b.adapter.cursor).toBe("n1");

    server.state = "n3";
    await a.adapter.sync();
    await settle();
    expect(b.adapter.repaints).toBe(2);
    expect(b.adapter.cursor).toBe("n1");
  });

  it("owner hidden while push is down: the visible tab takes over and its poll runs", async () => {
    const { tabA, a, b } = await twoTabs();
    a.adapter.startPolling(1000);
    b.adapter.startPolling(1000);
    server.state = "n2";

    tabA.setVisible(false);
    await settle();
    expect(browser.owner()).toBe("b");
    // The catch-up round on takeover, then the poll: no push needed.
    expect(b.adapter.pulledFrom).toEqual(["n1"]);
    a.adapter.pulledFrom.length = 0;
    server.state = "n3";
    await vi.advanceTimersByTimeAsync(1000);
    expect(b.adapter.pulledFrom).toEqual(["n1", "n2"]);
    expect(a.adapter.pulledFrom).toEqual([]);
    // The hidden tab reads what the visible tab wrote.
    await settle();
    expect(a.adapter.cursor).toBe("n3");
    expect(a.adapter.repaints).toBeGreaterThan(0);
    a.adapter.stopPolling();
    b.adapter.stopPolling();
  });

  it("a tab that stops sharing syncs for itself again", async () => {
    const { b } = await twoTabs();
    b.close();
    server.state = "n2";
    await expect(b.adapter.syncIfStale({ Note: "n2" })).resolves.toBe(true);
    expect(b.adapter.pulledFrom).toEqual(["n1"]);
  });
});
