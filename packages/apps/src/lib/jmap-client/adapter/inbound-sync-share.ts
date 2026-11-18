import type { CrossTabTopic } from "@/lib/offline/core/cross-tab-topic";
import type { VisibilitySource } from "../push/jmap-push-hub";
import {
  heldLockSuffixes,
  holdWebLock,
  runWhileLeader,
  type WebLocks,
} from "../push/web-locks-leader";

/**
 * What the tabs that sync the same app for the same account tell each other.
 * `name` is the app and account; `tabId` is the sender.
 */
export type InboundSyncMessage =
  /** The syncing tab finished a round and its cache writes; `states` is its cursor. */
  | { v: 1; kind: "round"; name: string; tabId: string; states: Record<string, string> }
  /** The sender is visible (it just became so, joined, or answers a roll-call). */
  | { v: 1; kind: "visible"; name: string; tabId: string }
  /** A hidden tab started syncing and asks which tabs are visible. */
  | { v: 1; kind: "roll-call"; name: string; tabId: string };

export function isInboundSyncMessage(value: unknown): value is InboundSyncMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as { v?: unknown; kind?: unknown; name?: unknown; tabId?: unknown } & {
    states?: unknown;
  };
  if (message.v !== 1 || typeof message.name !== "string" || typeof message.tabId !== "string") {
    return false;
  }
  if (message.kind === "visible" || message.kind === "roll-call") return true;
  return message.kind === "round" && typeof message.states === "object" && message.states !== null;
}

export type InboundSyncHandlers = {
  /**
   * This tab now syncs for the browser. `tookOver` is false when no tab synced
   * before it (the first tab to open), true when it follows another tab.
   */
  onOwn: (tookOver: boolean) => void;
  /** Another tab took over. */
  onLose: () => void;
  /** The syncing tab finished a round: its cursor, empty when it shares none. */
  onRound: (states: Record<string, string>) => void;
};

/** One tab's seat among the tabs that share an app's inbound sync. */
export type InboundSyncShare = {
  /** Take part; returns the function that leaves. */
  start: (handlers: InboundSyncHandlers) => () => void;
  /** Tell the other tabs this tab finished a round and its cache writes. */
  publishRound: (states: Record<string, string>) => void;
};

export type InboundSyncShareOptions = {
  /** The Web Lock the syncing tab holds: one per app and account. */
  name: string;
  /** Unique per seat, so two adapters in one tab count as two tabs. */
  tabId: string;
  locks: WebLocks;
  topic: CrossTabTopic<InboundSyncMessage>;
  visibility: VisibilitySource;
};

/**
 * Elects the one tab per browser that pulls an app's inbound changes (#2252).
 * The tab that holds the Web Lock `name` syncs; the others wait in the lock's
 * queue, so the next one takes over when it closes or crashes.
 *
 * A hidden tab does not run its fallback poll, so the lock should sit in a
 * visible tab. This follows the push hub's leader
 * (docs/architecture/jmap-push.md, "Leader and fan-out"): each tab holds a
 * second lock while it is visible, and a hidden tab that holds the sync lock
 * gives it back and queues again while another tab is visible. It checks when
 * it becomes hidden, when it gets the lock, and when another tab says it is
 * visible. A visible tab never hands over, so the lock settles there.
 */
export function inboundSyncShare(options: InboundSyncShareOptions): InboundSyncShare {
  const { name, tabId, locks, topic, visibility } = options;
  const visiblePrefix = `${name}/visible/`;
  const say = (kind: "visible" | "roll-call") =>
    topic.publish({ v: 1, kind, name, tabId }, { otherTabsOnly: true });

  return {
    publishRound(states) {
      topic.publish({ v: 1, kind: "round", name, tabId, states }, { otherTabsOnly: true });
    },
    start(handlers) {
      let stopped = false;
      let owning = false;
      let leave: () => void = () => undefined;
      /** Whether another tab held the sync lock when this one joined; unknown counts as yes. */
      let follows: Promise<boolean> = locks
        .query()
        .then((snapshot) => (snapshot.held ?? []).some((lock) => lock.name === name))
        .catch(() => true);

      const otherTabVisible = async (): Promise<boolean> => {
        const visible = await heldLockSuffixes(locks, visiblePrefix).catch(() => null);
        visible?.delete(tabId);
        return visible !== null && visible.size > 0;
      };
      const join = () => {
        leave = runWhileLeader(locks, name, lead);
      };
      const handOver = () => {
        leave();
        // When the lock comes back, another tab has synced in between.
        follows = Promise.resolve(true);
        if (!stopped) join();
      };
      /** Runs while this tab holds the lock; it owns the sync unless it must hand over. */
      const lead = (): (() => void) => {
        let held = true;
        void (async () => {
          const tookOver = await follows;
          if (!visibility.visible() && (await otherTabVisible())) {
            if (held) handOver();
            return;
          }
          if (!held) return;
          owning = true;
          handlers.onOwn(tookOver);
          // A visible tab's lock may be granted after the query above: ask.
          if (!visibility.visible()) say("roll-call");
        })();
        return () => {
          held = false;
          if (!owning) return;
          owning = false;
          handlers.onLose();
        };
      };
      /**
       * Pass `otherVisible` when another tab just said it is visible: the
       * browser grants that tab's visible lock later, so a query could miss it.
       */
      const handOverIfHidden = async (otherVisible: boolean): Promise<void> => {
        if (!owning || visibility.visible()) return;
        if (!otherVisible && !(await otherTabVisible())) return;
        if (stopped || !owning || visibility.visible()) return;
        handOver();
      };

      let releaseVisible: (() => void) | null = null;
      const syncVisible = () => {
        if (visibility.visible() && !releaseVisible) {
          releaseVisible = holdWebLock(locks, `${visiblePrefix}${tabId}`);
          say("visible");
        } else if (!visibility.visible() && releaseVisible) {
          releaseVisible();
          releaseVisible = null;
          void handOverIfHidden(false);
        }
      };
      const stopVisibility = visibility.subscribe(syncVisible);
      const stopTopic = topic.subscribe((message) => {
        if (message.name !== name || message.tabId === tabId) return;
        if (message.kind === "round") handlers.onRound(message.states);
        else if (message.kind === "visible") void handOverIfHidden(true);
        else if (visibility.visible()) say("visible");
      });
      syncVisible();
      join();

      return () => {
        stopped = true;
        stopVisibility();
        stopTopic();
        leave();
        releaseVisible?.();
        releaseVisible = null;
      };
    },
  };
}
