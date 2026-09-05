import type { RtcPeerDescriptor } from "@/lib/rtc/types";
import type { PresenceEnvelope } from "@/presence-core/src/presence-types";

/** Workspace-wide principal mesh tab channel (not per-room). */
export const PRINCIPAL_TAB_CHANNEL = "wgw.principal.tab";

export const PRINCIPAL_TAB_PING_INTERVAL_MS = 2000;
/**
 * Used only when electing with **no** known leader (cold start / post-resign):
 * drop tabs that have not pinged recently from the candidate set.
 *
 * Do **not** use this as a lease to steal leadership — Chrome throttles timers in
 * background tabs, so a hidden leader's pings go silent while the tab is still alive.
 * Sticky handoff is resign / `pagehide` / `tab-leave` only.
 */
export const PRINCIPAL_LEADER_STALE_MS = 6000;
/**
 * Wait this long after `start()` before claiming leadership. BroadcastChannel
 * delivery is async — without a listen window a second tab elects itself, then
 * sticky election preserves a split brain with the existing leader.
 */
export const PRINCIPAL_ELECTION_GRACE_MS = 150;

export type PrincipalTabPresence = {
  tabId: string;
  visible: boolean;
  lastSeen: number;
};

export type PrincipalRosterSnapshot = {
  peers: RtcPeerDescriptor[];
  selfPeerId: string | null;
};

/**
 * BroadcastChannel messages for principal-mesh leadership + follower proxying.
 * Envelope traffic is proxied so follower windows never dial the principal room.
 */
export type PrincipalTabMessage =
  | {
      type: "tab-ping";
      tabId: string;
      visible: boolean;
      at: number;
      /** True when this tab currently owns the principal mesh dial. */
      isLeader?: boolean;
    }
  | { type: "tab-leave"; tabId: string; at: number }
  | { type: "leader-resign"; tabId: string; at: number }
  | {
      type: "envelope-out";
      fromTab: string;
      envelope: PresenceEnvelope;
      /** When set, leader `sendTo`s this peer; otherwise broadcasts. */
      peerId?: string;
    }
  | {
      type: "envelope-in";
      fromTab: string;
      peerId: string;
      envelope: PresenceEnvelope;
    }
  | ({ type: "roster-state"; fromTab: string } & PrincipalRosterSnapshot);

export type PrincipalTabSyncHandlers = {
  onBecomeLeader: () => void;
  onResignLeader: () => void;
  onEnvelopeFromFollower: (msg: {
    fromTab: string;
    envelope: PresenceEnvelope;
    peerId?: string;
  }) => void;
  onEnvelopeFromLeader: (msg: { peerId: string; envelope: PresenceEnvelope }) => void;
  onRosterFromLeader: (snapshot: PrincipalRosterSnapshot) => void;
};

export function createPrincipalTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function isPrincipalTabStale(
  lastSeen: number,
  now: number = Date.now(),
  staleMs: number = PRINCIPAL_LEADER_STALE_MS,
): boolean {
  return now - lastSeen > staleMs;
}

export function pruneStalePrincipalTabs(
  tabs: Map<string, PrincipalTabPresence>,
  now: number = Date.now(),
): Map<string, PrincipalTabPresence> {
  const active = new Map<string, PrincipalTabPresence>();
  for (const [tabId, tab] of tabs) {
    if (!isPrincipalTabStale(tab.lastSeen, now)) active.set(tabId, tab);
  }
  return active;
}

/**
 * Sticky election: keep `currentLeaderId` until callers clear it (resign /
 * `tab-leave` / `leader-resign`). Silent pings must not trigger takeover —
 * background tabs often stop timers under Chrome throttling while still open.
 *
 * Only when there is no known leader (cold start or after explicit handoff),
 * pick the lexicographically smallest non-stale tab id. Unlike docs-collab,
 * visibility must not bounce leadership.
 */
export function electStickyLeaderTabId(
  tabs: ReadonlyMap<string, PrincipalTabPresence>,
  currentLeaderId: string | null,
  now: number = Date.now(),
): string | null {
  if (currentLeaderId) {
    return currentLeaderId;
  }
  const active = pruneStalePrincipalTabs(new Map(tabs), now);
  if (active.size === 0) return null;
  const candidates = [...active.values()].sort((a, b) => a.tabId.localeCompare(b.tabId));
  return candidates[0]?.tabId ?? null;
}

/** Principal mesh keeps leadership across hide; docs-collab resigns — this is always false. */
export function shouldResignPrincipalOnHide(_isLeader: boolean, _visible: boolean): boolean {
  return false;
}

