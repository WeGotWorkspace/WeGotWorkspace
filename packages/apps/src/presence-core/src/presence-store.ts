import { getPrincipalLinkRegistry } from "@/lib/rtc/session/principal-link-registry";
import { FollowerPresenceSession } from "@/presence-core/src/follower-presence-session";
import type { PresenceJoinMode } from "@/presence-core/src/presence-join-timing";
import type {
  PresenceChatMessage,
  PresenceCoworker,
  PresenceEnvelope,
  PresenceMeshSession,
  PresenceSnapshot,
  PresenceUserStatus,
} from "@/presence-core/src/presence-types";
import {
  PrincipalTabCoordinator,
  type PrincipalTabSyncHandlers,
} from "@/presence-core/src/principal-tab-sync";

export type PresenceVisibilityPort = {
  getState: () => DocumentVisibilityState;
  subscribe: (listener: () => void) => () => void;
};

function defaultVisibilityPort(): PresenceVisibilityPort | null {
  if (typeof document === "undefined") return null;
  return {
    getState: () => document.visibilityState,
    subscribe: (listener) => {
      document.addEventListener("visibilitychange", listener);
      return () => document.removeEventListener("visibilitychange", listener);
    },
  };
}

export type PresenceStoreOptions = {
  createSession: () => PresenceMeshSession;
  /** `eager` joins on start; `lazy` defers the join until the tab is visible. */
  joinMode: PresenceJoinMode;
  /**
   * When true, only the sticky BroadcastChannel leader dials the principal mesh;
   * follower windows proxy envelopes (Phase 4 / #695). Default false for unit tests.
   */
  crossWindowLeader?: boolean;
  createTabCoordinator?: (handlers: PrincipalTabSyncHandlers) => PrincipalTabCoordinator;
  visibility?: PresenceVisibilityPort | null;
  now?: () => number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  typingTtlMs?: number;
};

const DEFAULT_TYPING_TTL_MS = 5000;

const MAX_CHAT_HISTORY = 200;

function createInitialSnapshot(): PresenceSnapshot {
  return {
    status: "idle",
    selfUsername: null,
    roster: [],
    chat: [],
    typingUsernames: [],
  };
}

/**
 * Suite-level principal presence store (framework-free; `subscribe`/`getSnapshot`
 * are `useSyncExternalStore`-compatible). One mesh session on the workspace-wide
 * principal room carries presence, chat, and typing envelopes over data channels.
 *
 * Join timing: `eager` joins on `start()`; `lazy` (mobile) waits until the tab is
 * visible and retries on every resume until joined — the mesh itself already
 * fast-polls when the tab becomes visible, so resume reconnects need no extra kick.
 *
 * Cross-window leadership (`crossWindowLeader`): sticky BC election so only one
 * window dials; followers use {@link FollowerPresenceSession}. Leader close →
 * handoff with an expected ~0.5–2 s reconnect blip (PeerConnection cannot move).
 */
export class PresenceStore {
  private snapshot: PresenceSnapshot = createInitialSnapshot();

  private readonly listeners = new Set<() => void>();

  private session: PresenceMeshSession | null = null;

  private followerSession: FollowerPresenceSession | null = null;

  private coordinator: PrincipalTabCoordinator | null = null;

  private unsubscribeSession: (() => void) | null = null;

  private unsubscribeVisibility: (() => void) | null = null;

  private readonly visibility: PresenceVisibilityPort | null;

  private readonly now: () => number;

  private readonly scheduleTimeout: typeof setTimeout;

  private readonly cancelTimeout: typeof clearTimeout;

  private readonly typingTtlMs: number;

  private readonly crossWindowLeader: boolean;

  private readonly createTabCoordinator: (
    handlers: PrincipalTabSyncHandlers,
  ) => PrincipalTabCoordinator;

  private selfUsername = "";

  private selfDisplayName = "";

  private selfStatus: PresenceUserStatus = "online";

  private joinInFlight = false;

  private joined = false;

  private stopped = false;

  private isMeshLeader = false;

  private chatCounter = 0;

  /** Latest reported status per remote peer id (multi-tab peers merge by username). */
  private readonly peerStatuses = new Map<string, PresenceUserStatus>();

  /** username -> typing indicator expiry timestamp. */
  private readonly typingUntil = new Map<string, number>();

