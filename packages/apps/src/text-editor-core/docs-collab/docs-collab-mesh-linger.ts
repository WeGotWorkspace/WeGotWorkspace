import type { DocsRtcSession } from "./docs-rtc-session";

/**
 * Grace period before a lingered mesh session really leaves. Must stay under
 * the server-side collab peer TTL (30 s, pruned on `seen_at`); 20 s leaves
 * headroom and the collab idle poll (15 s) normally lands at least one poll
 * inside the grace to refresh `seen_at`.
 */
export const DOCS_COLLAB_MESH_LINGER_MS = 20_000;

/** The subset of `DocsRtcSession` the linger cache needs (narrow for tests). */
export type LingerableMeshSession = Pick<DocsRtcSession, "leave" | "clearMessageListeners">;

export type MeshLingerPorts = {
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
  /** Subscribe to tab close; defaults to `window` `pagehide`. */
  subscribePageHide?: (listener: () => void) => () => void;
};

function defaultSubscribePageHide(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("pagehide", listener);
  return () => window.removeEventListener("pagehide", listener);
}

type LingerEntry<S extends LingerableMeshSession> = {
  session: S;
  timer: ReturnType<typeof setTimeout>;
};

/**
 * Suite-level cache that keeps a collab mesh session alive for a grace period
 * after its owning mount tears down, instead of leaving immediately. The
 * session keeps polling during the grace (nothing calls `leave()` or stops
 * the poll), so the server-side peer stays alive. Returning to the same room
 * within the grace resumes the live session; grace expiry — or `pagehide`
 * (tab close) — performs the real leave.
 */
export class DocsCollabMeshLingerCache<S extends LingerableMeshSession> {
  private readonly entries = new Map<string, LingerEntry<S>>();

  private readonly graceMs: number;

  private readonly scheduleTimeout: typeof setTimeout;

  private readonly cancelTimeout: typeof clearTimeout;

  private readonly subscribePageHide: (listener: () => void) => () => void;

  private pageHideUnsubscribe: (() => void) | null = null;

  constructor(graceMs: number = DOCS_COLLAB_MESH_LINGER_MS, ports: MeshLingerPorts = {}) {
    this.graceMs = graceMs;
    this.scheduleTimeout = ports.setTimeout ?? setTimeout.bind(globalThis);
    this.cancelTimeout = ports.clearTimeout ?? clearTimeout.bind(globalThis);
    this.subscribePageHide = ports.subscribePageHide ?? defaultSubscribePageHide;
  }

  /** Park a live session for the grace period instead of leaving it. */
  linger(room: string, session: S): void {
    const existing = this.entries.get(room);
    if (existing) {
      this.cancelTimeout(existing.timer);
      this.entries.delete(room);
      void Promise.resolve(existing.session.leave()).catch(() => undefined);
    }
    session.clearMessageListeners();
    const timer = this.scheduleTimeout(() => {
      this.entries.delete(room);
      this.syncPageHideSubscription();
      void Promise.resolve(session.leave()).catch(() => undefined);
    }, this.graceMs);
    this.entries.set(room, { session, timer });
    this.syncPageHideSubscription();
  }

  /** Reclaim the live session for a room, cancelling its pending leave. */
  resume(room: string): S | null {
    const entry = this.entries.get(room);
    if (!entry) return null;
    this.cancelTimeout(entry.timer);
    this.entries.delete(room);
    this.syncPageHideSubscription();
    return entry.session;
  }

  /** Immediate leave for every lingering session (tab close / test reset). */
  leaveAllNow(): void {
    for (const entry of this.entries.values()) {
      this.cancelTimeout(entry.timer);
      void Promise.resolve(entry.session.leave()).catch(() => undefined);
    }
    this.entries.clear();
    this.syncPageHideSubscription();
  }

  size(): number {
    return this.entries.size;
  }

  private syncPageHideSubscription(): void {
    if (this.entries.size > 0 && !this.pageHideUnsubscribe) {
      this.pageHideUnsubscribe = this.subscribePageHide(() => this.leaveAllNow());
      return;
    }
    if (this.entries.size === 0 && this.pageHideUnsubscribe) {
      this.pageHideUnsubscribe();
      this.pageHideUnsubscribe = null;
    }
  }
}

const singleton = new DocsCollabMeshLingerCache<DocsRtcSession>();

export function lingerDocsCollabMeshSession(room: string, session: DocsRtcSession): void {
  singleton.linger(room, session);
}

export function resumeDocsCollabMeshSession(room: string): DocsRtcSession | null {
  return singleton.resume(room);
}

export function resetDocsCollabMeshLingerForTests(): void {
  singleton.leaveAllNow();
}
