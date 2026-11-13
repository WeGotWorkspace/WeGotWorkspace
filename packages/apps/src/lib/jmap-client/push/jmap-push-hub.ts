import type { CrossTabTopic } from "@/lib/offline/core/cross-tab-topic";
import { pickFrontTab, type FocusSource, type FrontTab, type TabActivity } from "./front-tab";
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
/** Held by a tab in a live Meet call: it keeps the stream at the visible pace (#2129). */
const AWAKE_LOCK = `${PUSH_LOCK_PREFIX}awake/`;

/** Messages on the hub's `crossTabTopic`. Every tab keeps the same copy of the map. */
export type PushMessage =
  | { v: 1; kind: "state"; changed: StateChange["changed"]; hashes: PushHashes }
  | {
      v: 1;
      kind: "tab";
      tabId: string;
      types: string[];
      confirmed: PushHashes;
      /** Optional so a tab on an older build still parses. */
      visible?: boolean;
      /** The tab is in a live Meet call (#2129). Optional for older builds. */
      awake?: boolean;
      /** Epoch ms of the tab's last window focus (front-tab election). */
      focusedAt?: number;
      /** The screen the tab shows, path plus query. */
      route?: string | null;
    }
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

/**
 * Whether this tab must hear news as fast as a visible tab, although it may be
 * hidden: a tab in a live Meet call local-acks while hidden, so it has to see
 * a new inbox row within the local-ack grace (#2129).
 */
export type AwakeSource = {
  awake: () => boolean;
  subscribe: (listener: () => void) => () => void;
};

