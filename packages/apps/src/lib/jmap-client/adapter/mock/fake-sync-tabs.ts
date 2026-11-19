import { FakeCrossTabBus } from "../../push/mock/fake-cross-tab-bus";
import { FakeWebLocks } from "../../push/mock/fake-web-locks";
import {
  inboundSyncShare,
  type InboundSyncMessage,
  type InboundSyncShare,
} from "../inbound-sync-share";

export type FakeSyncTab = {
  id: string;
  share: InboundSyncShare;
  /** Show or hide the tab, as `visibilitychange` does. */
  setVisible: (visible: boolean) => void;
};

/** One browser for tests: tabs that share Web Locks and a BroadcastChannel. */
export class FakeSyncBrowser {
  readonly locks = new FakeWebLocks();
  readonly bus = new FakeCrossTabBus<InboundSyncMessage>();

  tab(id: string, options: { name?: string; visible?: boolean } = {}): FakeSyncTab {
    let visible = options.visible ?? true;
    const listeners = new Set<() => void>();
    const share = inboundSyncShare({
      name: options.name ?? "sync/notes/alice",
      tabId: id,
      locks: this.locks.client(id),
      topic: this.bus.topic(),
      visibility: {
        visible: () => visible,
        subscribe: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    });
    return {
      id,
      share,
      setVisible: (next) => {
        visible = next;
        for (const listener of [...listeners]) listener();
      },
    };
  }

  /** The tab that holds the sync lock. */
  owner(name = "sync/notes/alice"): string | undefined {
    return this.locks.holder(name);
  }
}

/** Let lock grants, lock queries and cross-tab messages (one task each) run. */
export async function settleTabs(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}
