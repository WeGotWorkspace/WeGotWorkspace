import type { DocsCollabMeshMessage, DocsCollabMeshPeer } from "./docs-collab-types";

export const BC_TAB_ORIGIN = "bc-tab";
export const TAB_PING_INTERVAL_MS = 2000;
export const LEADER_STALE_MS = 6000;

export type TabPresence = {
  tabId: string;
  visible: boolean;
  lastSeen: number;
};

export type TabMeshStateSnapshot = {
  peers: DocsCollabMeshPeer[];
  connectingPeers: DocsCollabMeshPeer[];
  warningPeers: DocsCollabMeshPeer[];
  linkCount: number;
  status: string;
};

export type TabSyncMessage =
  | { type: "sync"; u: number[]; fromTab: string }
  | { type: "awareness"; u: number[]; fromTab: string }
  | { type: "tab-ping"; tabId: string; visible: boolean; at: number; isLeader?: boolean }
  | { type: "tab-leave"; tabId: string; at: number }
  | { type: "leader-resign"; tabId: string; at: number }
  | ({ type: "mesh-state"; fromTab: string } & TabMeshStateSnapshot);

export type TabSyncHandlers = {
  onSyncFromTab: (updateBytes: number[]) => void;
  onAwarenessFromTab: (updateBytes: number[]) => void;
  onMeshStateFromLeader: (state: TabMeshStateSnapshot) => void;
  onBecomeLeader: () => void;
  onResignLeader: () => void;
};

export function tabSyncChannelName(room: string): string {
  return `wgw.docs-collab.tab:${room}`;
}