  private typingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: PresenceStoreOptions) {
    this.visibility =
      options.visibility === undefined ? defaultVisibilityPort() : options.visibility;
    this.now = options.now ?? (() => Date.now());
    this.scheduleTimeout = options.setTimeoutFn ?? setTimeout.bind(globalThis);
    this.cancelTimeout = options.clearTimeoutFn ?? clearTimeout.bind(globalThis);
    this.typingTtlMs = options.typingTtlMs ?? DEFAULT_TYPING_TTL_MS;
    this.crossWindowLeader = options.crossWindowLeader ?? false;
    this.createTabCoordinator =
      options.createTabCoordinator ?? ((handlers) => new PrincipalTabCoordinator(handlers));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PresenceSnapshot => this.snapshot;

  /** Whether this window currently owns the principal mesh dial (cross-window mode). */
  get meshLeader(): boolean {
    return this.crossWindowLeader ? this.isMeshLeader : true;
  }

  /** Begin presence for the authenticated user. Join now (eager) or on visibility (lazy). */
  start(self: { username: string; displayName: string }): void {
    if (this.session || this.coordinator) return;
    this.stopped = false;
    this.selfUsername = self.username;
    this.selfDisplayName = self.displayName.trim() || self.username;
    this.update({ selfUsername: this.selfUsername });

    if (this.crossWindowLeader) {
      this.coordinator = this.createTabCoordinator({
        onBecomeLeader: () => {
          void this.onBecomeLeader();
        },
        onResignLeader: () => {
          void this.onResignLeader();
        },
        onEnvelopeFromFollower: ({ envelope, peerId }) => {
          if (!this.isMeshLeader || !this.session) return;
          if (peerId) this.session.sendTo(peerId, envelope);
          else this.session.broadcast(envelope);
        },
        onEnvelopeFromLeader: ({ peerId, envelope }) => {
          this.followerSession?.applyEnvelope(peerId, envelope);
        },
        onRosterFromLeader: (snapshot) => {
          this.followerSession?.applyRoster(snapshot);
          if (!this.joined) {
            this.joined = true;
            getPrincipalLinkRegistry().markPrincipalJoinAttempted();
            this.update({ status: "online" });
          }
        },
      });
      this.coordinator.start();
      // Cold followers never see onResignLeader — attach the proxy when we did not win.
      if (!this.isMeshLeader) {
        this.attachFollowerSession();
        this.update({ status: "waiting" });
      }
      return;
    }

    this.attachRealSession();
    if (this.options.joinMode === "eager" || this.isVisible()) {
      void this.joinNow();
    } else {
      this.update({ status: "waiting" });
    }
    this.installLazyVisibility();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = null;
    this.coordinator?.stop();
    this.coordinator = null;
    this.isMeshLeader = false;
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    if (this.typingTimer !== null) {
      this.cancelTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    const session = this.session;
    this.session = null;
    this.followerSession = null;
    this.joined = false;
    this.snapshot = createInitialSnapshot();
    this.notify();
    if (session) await session.leave();
  }

  sendChat(body: string): void {
    const trimmed = body.trim();
    if (!trimmed || !this.session || !this.joined) return;
    this.chatCounter += 1;
    const message: PresenceChatMessage = {
      id: `${this.selfUsername}:${this.now()}:${this.chatCounter}`,
      fromUsername: this.selfUsername,
      fromName: this.selfDisplayName,
      body: trimmed,
      ts: this.now(),
      isSelf: true,
    };
    this.session.broadcast({ v: 1, kind: "chat", id: message.id, body: trimmed, ts: message.ts });
    this.appendChat(message);
  }

  sendTyping(): void {
    if (!this.session || !this.joined) return;
    this.session.broadcast({ v: 1, kind: "typing" });
  }

  setAway(away: boolean): void {
    const status: PresenceUserStatus = away ? "away" : "online";
    if (status === this.selfStatus) return;
    this.selfStatus = status;
    this.session?.broadcast({ v: 1, kind: "presence", status });
  }

  private async onBecomeLeader(): Promise<void> {
    if (this.stopped) return;
    this.isMeshLeader = true;
    await this.detachSession();
    if (this.stopped) return;
    this.attachRealSession();
    this.joined = false;
    this.installLazyVisibility();
    if (this.options.joinMode === "eager" || this.isVisible()) {
      void this.joinNow();
    } else {
      this.update({ status: "waiting" });
    }
  }

  private async onResignLeader(): Promise<void> {
    if (this.stopped) return;
    this.isMeshLeader = false;
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = null;
    await this.detachSession();
    if (this.stopped) return;
    this.attachFollowerSession();
    this.joined = false;
    this.update({ status: "waiting" });
  }

  private attachRealSession(): void {
    this.followerSession = null;
    this.session = this.options.createSession();
    this.unsubscribeSession = this.session.onEvent((event) => {
      if (event.type === "roster") {
        this.publishRoster();
        this.relayRosterToFollowers();
      } else if (event.type === "dc-open") {
        this.session?.sendTo(event.peerId, { v: 1, kind: "presence", status: this.selfStatus });
        this.publishRoster();
        this.relayRosterToFollowers();
      } else if (event.type === "envelope") {
        this.handleEnvelope(event.peerId, event.envelope);
        this.coordinator?.publishEnvelopeIn(event.peerId, event.envelope);
      }
    });
  }

  private attachFollowerSession(): void {
    const proxy = new FollowerPresenceSession((envelope, peerId) => {
      this.coordinator?.publishEnvelopeOut(envelope, peerId);
    });
    this.followerSession = proxy;
    this.session = proxy;
    this.unsubscribeSession = this.session.onEvent((event) => {
      if (event.type === "roster") {
        this.publishRoster();
      } else if (event.type === "envelope") {
        this.handleEnvelope(event.peerId, event.envelope);
      }
    });
  }

  private async detachSession(): Promise<void> {
    this.unsubscribeSession?.();
    this.unsubscribeSession = null;
    const session = this.session;
    this.session = null;
    this.followerSession = null;
    this.joined = false;
    this.joinInFlight = false;
    if (session) await session.leave();
  }

  private relayRosterToFollowers(): void {
    if (!this.isMeshLeader || !this.session) return;
    this.coordinator?.publishRosterState({
      peers: this.session.getRoomPeers(),
      selfPeerId: null,
    });
  }

  private installLazyVisibility(): void {
    this.unsubscribeVisibility?.();
    this.unsubscribeVisibility = null;
    if (this.options.joinMode !== "lazy") return;
    this.unsubscribeVisibility =
      this.visibility?.subscribe(() => {
        if (this.isVisible() && !this.joined && (!this.crossWindowLeader || this.isMeshLeader)) {
          void this.joinNow();
        }
      }) ?? null;
  }

  private isVisible(): boolean {
    return (this.visibility?.getState() ?? "visible") === "visible";
  }

  private async joinNow(): Promise<void> {
    if (!this.session || this.joined || this.joinInFlight) return;
    if (this.crossWindowLeader && !this.isMeshLeader) return;
    this.joinInFlight = true;
    this.update({ status: "joining" });
    try {
      await this.session.join(this.selfDisplayName);
      if (this.stopped) return;
      this.joined = true;
      getPrincipalLinkRegistry().markPrincipalJoinAttempted();
      this.update({ status: "online" });
      this.publishRoster();
      this.relayRosterToFollowers();
    } catch {
      if (this.stopped) return;
      // Lazy mode retries on the next visibility resume; eager sessions surface the error.
      this.update({ status: this.options.joinMode === "lazy" ? "waiting" : "error" });
    } finally {
      this.joinInFlight = false;
    }
  }

  private handleEnvelope(peerId: string, envelope: PresenceEnvelope): void {
    if (envelope.kind === "presence") {
      this.peerStatuses.set(peerId, envelope.status);
      this.publishRoster();
      return;
    }

    const sender = this.session?.getRoomPeers().find((peer) => peer.id === peerId);
    const senderUsername = sender?.user ?? "";

    if (envelope.kind === "chat") {
      if (senderUsername) this.typingUntil.delete(senderUsername);
      this.appendChat({
        id: envelope.id,
        fromUsername: senderUsername,
        fromName: sender?.name ?? "Coworker",
        body: envelope.body,
        ts: envelope.ts,
        isSelf: false,
      });
      return;
    }

    if (envelope.kind === "typing" && senderUsername && senderUsername !== this.selfUsername) {
      this.typingUntil.set(senderUsername, this.now() + this.typingTtlMs);
      this.scheduleTypingExpiry();
      this.publishTyping();
    }
  }

  private appendChat(message: PresenceChatMessage): void {
    if (this.snapshot.chat.some((line) => line.id === message.id)) return;
    const chat = [...this.snapshot.chat, message].slice(-MAX_CHAT_HISTORY);
    this.update({ chat, typingUsernames: this.currentTypingUsernames() });
  }

  /**
   * Roster of online coworkers: server roster (usernames via the `user` field)
   * deduplicated across tabs, self excluded, `away` only when every session of a
   * user reports away.
   */
  private publishRoster(): void {
    const byUsername = new Map<string, PresenceCoworker & { allAway: boolean }>();
    for (const peer of this.session?.getRoomPeers() ?? []) {
      const username = peer.user ?? "";
      if (!username || username === this.selfUsername) continue;
      const status = this.peerStatuses.get(peer.id) ?? "online";
      const existing = byUsername.get(username);
      if (existing) {
        existing.allAway = existing.allAway && status === "away";
        existing.status = existing.allAway ? "away" : "online";
      } else {
        byUsername.set(username, {
          username,
          name: peer.name,
          status,
          allAway: status === "away",
        });
      }
    }
    const roster = [...byUsername.values()]
      .map(({ allAway: _allAway, ...coworker }) => coworker)
      .sort((a, b) => a.name.localeCompare(b.name));
    this.update({ roster });
  }

  private currentTypingUsernames(): string[] {
    const now = this.now();
    for (const [username, until] of this.typingUntil) {
      if (until <= now) this.typingUntil.delete(username);
    }
    return [...this.typingUntil.keys()].sort();
  }

  private publishTyping(): void {
    this.update({ typingUsernames: this.currentTypingUsernames() });
  }

  private scheduleTypingExpiry(): void {
    if (this.typingTimer !== null) return;
    this.typingTimer = this.scheduleTimeout(() => {
      this.typingTimer = null;
      this.publishTyping();
      if (this.typingUntil.size > 0) this.scheduleTypingExpiry();
    }, this.typingTtlMs);
  }

  private update(partial: Partial<PresenceSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createPresenceStore(options: PresenceStoreOptions): PresenceStore {
  return new PresenceStore(options);
}
