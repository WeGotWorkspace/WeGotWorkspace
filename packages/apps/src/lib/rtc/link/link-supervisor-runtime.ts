import {
  reduceLink,
  type LinkDownHint,
  type LinkEffect,
  type LinkEvent,
  type LinkObservation,
  type LinkPeerState,
  type LinkPhase,
} from "@/lib/rtc/link/link-supervisor";

export type LinkSupervisorPorts = {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  isInitiator: (peerId: string) => boolean;
  /** Abort any existing peer connection for this peer, then dial a fresh one. */
  dial: (peerId: string) => void;
  sendHint: (peerId: string, hint: LinkDownHint) => void;
  log: (event: string, details: Record<string, unknown>) => void;
};

export class LinkSupervisor {
  private state = new Map<string, LinkPeerState>();

  private readonly timers = new Map<string, unknown>();

  private disposed = false;

  constructor(private readonly ports: LinkSupervisorPorts) {}

  roster(peerIds: readonly string[]): void {
    this.apply({ type: "roster", peerIds });
  }

  observe(peerId: string, obs: LinkObservation): void {
    this.apply({ type: "observe", peerId, obs });
  }

  hint(peerId: string): void {
    this.apply({ type: "hint", peerId });
  }

  networkChange(): void {
    this.apply({ type: "network-change" });
  }

  phase(peerId: string): LinkPhase | null {
    return this.state.get(peerId)?.phase ?? null;
  }

  dispose(): void {
    this.disposed = true;
    for (const handle of this.timers.values()) this.ports.clearTimeout(handle);
    this.timers.clear();
    this.state.clear();
  }

  private apply(event: LinkEvent): void {
    if (this.disposed) return;
    const reduced = reduceLink(this.state, event, {
      now: this.ports.now(),
      isInitiator: this.ports.isInitiator,
    });
    this.state = reduced.state;
    for (const effect of reduced.effects) this.run(effect);
  }

  private run(effect: LinkEffect): void {
    if (effect.type === "dial") {
      this.ports.log("link-dial", { remoteId: effect.peerId });
      this.ports.dial(effect.peerId);
    } else if (effect.type === "hint") {
      this.ports.log("link-hint-sent", { remoteId: effect.peerId });
      this.ports.sendHint(effect.peerId, effect.hint);
    } else if (effect.type === "schedule") {
      this.clearTimer(effect.peerId);
      const handle = this.ports.setTimeout(() => {
        this.timers.delete(effect.peerId);
        this.apply({ type: "timer", peerId: effect.peerId });
      }, effect.delayMs);
      this.timers.set(effect.peerId, handle);
    } else if (effect.type === "cancel") {
      this.clearTimer(effect.peerId);
    } else {
      this.ports.log(effect.event, effect.details);
    }
  }

  private clearTimer(peerId: string): void {
    const handle = this.timers.get(peerId);
    if (handle === undefined) return;
    this.ports.clearTimeout(handle);
    this.timers.delete(peerId);
  }
}

/** `online` and `navigator.connection` `change`. No-op outside a browser. */
export function subscribeNetworkChange(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const connection = (navigator as Navigator & { connection?: EventTarget }).connection;
  window.addEventListener("online", listener);
  connection?.addEventListener?.("change", listener);
  return () => {
    window.removeEventListener("online", listener);
    connection?.removeEventListener?.("change", listener);
  };
}