export function createTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `tab-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

export function isTabPresenceStale(lastSeen: number, now: number = Date.now()): boolean {
  return now - lastSeen > LEADER_STALE_MS;
}

export function pruneStaleTabs(
  tabs: Map<string, TabPresence>,
  now: number = Date.now(),
): Map<string, TabPresence> {
  const active = new Map<string, TabPresence>();
  for (const [tabId, tab] of tabs) {
    if (!isTabPresenceStale(tab.lastSeen, now)) active.set(tabId, tab);
  }
  return active;
}

/**
 * Cold start only: prefer visible tabs, then the lexicographically smallest id.
 * Once a leader is known, {@link electStickyDocsLeaderTabId} keeps them.
 */
export function electLeaderTabId(
  tabs: ReadonlyMap<string, TabPresence>,
  now: number = Date.now(),
): string | null {
  const active = pruneStaleTabs(new Map(tabs), now);
  if (active.size === 0) return null;

  const visible = [...active.values()].filter((tab) => tab.visible);
  const candidates = visible.length > 0 ? visible : [...active.values()];
  candidates.sort((a, b) => a.tabId.localeCompare(b.tabId));
  return candidates[0]?.tabId ?? null;
}

export function isTabSyncMessage(value: unknown): value is TabSyncMessage {
  if (!value || typeof value !== "object") return false;
  const msg = value as Partial<TabSyncMessage>;
  if (msg.type === "sync" || msg.type === "awareness") {
    return typeof msg.fromTab === "string" && Array.isArray(msg.u);
  }
  if (msg.type === "tab-ping" || msg.type === "tab-leave" || msg.type === "leader-resign") {
    return typeof msg.tabId === "string";
  }
  if (msg.type === "mesh-state") {
    return typeof msg.fromTab === "string" && Array.isArray(msg.peers);
  }
  return false;
}

export function routeTabSyncMessage(
  msg: TabSyncMessage,
  myTabId: string,
  handlers: Pick<TabSyncHandlers, "onSyncFromTab" | "onAwarenessFromTab" | "onMeshStateFromLeader">,
): void {
  if (msg.type === "tab-ping" || msg.type === "tab-leave" || msg.type === "leader-resign") {
    return;
  }
  if (msg.fromTab === myTabId) return;

  if (msg.type === "sync") {
    handlers.onSyncFromTab(msg.u);
    return;
  }
  if (msg.type === "awareness") {
    handlers.onAwarenessFromTab(msg.u);
  }
  if (msg.type === "mesh-state") {
    handlers.onMeshStateFromLeader({
      peers: msg.peers,
      connectingPeers: msg.connectingPeers,
      warningPeers: msg.warningPeers,
      linkCount: msg.linkCount,
      status: msg.status,
    });
  }
}

export function applyTabPresenceMessage(
  tabs: Map<string, TabPresence>,
  msg: TabSyncMessage,
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
 * Keep `currentLeaderId` until resign, `pagehide`, or `tab-leave`. A hidden
 * leader must not hand the mesh to a visible tab — that rebuilt every peer
 * connection on a tab switch.
 */
export function electStickyDocsLeaderTabId(
  tabs: ReadonlyMap<string, TabPresence>,
  currentLeaderId: string | null,
  now: number = Date.now(),
): string | null {
  if (currentLeaderId) return currentLeaderId;
  return electLeaderTabId(tabs, now);
}

/**
 * Adopt a remote `isLeader` claim. Contenders collapse to the lexicographic
 * minimum so simultaneous claims converge on one tab.
 */
export function resolveDocsLeaderClaim(
  selfTabId: string,
  selfIsLeader: boolean,
  knownLeaderId: string | null,
  remoteTabId: string,
  remoteIsLeader: boolean,
): string | null {
  if (!remoteIsLeader || remoteTabId === selfTabId) return knownLeaderId;
  const contenders = [remoteTabId];
  if (knownLeaderId) contenders.push(knownLeaderId);
  if (selfIsLeader) contenders.push(selfTabId);
  contenders.sort((a, b) => a.localeCompare(b));
  return contenders[0] ?? knownLeaderId;
}

/** Docs mesh keeps leadership across hide. Hand-off is `pagehide` or tab leave. */
export function shouldResignOnHide(_isLeader: boolean, _visible: boolean): boolean {
  return false;
}

export type MeshRelayMessage = Extract<DocsCollabMeshMessage, { type: "sync" | "awareness" }>;

export function meshMessageForTabRelay(msg: DocsCollabMeshMessage): MeshRelayMessage | null {
  if (msg.type !== "sync" && msg.type !== "awareness") return null;
  if (!Array.isArray(msg.u)) return null;
  return msg;
}

export class DocsCollabTabCoordinator {
  private readonly tabs = new Map<string, TabPresence>();

  private channel: BroadcastChannel | null = null;

  private pingTimer: ReturnType<typeof setInterval> | null = null;

  private electTimer: ReturnType<typeof setInterval> | null = null;

  private isLeader = false;

  /** Last known leader. Sticky until resign, pagehide, or tab-leave. */
  private knownLeaderId: string | null = null;

  private visible = typeof document === "undefined" ? true : document.visibilityState === "visible";

  private readonly onVisibilityChange: () => void;

  private readonly onPageHide: () => void;

  constructor(
    private readonly room: string,
    private readonly handlers: TabSyncHandlers,
    readonly tabId: string = createTabId(),
  ) {
    this.onVisibilityChange = () => {
      this.visible = document.visibilityState === "visible";
      this.sendPing();
      // Sticky: never resign on hide. Peer connections stay up across a tab switch.
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

  start(): void {
    const now = Date.now();
    this.tabs.set(this.tabId, { tabId: this.tabId, visible: this.visible, lastSeen: now });

    try {
      this.channel = new BroadcastChannel(tabSyncChannelName(this.room));
      this.channel.onmessage = (event) => this.handleMessage(event.data);
    } catch {
      this.channel = null;
    }

    this.sendPing();
    this.runElection();

    this.pingTimer = setInterval(() => this.sendPing(), TAB_PING_INTERVAL_MS);
    this.electTimer = setInterval(() => this.runElection(), TAB_PING_INTERVAL_MS);

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      window.addEventListener("pagehide", this.onPageHide);
    }
  }

  stop(): void {
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

  publishSync(encoded: number[]): void {
    this.post({ type: "sync", u: encoded, fromTab: this.tabId });
  }

  publishAwareness(encoded: number[]): void {
    this.post({ type: "awareness", u: encoded, fromTab: this.tabId });
  }

  publishMeshState(state: TabMeshStateSnapshot): void {
    if (!this.isLeader) return;
    this.post({ type: "mesh-state", fromTab: this.tabId, ...state });
  }

  relayMeshMessage(msg: DocsCollabMeshMessage): void {
    const relay = meshMessageForTabRelay(msg);
    if (!relay || !this.isLeader) return;
    if (relay.type === "sync") this.publishSync(relay.u);
    else this.publishAwareness(relay.u);
  }

  private handleMessage(data: unknown): void {
    if (!isTabSyncMessage(data)) return;

    if (data.type === "tab-ping") {
      const wasKnown = this.tabs.has(data.tabId);
      applyTabPresenceMessage(this.tabs, data);
      if (!wasKnown && data.tabId !== this.tabId) this.sendPing();
      this.knownLeaderId = resolveDocsLeaderClaim(
        this.tabId,
        this.isLeader,
        this.knownLeaderId,
        data.tabId,
        data.isLeader === true,
      );
      this.runElection();
      return;
    }

    applyTabPresenceMessage(this.tabs, data);
    routeTabSyncMessage(data, this.tabId, this.handlers);

    if (data.type === "leader-resign" || data.type === "tab-leave") {
      if (this.knownLeaderId === data.tabId) this.knownLeaderId = null;
      this.runElection();
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
    const leaderId = electStickyDocsLeaderTabId(this.tabs, this.knownLeaderId);
    const shouldLead = leaderId === this.tabId;

    if (shouldLead && !this.isLeader) {
      this.isLeader = true;
      this.knownLeaderId = this.tabId;
      this.sendPing();
      this.handlers.onBecomeLeader();
      return;
    }

    if (!shouldLead && this.isLeader) {
      this.resignLeadership();
    }
  }

  private resignLeadership(): void {
    if (!this.isLeader) return;
    this.isLeader = false;
    this.knownLeaderId = null;
    this.post({ type: "leader-resign", tabId: this.tabId, at: Date.now() });
    this.handlers.onResignLeader();
  }

  private post(message: TabSyncMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // Ignore BC post failures — mesh path remains available on leader tabs.
    }
  }
}