export function isPrincipalTabMessage(value: unknown): value is PrincipalTabMessage {
  if (!value || typeof value !== "object") return false;
  const msg = value as Partial<PrincipalTabMessage>;
  if (msg.type === "tab-ping" || msg.type === "tab-leave" || msg.type === "leader-resign") {
    return typeof msg.tabId === "string";
  }
  if (msg.type === "envelope-out") {
    return typeof msg.fromTab === "string" && !!msg.envelope && typeof msg.envelope === "object";
  }
  if (msg.type === "envelope-in") {
    return (
      typeof msg.fromTab === "string" &&
      typeof msg.peerId === "string" &&
      !!msg.envelope &&
      typeof msg.envelope === "object"
    );
  }
  if (msg.type === "roster-state") {
    return typeof msg.fromTab === "string" && Array.isArray(msg.peers);
  }
  return false;
}

export function applyPrincipalTabPresenceMessage(
  tabs: Map<string, PrincipalTabPresence>,
  msg: PrincipalTabMessage,
  now: number = Date.now(),
): void {
  if (msg.type === "tab-ping") {
    tabs.set(msg.tabId, { tabId: msg.tabId, visible: msg.visible, lastSeen: msg.at || now });
    return;
  }
  if (msg.type === "tab-leave" || msg.type === "leader-resign") {
    tabs.delete(msg.tabId);
  }
}

/**
 * When a remote tab announces `isLeader`, adopt or reconcile so sticky self-election
 * after an isolated cold start cannot preserve a split brain.
 *
 * Contenders are reduced to the lexicographic minimum so N-way simultaneous
 * claims (3+ tabs) converge to one sticky winner — not only pairwise A↔B.
 * Followers must not overwrite a better `knownLeaderId` with a later, larger
 * claimant (that left mid-tier ids sticky and could deadlock after the true
 * leader exits).
 */
export function resolvePrincipalLeaderClaim(
  selfTabId: string,
  selfIsLeader: boolean,
  knownLeaderId: string | null,
  remoteTabId: string,
  remoteIsLeader: boolean,
): string | null {
  if (!remoteIsLeader || remoteTabId === selfTabId) return knownLeaderId;
  const contenders: string[] = [remoteTabId];
  if (knownLeaderId) contenders.push(knownLeaderId);
  if (selfIsLeader) contenders.push(selfTabId);
  contenders.sort((a, b) => a.localeCompare(b));
  return contenders[0] ?? knownLeaderId;
}

/**
 * Coordinates sticky leadership for the workspace principal mesh and proxies
 * presence envelopes between the leader window and follower windows.
 */
export class PrincipalTabCoordinator {
  private readonly tabs = new Map<string, PrincipalTabPresence>();

  private channel: BroadcastChannel | null = null;

  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private electTimer: ReturnType<typeof setInterval> | null = null;

  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  private isLeader = false;

  /** After grace, this tab may call `onBecomeLeader` (BC peers had time to ping). */
  private electionReady = false;

  /** Last known elected leader across the channel (may be this tab or another). */
  private knownLeaderId: string | null = null;

  private visible = typeof document === "undefined" ? true : document.visibilityState === "visible";

  private readonly onVisibilityChange: () => void;

  private readonly onPageHide: () => void;

  constructor(
    private readonly handlers: PrincipalTabSyncHandlers,
    readonly tabId: string = createPrincipalTabId(),
    private readonly channelName: string = PRINCIPAL_TAB_CHANNEL,
  ) {
    this.onVisibilityChange = () => {
      this.visible = document.visibilityState === "visible";
      this.sendPing();
      // Sticky: never resign on hide — only refresh presence for diagnostics.
      this.runElection();
    };
    this.onPageHide = () => {
      this.resignLeadership();
      this.post({ type: "tab-leave", tabId: this.tabId, at: Date.now() });
    };
  }

  get meshLeader(): boolean {
    return this.isLeader;
  }

  get leaderTabId(): string | null {
    return this.knownLeaderId;
  }

