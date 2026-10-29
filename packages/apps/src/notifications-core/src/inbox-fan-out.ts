import { crossTabTopic, type CrossTabTopic } from "@/lib/offline/core/cross-tab-topic";
import {
  browserWebLocks,
  runWhileLeader,
  type WebLocks,
} from "@/lib/jmap-client/push/web-locks-leader";
import type { NotificationInboxList } from "@/notifications-core/src/notifications-types";

export type InboxPayload = NotificationInboxList;

/** The inbox the leading tab fetched, sent to the other tabs. */
export type InboxMessage = { v: 1; kind: "inbox" } & InboxPayload;

export function isInboxMessage(value: unknown): value is InboxMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<InboxMessage>;
  return (
    message.v === 1 &&
    message.kind === "inbox" &&
    Array.isArray(message.list) &&
    typeof message.unreadCount === "number"
  );
}

const LEADER_LOCK = "wgw-notifications/inbox-leader";
const CHANNEL = "wgw-notifications-inbox";

export type InboxFanOutOptions = {
  /** `null` when the browser has no Web Locks: every tab then fetches for itself. */
  locks: WebLocks | null;
  topic: CrossTabTopic<InboxMessage>;
};

/**
 * One tab per browser fetches the inbox when a `Notification` push arrives and
 * shares the rows with the other tabs, so a push costs one GET, not one per
 * tab. The leader holds a Web Lock; when it closes, the next tab takes over.
 */
export class InboxFanOut {
  readonly #locks: WebLocks | null;
  readonly #topic: CrossTabTopic<InboxMessage>;
  #starts = 0;
  #leave: (() => void) | null = null;
  #leading = false;

  constructor(options: InboxFanOutOptions) {
    this.#locks = options.locks;
    this.#topic = options.topic;
  }

  /** Whether this tab fetches on push. Always true without Web Locks. */
  get leading(): boolean {
    return this.#locks === null || this.#leading;
  }

  /** Join the leader queue while a provider is mounted. Counted; returns stop. */
  start(): () => void {
    this.#starts += 1;
    if (this.#starts === 1 && this.#locks) {
      this.#leave = runWhileLeader(this.#locks, LEADER_LOCK, () => {
        this.#leading = true;
        return () => {
          this.#leading = false;
        };
      });
    }
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      this.#starts -= 1;
      if (this.#starts > 0) return;
      this.#leave?.();
      this.#leave = null;
    };
  }

  /** Rows another tab fetched. */
  onShared(listener: (payload: InboxPayload) => void): () => void {
    return this.#topic.subscribe(({ list, unreadCount }) => listener({ list, unreadCount }));
  }

  /** Send the rows this tab fetched to the other tabs. */
  share(payload: InboxPayload): void {
    this.#topic.publish(
      { v: 1, kind: "inbox", list: payload.list, unreadCount: payload.unreadCount },
      { otherTabsOnly: true },
    );
  }
}

let shared: InboxFanOut | null = null;

/** The browser's inbox fan-out for this tab. */
export function defaultInboxFanOut(): InboxFanOut {
  shared ??= new InboxFanOut({
    locks: browserWebLocks(),
    topic: crossTabTopic<InboxMessage>(CHANNEL, isInboxMessage),
  });
  return shared;
}
