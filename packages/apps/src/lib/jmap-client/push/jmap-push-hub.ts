import type { CrossTabTopic } from "@/lib/offline/core/cross-tab-topic";
import { PushConfirmations } from "./push-confirmations";
import { parsePushEventId, type PushHashes } from "./push-event-id";
import type { PushSink, PushTransport, StateChange } from "./push-transport";
import {
  StateChangeSubscription,
  type PushedState,
  type StateChangeListener,
} from "./state-change-subscription";
import { heldLockSuffixes, holdWebLock, runWhileLeader, type WebLocks } from "./web-locks-leader";

export const PUSH_LOCK_PREFIX = "wgw-jmap-push/";
const LEADER_LOCK = `${PUSH_LOCK_PREFIX}leader`;
const TAB_LOCK = `${PUSH_LOCK_PREFIX}tab/`;
const VISIBLE_LOCK = `${PUSH_LOCK_PREFIX}visible/`;

/** Messages on the hub's `crossTabTopic`. Every tab keeps the same copy of the map. */
export type PushMessage =
  | { v: 1; kind: "state"; changed: StateChange["changed"]; hashes: PushHashes }
  | { v: 1; kind: "tab"; tabId: string; types: string[]; confirmed: PushHashes }
  | { v: 1; kind: "bye"; tabId: string }
  | { v: 1; kind: "roll-call" }
  | { v: 1; kind: "status"; connected: boolean }
  | { v: 1; kind: "wake"; reason: string };

const PUSH_MESSAGE_KINDS = new Set(["state", "tab", "bye", "roll-call", "status", "wake"]);

export function isPushMessage(value: unknown): value is PushMessage {
  if (typeof value !== "object" || value === null) return false;
  const message = value as { v?: unknown; kind?: unknown };
  return (
    message.v === 1 && typeof message.kind === "string" && PUSH_MESSAGE_KINDS.has(message.kind)
  );
}

/** What the hub gives the event-source transport it creates when this tab leads. */
export type EventSourceContext = {
  lastEventId: () => Promise<string | null>;
  everyTabHidden: () => Promise<boolean>;
  onStatus: (connected: boolean) => void;
};

export type EventSourceLike = PushTransport & { reconnectNow(reason: string): void };

export type VisibilitySource = {
  visible: () => boolean;
  subscribe: (listener: () => void) => () => void;
};

export type JmapPushHubOptions = {
  tabId: string;
  topic: CrossTabTopic<PushMessage>;
  /** Null without Web Locks: then the hub stays idle and the apps keep polling. */
  locks: WebLocks | null;
  visibility: VisibilitySource;
  createEventSource: (ctx: EventSourceContext) => EventSourceLike;
  /** Wake-only transports (mesh `check-now`, #1662); their `deliver` is ignored. */
  wakeTransports?: () => PushTransport[];
  /** Fires when the page goes away, to say bye before the locks drop. */
  onPageHide?: (listener: () => void) => () => void;
};

/**
 * One JMAP push hub per tab; one of them, the Web Locks leader, holds the
 * browser's only event-source stream (docs/architecture/jmap-push.md). The
 * leader publishes each StateChange on a `crossTabTopic`, so every tab hears it
 * once and runs its own subscriptions. Tabs share their confirmed hashes the
 * same way, so a new leader reconnects from its own copy.
 *
 * The hub runs only while this tab has a subscriber, so an app that does not
 * use push costs nothing.
 */
export class JmapPushHub {
  #options: JmapPushHubOptions;
  #subscriptions = new Set<StateChangeSubscription>();
  #confirmations = new PushConfirmations();
  #statusListeners = new Set<(connected: boolean) => void>();
  #connected = false;
  #published = "";
  #active = false;
  #stopRunning: (() => void) | null = null;
  #eventSource: EventSourceLike | null = null;

  constructor(options: JmapPushHubOptions) {
    this.#options = options;
  }

  get connected(): boolean {
    return this.#connected;
  }

