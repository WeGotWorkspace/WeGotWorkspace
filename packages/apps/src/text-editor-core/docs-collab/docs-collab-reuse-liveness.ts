/**
 * A reused principal link must deliver something soon after it attaches: the
 * other side sends a sync step 1 and its awareness on attach, and answers our
 * step 1. A link that stays silent this long is replaced by fresh ICE (#2061).
 */
export const COLLAB_REUSE_SILENT_LINK_MS = 6_000;

type LivenessPorts = {
  onSilent: (collabPeerId: string) => void;
  timeoutMs?: number;
  setTimeoutFn: typeof setTimeout;
  clearTimeoutFn: typeof clearTimeout;
};

/** One timer per freshly attached reused peer, cleared by the first message it delivers. */
export class DocsCollabReuseLiveness {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly ports: LivenessPorts) {}

  /** Start (or restart) the silence window for a peer that just attached. */
  arm(collabPeerId: string): void {
    this.heard(collabPeerId);
    const timer = this.ports.setTimeoutFn(() => {
      this.timers.delete(collabPeerId);
      this.ports.onSilent(collabPeerId);
    }, this.ports.timeoutMs ?? COLLAB_REUSE_SILENT_LINK_MS);
    this.timers.set(collabPeerId, timer);
  }

  /** The peer delivered a message over the reused link: the link works. */
  heard(collabPeerId: string): void {
    const timer = this.timers.get(collabPeerId);
    if (timer === undefined) return;
    this.ports.clearTimeoutFn(timer);
    this.timers.delete(collabPeerId);
  }

  dispose(): void {
    for (const timer of this.timers.values()) this.ports.clearTimeoutFn(timer);
    this.timers.clear();
  }
}
