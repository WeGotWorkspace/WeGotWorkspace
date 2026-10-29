import { crossTabTopic, type CrossTabTopic } from "@/lib/offline/core/cross-tab-topic";
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

const CHANNEL = "wgw-notifications-inbox";

/**
 * Shares the inbox one tab fetched with the other tabs, so a push costs one
 * GET per browser, not one per tab. Which tab fetches is decided by the push
 * hub (`hub.leading`, see use-notifications-inbox-push.ts).
 */
export class InboxFanOut {
  readonly #topic: CrossTabTopic<InboxMessage>;

  constructor(options: { topic: CrossTabTopic<InboxMessage> }) {
    this.#topic = options.topic;
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
  shared ??= new InboxFanOut({ topic: crossTabTopic<InboxMessage>(CHANNEL, isInboxMessage) });
  return shared;
}