export type JmapPushHubOptions = {
  tabId: string;
  topic: CrossTabTopic<PushMessage>;
  /** Null without Web Locks: then the hub stays idle and the apps keep polling. */
  locks: WebLocks | null;
  visibility: VisibilitySource;
  /**
   * A tab in a live Meet call. It counts as visible for the stream's pace and
   * for who holds the stream, not for {@link JmapPushHub.frontTab}.
   */
  awake?: AwakeSource;
  /** Window focus, for the front-tab election; without it every tab counts as never focused. */
  focus?: FocusSource;
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
  #leaveLeaderQueue: (() => void) | null = null;
  #eventSource: EventSourceLike | null = null;
  /** The stream's status while this tab leads, re-sent to tabs that join later. */
  #leaderStatus = false;
  /** The screen this tab shows, as the app last reported it. */
  #route: string | null = null;
  /** Focus and route every other tab reported, for {@link frontTab}. */
  #activity = new Map<string, TabActivity>();

  constructor(options: JmapPushHubOptions) {
    this.#options = options;
  }

  get connected(): boolean {
    return this.#connected;
  }

  /**
   * True while this tab holds the browser's stream. Work one tab should do per
   * push (fetch the inbox once and share it) runs here: the leader is visible
   * whenever any subscribed tab is, so a paused background tab never holds it up.
   */
  get leading(): boolean {
    return this.#eventSource !== null;
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

  /** The app reports the screen this tab shows (path plus query) on every navigation. */
  setRoute(route: string): void {
    if (route === this.#route) return;
    this.#route = route;
    this.#publishTab();
  }

  /**
   * The tab the user is looking at: the most recently focused visible tab of
   * this browser, or null when every tab is hidden (docs/architecture/
   * notifications.md, "Active news on the client"). Visibility comes from the
   * tabs' visible locks, so a tab that crashed never wins; focus and route
   * come from what each tab reported. Without Web Locks, or while this hub
   * does not run, only this tab is known.
   */
  async frontTab(): Promise<FrontTab | null> {
    const { locks, tabId, visibility } = this.#options;
    const held =
      this.#active && locks ? await heldLockSuffixes(locks, VISIBLE_LOCK).catch(() => null) : null;
    const visible = held ?? new Set<string>();
    // This tab's own lock may still be on its way in or out.
    if (visibility.visible()) visible.add(tabId);
    else visible.delete(tabId);
    const activity = new Map(this.#activity).set(tabId, this.#selfActivity());
    return pickFrontTab(visible, activity, tabId);
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
    this.#confirmations.keepOnly(tabId);
    this.#activity.clear();
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
        void this.#handOverIfHidden();
      }
    };
    syncVisible(false);
    cleanups.push(
      visibility.subscribe(() => {
        syncVisible(true);
        this.#publishTab();
      }),
    );
    if (this.#options.focus) cleanups.push(this.#options.focus.subscribe(() => this.#publishTab()));
    cleanups.push(() => releaseVisible?.());

    const awake = this.#options.awake;
    if (awake) {
      let releaseAwake: (() => void) | null = null;
      const syncAwake = (wake: boolean) => {
        if (awake.awake() && !releaseAwake) {
          releaseAwake = holdWebLock(locks, `${AWAKE_LOCK}${tabId}`);
          if (wake) this.wake("awake");
        } else if (!awake.awake() && releaseAwake) {
          releaseAwake();
          releaseAwake = null;
          void this.#handOverIfHidden();
        }
      };
      syncAwake(false);
      cleanups.push(
        awake.subscribe(() => {
          syncAwake(true);
          this.#publishTab();
        }),
      );
      cleanups.push(() => releaseAwake?.());
    }

    const bye = () => this.#publish({ v: 1, kind: "bye", tabId }, { otherTabsOnly: true });
    if (this.#options.onPageHide) cleanups.push(this.#options.onPageHide(bye));

    this.#publishTab();
    this.#joinLeaderQueue(locks);
    this.#stopRunning = () => {
      bye();
      this.#leaveLeaderQueue?.();
      this.#leaveLeaderQueue = null;
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

  #joinLeaderQueue(locks: WebLocks): void {
    this.#leaveLeaderQueue = runWhileLeader(locks, LEADER_LOCK, () => this.#lead(locks));
  }

  /**
   * Chrome runs the timers of a tab hidden for 5 minutes once a minute, so a
   * hidden leader would reconnect late. While another subscribed tab is
   * visible or in a live Meet call, a hidden leader gives the lock back and
   * queues again; the lock moves on until such a tab holds it, which never
   * hands it over. Pass
   * `otherVisible` when another tab just said it is visible: the browser grants
   * that tab's visible lock later, so a query could still miss it. A tab that
   * was waiting in the queue drops such a claim, but its roll-call in `#lead`
   * makes every tab say again whether it is visible.
   */
  async #handOverIfHidden(otherVisible = false): Promise<void> {
    const { locks, tabId } = this.#options;
    if (!locks || !this.#eventSource || this.#busy()) return;
    if (!otherVisible) {
      const busy = await this.#busyTabs(locks);
      busy?.delete(tabId);
      if (!busy || busy.size === 0) return;
    }
    if (!this.#active || !this.#eventSource || this.#busy()) return;
    this.#leaveLeaderQueue?.();
    this.#joinLeaderQueue(locks);
  }

  /** This tab is visible or in a live Meet call: it hears news at the visible pace. */
  #busy(): boolean {
    return this.#options.visibility.visible() || (this.#options.awake?.awake() ?? false);
  }

  /** Tabs that are visible or in a live Meet call, from their locks; null when locks fail. */
  async #busyTabs(locks: WebLocks): Promise<Set<string> | null> {
    const [visible, awake] = await Promise.all([
      heldLockSuffixes(locks, VISIBLE_LOCK).catch(() => null),
      this.#options.awake
        ? heldLockSuffixes(locks, AWAKE_LOCK).catch(() => null)
        : Promise.resolve(new Set<string>()),
    ]);
    if (!visible || !awake) return null;
    return new Set([...visible, ...awake]);
  }

  #lead(locks: WebLocks): () => void {
    const { tabId } = this.#options;
    this.#publish({ v: 1, kind: "roll-call" }, { otherTabsOnly: true });
    this.#leaderStatus = false;
    this.#publish({ v: 1, kind: "status", connected: false });

    const eventSource = this.#options.createEventSource({
      lastEventId: async () => {
        const live = await heldLockSuffixes(locks, TAB_LOCK).catch(() => null);
        live?.add(tabId);
        return this.#confirmations.lastEventId(live);
      },
      everyTabHidden: async () => {
        const busy = await this.#busyTabs(locks);
        return busy !== null && busy.size === 0;
      },
      onStatus: (connected) => {
        this.#leaderStatus = connected;
        this.#publish({ v: 1, kind: "status", connected });
      },
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
    void this.#handOverIfHidden();
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
        if (message.tabId !== this.#options.tabId) {
          const firstHeard = !this.#activity.has(message.tabId);
          this.#activity.set(message.tabId, {
            focusedAt: message.focusedAt ?? 0,
            route: message.route ?? null,
          });
          // A tab that just joined does not know this tab's focus yet; answer it,
          // so every tab elects the same front tab.
          if (firstHeard) {
            this.#published = "";
            this.#publishTab();
          }
        }
        // A tab that just joined has not heard the status the leader sent before it.
        if (this.#eventSource && message.tabId !== this.#options.tabId) {
          this.#publish(
            { v: 1, kind: "status", connected: this.#leaderStatus },
            { otherTabsOnly: true },
          );
          // Trust the message: the browser grants the new tab's visible lock later.
          void this.#handOverIfHidden(message.visible === true || message.awake === true);
        }
        break;
      case "bye":
        this.#confirmations.removeTab(message.tabId);
        this.#activity.delete(message.tabId);
        break;
      case "roll-call":
        this.#published = "";
        this.#publishTab();
        break;
      case "status":
        this.#setConnected(message.connected);
        break;
      case "wake":
        if (message.reason === "visible" || message.reason === "awake") {
          void this.#handOverIfHidden(true);
        }
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
      visible: this.#options.visibility.visible(),
      ...(this.#options.awake?.awake() ? { awake: true } : {}),
      ...this.#selfActivity(),
    };
    const key = JSON.stringify(message);
    if (key === this.#published) return;
    this.#published = key;
    this.#publish(message);
  }

  #selfActivity(): TabActivity {
    return { focusedAt: this.#options.focus?.focusedAt() ?? 0, route: this.#route };
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