  /** Listen for pushed states of `types`; returns the unsubscribe function. */
  subscribe(types: readonly string[], listener: StateChangeListener): () => void {
    const subscription = new StateChangeSubscription(types, listener, () => this.#publishTab());
    this.#subscriptions.add(subscription);
    if (!this.#active) this.#start();
    else this.#publishTab();
    return () => {
      if (!this.#subscriptions.delete(subscription)) return;
      subscription.dispose();
      if (this.#subscriptions.size === 0) this.#stop();
      else this.#publishTab();
    };
  }

  subscribeStatus(listener: (connected: boolean) => void): () => void {
    this.#statusListeners.add(listener);
    return () => {
      this.#statusListeners.delete(listener);
    };
  }

  /** Ask the leader to reconnect now, for example right after this tab wrote. */
  wake(reason: string): void {
    if (!this.#active) return;
    this.#publish({ v: 1, kind: "wake", reason });
  }

  #start(): void {
    this.#active = true;
    const { locks, tabId, topic, visibility } = this.#options;
    if (!locks) return;
    const cleanups: Array<() => void> = [];
    cleanups.push(topic.subscribe((message) => this.#onMessage(message)));
    cleanups.push(holdWebLock(locks, `${TAB_LOCK}${tabId}`));

    let releaseVisible: (() => void) | null = null;
    const syncVisible = (wakeOnShow: boolean) => {
      if (visibility.visible() && !releaseVisible) {
        releaseVisible = holdWebLock(locks, `${VISIBLE_LOCK}${tabId}`);
        if (wakeOnShow) this.wake("visible");
      } else if (!visibility.visible() && releaseVisible) {
        releaseVisible();
        releaseVisible = null;
      }
    };
    syncVisible(false);
    cleanups.push(visibility.subscribe(() => syncVisible(true)));
    cleanups.push(() => releaseVisible?.());

    const bye = () => this.#publish({ v: 1, kind: "bye", tabId }, { otherTabsOnly: true });
    if (this.#options.onPageHide) cleanups.push(this.#options.onPageHide(bye));

    this.#publishTab();
    const leave = runWhileLeader(locks, LEADER_LOCK, () => this.#lead(locks));
    this.#stopRunning = () => {
      bye();
      leave();
      for (const cleanup of cleanups.reverse()) cleanup();
    };
  }

  #stop(): void {
    const stop = this.#stopRunning;
    this.#active = false;
    this.#stopRunning = null;
    this.#published = "";
    stop?.();
    this.#setConnected(false);
  }

  #lead(locks: WebLocks): () => void {
    const { tabId } = this.#options;
    this.#publish({ v: 1, kind: "roll-call" }, { otherTabsOnly: true });
    this.#publish({ v: 1, kind: "status", connected: false });

    const eventSource = this.#options.createEventSource({
      lastEventId: async () => {
        const live = await heldLockSuffixes(locks, TAB_LOCK).catch(() => null);
        live?.add(tabId);
        return this.#confirmations.lastEventId(live);
      },
      everyTabHidden: async () => {
        const visible = await heldLockSuffixes(locks, VISIBLE_LOCK).catch(() => null);
        return visible !== null && visible.size === 0;
      },
      onStatus: (connected) => this.#publish({ v: 1, kind: "status", connected }),
    });
    this.#eventSource = eventSource;

    const sink: PushSink = {
      deliver: (change, eventId) => {
        this.#publish({
          v: 1,
          kind: "state",
          changed: change.changed,
          hashes: parsePushEventId(eventId) ?? {},
        });
      },
      wake: (reason) => eventSource.reconnectNow(reason),
    };
    const wakeOnly: PushSink = { deliver: () => undefined, wake: sink.wake };
    const stops = [
      eventSource.start(sink),
      ...(this.#options.wakeTransports?.() ?? []).map((transport) => transport.start(wakeOnly)),
    ];
    return () => {
      for (const stop of stops) stop();
      if (this.#eventSource === eventSource) this.#eventSource = null;
    };
  }

  #onMessage(message: PushMessage): void {
    switch (message.kind) {
      case "state":
        this.#confirmations.noteLatest(message.hashes);
        this.#offer(message.changed, message.hashes);
        break;
      case "tab":
        this.#confirmations.setTab(message.tabId, message);
        break;
      case "bye":
        this.#confirmations.removeTab(message.tabId);
        break;
      case "roll-call":
        this.#published = "";
        this.#publishTab();
        break;
      case "status":
        this.#setConnected(message.connected);
        break;
      case "wake":
        this.#eventSource?.reconnectNow(message.reason);
        break;
    }
  }

  #offer(changed: StateChange["changed"], hashes: PushHashes): void {
    for (const [accountId, states] of Object.entries(changed)) {
      const pushed: Record<string, PushedState> = {};
      for (const [type, state] of Object.entries(states)) {
        pushed[type] = { state, hash: hashes[type] ?? null };
      }
      for (const subscription of this.#subscriptions) subscription.offer(accountId, pushed);
    }
  }

  /**
   * This tab's types and, per type, the hash all of its subscriptions on that
   * type confirmed. Published to every tab (this one included) on change.
   */
  #publishTab(): void {
    if (!this.#active || !this.#options.locks) return;
    const types = new Set<string>();
    for (const subscription of this.#subscriptions) {
      for (const type of subscription.types) types.add(type);
    }
    const confirmed: PushHashes = {};
    for (const type of types) {
      const hashes = [...this.#subscriptions]
        .filter((subscription) => subscription.types.includes(type))
        .map((subscription) => subscription.confirmed[type]);
      if (hashes[0] && hashes.every((hash) => hash === hashes[0])) confirmed[type] = hashes[0];
    }
    const message: PushMessage = {
      v: 1,
      kind: "tab",
      tabId: this.#options.tabId,
      types: [...types].sort(),
      confirmed,
    };
    const key = JSON.stringify(message);
    if (key === this.#published) return;
    this.#published = key;
    this.#publish(message);
  }

  #publish(message: PushMessage, options?: { otherTabsOnly?: boolean }): void {
    this.#options.topic.publish(message, options);
  }

  #setConnected(connected: boolean): void {
    if (this.#connected === connected) return;
    this.#connected = connected;
    for (const listener of this.#statusListeners) listener(connected);
  }
}