  start(): void {
    const now = Date.now();
    this.electionReady = false;
    this.tabs.set(this.tabId, { tabId: this.tabId, visible: this.visible, lastSeen: now });

    try {
      this.channel = new BroadcastChannel(this.channelName);
      this.channel.onmessage = (event) => this.handleMessage(event.data);
    } catch {
      this.channel = null;
    }

    this.sendPing();
    // Collect peer pings before claiming leadership (BC delivery is async).
    this.runElection();
    this.graceTimer = setTimeout(() => {
      this.graceTimer = null;
      this.electionReady = true;
      this.runElection();
    }, PRINCIPAL_ELECTION_GRACE_MS);

    this.pingTimer = setInterval(() => this.sendPing(), PRINCIPAL_TAB_PING_INTERVAL_MS);
    this.electTimer = setInterval(() => this.runElection(), PRINCIPAL_TAB_PING_INTERVAL_MS);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      window.addEventListener("pagehide", this.onPageHide);
    }
  }

  stop(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.electionReady = false;

    if (this.isLeader) {
      this.isLeader = false;
      this.post({ type: "leader-resign", tabId: this.tabId, at: Date.now() });
    }
    this.post({ type: "tab-leave", tabId: this.tabId, at: Date.now() });

    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.electTimer) clearInterval(this.electTimer);
    this.pingTimer = null;
    this.electTimer = null;

    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      window.removeEventListener("pagehide", this.onPageHide);
    }

    this.channel?.close();
    this.channel = null;
    this.tabs.clear();
    this.knownLeaderId = null;
  }

  /** Follower → leader: ask the leader to broadcast or send an envelope on the mesh. */
  publishEnvelopeOut(envelope: PresenceEnvelope, peerId?: string): void {
    this.post({
      type: "envelope-out",
      fromTab: this.tabId,
      envelope,
      ...(peerId ? { peerId } : {}),
    });
  }

  /** Leader → followers: relay an inbound mesh envelope. */
  publishEnvelopeIn(peerId: string, envelope: PresenceEnvelope): void {
    if (!this.isLeader) return;
    this.post({ type: "envelope-in", fromTab: this.tabId, peerId, envelope });
  }

  /** Leader → followers: publish the current signaling roster snapshot. */
  publishRosterState(snapshot: PrincipalRosterSnapshot): void {
    if (!this.isLeader) return;
    this.post({ type: "roster-state", fromTab: this.tabId, ...snapshot });
  }

  private handleMessage(data: unknown): void {
    if (!isPrincipalTabMessage(data)) return;

    if (data.type === "tab-ping") {
      const wasKnown = this.tabs.has(data.tabId);
      applyPrincipalTabPresenceMessage(this.tabs, data);
      if (!wasKnown && data.tabId !== this.tabId) this.sendPing();
      this.knownLeaderId = resolvePrincipalLeaderClaim(
        this.tabId,
        this.isLeader,
        this.knownLeaderId,
        data.tabId,
        data.isLeader === true,
      );
      this.runElection();
      return;
    }

    if (data.type === "tab-leave" || data.type === "leader-resign") {
      applyPrincipalTabPresenceMessage(this.tabs, data);
      if (this.knownLeaderId === data.tabId) {
        this.knownLeaderId = null;
      }
      this.runElection();
      return;
    }

    if (data.type === "envelope-out") {
      if (data.fromTab === this.tabId) return;
      if (this.isLeader) {
        this.handlers.onEnvelopeFromFollower({
          fromTab: data.fromTab,
          envelope: data.envelope,
          peerId: data.peerId,
        });
      }
      return;
    }

    if (data.type === "envelope-in") {
      if (data.fromTab === this.tabId) return;
      if (!this.isLeader) {
        this.handlers.onEnvelopeFromLeader({ peerId: data.peerId, envelope: data.envelope });
      }
      return;
    }

    if (data.type === "roster-state") {
      if (data.fromTab === this.tabId) return;
      if (!this.isLeader) {
        this.handlers.onRosterFromLeader({
          peers: data.peers,
          selfPeerId: data.selfPeerId,
        });
      }
    }
  }

  private sendPing(): void {
    this.tabs.set(this.tabId, {
      tabId: this.tabId,
      visible: this.visible,
      lastSeen: Date.now(),
    });
    this.post({
      type: "tab-ping",
      tabId: this.tabId,
      visible: this.visible,
      at: Date.now(),
      isLeader: this.isLeader,
    });
  }

  private runElection(): void {
    const leaderId = electStickyLeaderTabId(this.tabs, this.knownLeaderId);
    this.knownLeaderId = leaderId;
    const shouldLead = leaderId === this.tabId;

    if (shouldLead && !this.isLeader) {
      if (!this.electionReady) {
        // Still listening for peer leader claims before dialing.
        return;
      }
      this.isLeader = true;
      this.handlers.onBecomeLeader();
      // Announce leadership immediately so late tabs adopt us during their grace.
      this.sendPing();
      return;
    }

    if (!shouldLead && this.isLeader) {
      this.resignLeadership();
    }
  }

  private resignLeadership(): void {
    if (!this.isLeader) return;
    this.isLeader = false;
    if (this.knownLeaderId === this.tabId) {
      this.knownLeaderId = null;
    }
    this.post({ type: "leader-resign", tabId: this.tabId, at: Date.now() });
    this.handlers.onResignLeader();
  }

  private post(message: PrincipalTabMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // Ignore BC post failures — sole-window path still works without peers.
    }
  }
}
