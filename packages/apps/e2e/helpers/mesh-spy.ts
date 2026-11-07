// Shared by the mesh specs (`mesh-check-now`, `push-mesh-interval`): a spy on
// the presence data channels, the writer's app modules, and the event-source
// requests of a browser.
import type { BrowserContext } from "@playwright/test";
import type { Tab } from "./live-matrix";

/**
 * Init script: counts open presence data channels and received `check-now`
 * and chat preview messages, and keeps the peer connections so a test can
 * drop them. Self-contained, because Playwright serialises it.
 */
export function spyOnMesh() {
  const connections: RTCPeerConnection[] = [];
  const state = {
    open: 0,
    checkNow: 0,
    previews: 0,
    drop: () => {
      for (const connection of connections) connection.close();
      return connections.length;
    },
  };
  (window as unknown as { __meshSpy: typeof state }).__meshSpy = state;
  const Original = window.RTCPeerConnection;
  if (!Original) return;
  const decoder = new TextDecoder();
  const count = (text: string) => {
    if (text.includes("check-now")) state.checkNow += 1;
    if (text.includes("channel-message")) state.previews += 1;
  };
  const track = (channel: RTCDataChannel) => {
    channel.addEventListener("open", () => (state.open += 1));
    // Frames are bytes; decode leniently, a frame may hold a binary header.
    channel.addEventListener("message", (event: MessageEvent) => {
      const data: unknown = event.data;
      if (typeof data === "string") count(data);
      else if (data instanceof ArrayBuffer) count(decoder.decode(data));
      else if (data instanceof Blob) void data.text().then(count);
    });
  };
  class SpiedPeerConnection extends Original {
    constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
      super(...args);
      connections.push(this);
      this.addEventListener("datachannel", (event) => track(event.channel));
    }
    createDataChannel(...args: Parameters<RTCPeerConnection["createDataChannel"]>) {
      const channel = super.createDataChannel(...args);
      track(channel);
      return channel;
    }
  }
  window.RTCPeerConnection = SpiedPeerConnection;
}

type SpyState = { open: number; checkNow: number; previews: number; drop: () => number };
type SpyWindow = Window & { __meshSpy?: SpyState };

export function meshOpen(tab: Tab): Promise<number> {
  return tab.evaluate(() => (window as SpyWindow).__meshSpy?.open ?? 0);
}

export function spyCount(tab: Tab, key: "checkNow" | "previews"): Promise<number> {
  return tab.evaluate((name) => (window as SpyWindow).__meshSpy?.[name] ?? 0, key);
}

/** Closes every peer connection of the tab; returns how many. */
export function dropMesh(tab: Tab): Promise<number> {
  return tab.evaluate(() => (window as SpyWindow).__meshSpy?.drop() ?? 0);
}

/** The writer's app modules, loaded by Vite under the same URL the app uses. */
export function cachedAudience(tab: Tab, listId: string): Promise<string[]> {
  return tab.evaluate(async (list) => {
    const path = "/src/lib/offline/core/collection-check-now.ts";
    const module = (await import(/* @vite-ignore */ path)) as {
      cachedCollectionAudience(domain: string, ids: string[]): Promise<string[]>;
    };
    return module.cachedCollectionAudience("tasks", [list]);
  }, listId);
}

export async function writerCreatesTask(tab: Tab, listId: string, title: string): Promise<void> {
  await tab.evaluate(
    async ({ list, text }) => {
      const path = "/src/lib/api/wgw/tasks.ts";
      const module = (await import(/* @vite-ignore */ path)) as {
        createTask(body: { taskListIds: Record<string, boolean>; title: string }): Promise<unknown>;
      };
      await module.createTask({ taskListIds: { [list]: true }, title: text });
    },
    { list: listId, text: title },
  );
}

export function pushConnected(context: BrowserContext): Promise<unknown> {
  return context.waitForEvent("response", {
    predicate: (response) => /\/jmap\/events\//.test(response.url()) && response.status() === 200,
    timeout: 60_000,
  });
}

/** Start times (ms since epoch) of the browser's event-source requests, in order. */
export function recordPushRequests(context: BrowserContext): number[] {
  const starts: number[] = [];
  context.on("request", (request) => {
    if (/\/jmap\/events\//.test(request.url())) starts.push(Date.now());
  });
  return starts;
}
