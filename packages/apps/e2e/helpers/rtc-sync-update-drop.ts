import type { BrowserContext, Page } from "@playwright/test";

/**
 * Drops inbound Yjs update frames on a browser context's data channels, so a
 * spec can make a peer miss updates on purpose.
 *
 * Only `SYNC_UPDATE` messages are dropped. A step 1 and a step 2 still pass,
 * so a repair that runs on those can still reach the page.
 *
 * Frame layout (see `src/lib/rtc/session/data-channel-frames.ts`): an 8-byte
 * frame header (message id, chunk index, chunk count), then
 * `[uint16 headerLen][JSON header][raw tail]`. A collab sync message has
 * `type: "sync"` and `bin: 1` on the header, or on the `payload` of a
 * principal-link envelope. The tail's first byte is the y-protocols message
 * type; 2 is an update. Typing updates fit in one frame, so a message split
 * over several frames is let through.
 */
export async function installSyncUpdateDrop(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const SYNC_UPDATE = 2;
    const state = { active: false, dropped: 0 };
    (window as Window & { __wgwSyncUpdateDrop?: typeof state }).__wgwSyncUpdateDrop = state;
    const decoder = new TextDecoder();

    const carriesSyncTail = (value: unknown, depth: number): boolean => {
      if (!value || typeof value !== "object" || depth > 3) return false;
      const record = value as Record<string, unknown>;
      if (record.type === "sync" && record.bin === 1) return true;
      return carriesSyncTail(record.payload, depth + 1);
    };

    const isSyncUpdate = (data: unknown): boolean => {
      if (!(data instanceof ArrayBuffer) || data.byteLength < 10) return false;
      const view = new DataView(data);
      if (view.getUint16(6) !== 1) return false;
      const headerLen = view.getUint16(8);
      const tailAt = 10 + headerLen;
      if (tailAt >= data.byteLength) return false;
      const bytes = new Uint8Array(data);
      let header: unknown;
      try {
        header = JSON.parse(decoder.decode(bytes.subarray(10, tailAt)));
      } catch {
        return false;
      }
      return carriesSyncTail(header, 0) && bytes[tailAt] === SYNC_UPDATE;
    };

    type Listener = (this: RTCDataChannel, event: MessageEvent) => unknown;
    const wrapped = new WeakMap<Listener, Listener>();
    const wrap = (listener: Listener): Listener => {
      const existing = wrapped.get(listener);
      if (existing) return existing;
      const filtered: Listener = function (event) {
        if (state.active && isSyncUpdate(event.data)) {
          state.dropped += 1;
          return undefined;
        }
        return listener.call(this, event);
      };
      wrapped.set(listener, filtered);
      return filtered;
    };

    const proto = RTCDataChannel.prototype;
    const onmessage = Object.getOwnPropertyDescriptor(proto, "onmessage");
    if (onmessage?.get && onmessage.set) {
      const { get, set } = onmessage;
      Object.defineProperty(proto, "onmessage", {
        configurable: true,
        enumerable: onmessage.enumerable,
        get() {
          return get.call(this);
        },
        set(listener: unknown) {
          set.call(this, typeof listener === "function" ? wrap(listener as Listener) : listener);
        },
      });
    }

    const add = EventTarget.prototype.addEventListener;
    const remove = EventTarget.prototype.removeEventListener;
    proto.addEventListener = function (
      this: RTCDataChannel,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      const next =
        type === "message" && typeof listener === "function"
          ? wrap(listener as Listener)
          : listener;
      add.call(this, type, next as EventListenerOrEventListenerObject | null, options);
    } as typeof proto.addEventListener;
    proto.removeEventListener = function (
      this: RTCDataChannel,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      const next =
        type === "message" && typeof listener === "function"
          ? (wrapped.get(listener as Listener) ?? listener)
          : listener;
      remove.call(this, type, next as EventListenerOrEventListenerObject | null, options);
    } as typeof proto.removeEventListener;
  });
}

/** Start dropping inbound Yjs updates on this page. */
export async function startDroppingSyncUpdates(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = (window as Window & { __wgwSyncUpdateDrop?: { active: boolean } })
      .__wgwSyncUpdateDrop;
    if (!state) throw new Error("installSyncUpdateDrop was not applied to this context");
    state.active = true;
  });
}

/** Stop dropping and return how many updates this page has dropped so far. */
export async function stopDroppingSyncUpdates(page: Page): Promise<number> {
  return page.evaluate(() => {
    const state = (
      window as Window & { __wgwSyncUpdateDrop?: { active: boolean; dropped: number } }
    ).__wgwSyncUpdateDrop;
    if (!state) throw new Error("installSyncUpdateDrop was not applied to this context");
    state.active = false;
    return state.dropped;
  });
}

/** How many updates this page has dropped so far. */
export async function droppedSyncUpdates(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      (window as Window & { __wgwSyncUpdateDrop?: { dropped: number } }).__wgwSyncUpdateDrop
        ?.dropped ?? 0,
  );
}
