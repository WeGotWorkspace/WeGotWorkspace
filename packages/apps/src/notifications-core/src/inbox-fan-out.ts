import { crossTabTopic, type CrossTabTopic } from "@/lib/offline/core/cross-tab-topic";
import type { NotificationInboxList } from "@/notifications-core/src/notifications-types";

/**
 * Sent by the tab that fetched the inbox for a pushed `Notification` state:
 * the rows it got, or that the fetch failed. `state` is the pushed state the
 * fetch answered, so a waiting tab knows the rows are new enough.
 */
export type InboxMessage =
  | ({ v: 1; kind: "inbox"; state: string } & NotificationInboxList)
  | { v: 1; kind: "inbox-failed"; state: string };

export function isInboxMessage(value: unknown): value is InboxMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as {
    v?: unknown;
    kind?: unknown;
    state?: unknown;
  } & Partial<NotificationInboxList>;
  if (message.v !== 1 || typeof message.state !== "string") return false;
  if (message.kind === "inbox-failed") return true;
  return (
    message.kind === "inbox" &&
    Array.isArray(message.list) &&
    typeof message.unreadCount === "number"
  );
}

const CHANNEL = "wgw-notifications-inbox";
/** Messages kept for a tab that starts waiting after they arrived. */
const RECENT_LIMIT = 16;
const COUNTER = /^\d+$/;

/**
 * True when `state` is older than `than`. `Notification` states are the
 * server's per-user inbox counter (`NotificationInboxMarkers`: "0", "1", …),
 * so they compare as integers; a state of any other shape has no order.
 */
export function isOlderInboxState(state: string, than: string): boolean {
  return COUNTER.test(state) && COUNTER.test(than) && Number(state) < Number(than);
}

/** True when rows fetched for `have` include everything `want` changed. */
function covers(have: string, want: string): boolean {
  return (
    have === want || (COUNTER.test(have) && COUNTER.test(want) && !isOlderInboxState(have, want))
  );
}

/**
 * Shares the inbox one tab fetched with the other tabs, so a push costs one
 * GET per browser, not one per tab. Which tab fetches is decided by the push
 * hub (`hub.leading`, see use-notifications-inbox-push.ts); the others wait
 * for its rows before they confirm the push.
 */
export class InboxFanOut {
  readonly #topic: CrossTabTopic<InboxMessage>;
  /** Recent rows from other tabs, for a tab that starts waiting after they arrived. */
  #recent: Array<InboxMessage & { kind: "inbox" }> = [];
  #waiters = new Set<(message: InboxMessage) => void>();

  constructor(options: { topic: CrossTabTopic<InboxMessage> }) {
    this.#topic = options.topic;
    this.#topic.subscribe((message) => {
      if (message.kind === "inbox") {
        this.#recent.push(message);
        if (this.#recent.length > RECENT_LIMIT) this.#recent.shift();
      }
      for (const waiter of [...this.#waiters]) waiter(message);
    });
  }

  /** Rows another tab fetched, with the pushed state they answer. */
  onShared(listener: (payload: NotificationInboxList, state: string) => void): () => void {
    return this.#topic.subscribe((message) => {
      if (message.kind === "inbox") {
        listener({ list: message.list, unreadCount: message.unreadCount }, message.state);
      }
    });
  }

  /** Send the rows this tab fetched for `state` to the other tabs. */
  share(payload: NotificationInboxList, state: string): void {
    this.#topic.publish(
      { v: 1, kind: "inbox", state, list: payload.list, unreadCount: payload.unreadCount },
      { otherTabsOnly: true },
    );
  }

  /** Tell the waiting tabs this tab's fetch for `state` failed. */
  shareFailed(state: string): void {
    this.#topic.publish({ v: 1, kind: "inbox-failed", state }, { otherTabsOnly: true });
  }

  /**
   * The rows another tab shares for `state` (or a newer state), or null when
   * its fetch for `state` failed during the wait or nothing came within
   * `timeoutMs` (that tab closed or crashed mid-fetch). A failure from before
   * the wait was an earlier attempt and does not count.
   */
  waitFor(state: string, timeoutMs: number): Promise<NotificationInboxList | null> {
    const answer = (message: InboxMessage) =>
      message.kind === "inbox" ? { list: message.list, unreadCount: message.unreadCount } : null;
    const cached = [...this.#recent].reverse().find((message) => covers(message.state, state));
    if (cached) return Promise.resolve(answer(cached));
    return new Promise((resolve) => {
      const done = (value: NotificationInboxList | null) => {
        clearTimeout(timer);
        this.#waiters.delete(waiter);
        resolve(value);
      };
      const waiter = (message: InboxMessage) => {
        if (message.kind === "inbox" ? covers(message.state, state) : message.state === state) {
          done(answer(message));
        }
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      this.#waiters.add(waiter);
    });
  }
}

let shared: InboxFanOut | null = null;

/** The browser's inbox fan-out for this tab. */
export function defaultInboxFanOut(): InboxFanOut {
  shared ??= new InboxFanOut({ topic: crossTabTopic<InboxMessage>(CHANNEL, isInboxMessage) });
  return shared;
}
