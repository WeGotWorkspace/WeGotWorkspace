import type { NetClass } from "@/lib/rtc/net-probe";
import { shouldRequestRelay } from "@/lib/rtc/session/relay-policy";

/** Initiator restarts ICE after the link has been disconnected this long. */
export const DISCONNECT_RESTART_MS = 2_000;

/** Offer/answer or a relay apply that is still not `connected`. */
export const RECOVERY_TIMEOUT_MS = 8_000;

/** A stable link may try relay again after this, if it later fails. */
export const RELAY_RESET_STABLE_MS = 60_000;

export type IceRecoveryPorts = {
  isInitiator: (remoteId: string) => boolean;
  remoteNet: (remoteId: string) => NetClass | undefined;
  localNet: () => NetClass | undefined;
  alreadyRequested: (remoteId: string) => boolean;
  markRequested: (remoteId: string) => void;
  restartIce: (remoteId: string) => void;
  requestRelay: (remoteId: string, reason: "timeout" | "failed") => void;
  resetRelayFallback: (remoteId: string) => void;
  schedule?: typeof setTimeout;
  cancel?: typeof clearTimeout;
};

/**
 * Disconnect, network-change, and give-up timers for one mesh. The mesh owns
 * the peer connections; this only decides when to restart or ask for a relay.
 */
export class IceRecovery {
  private readonly disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly giveUpTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private readonly stableTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly ports: IceRecoveryPorts) {}

  onConnected(remoteId: string): void {
    this.clear(this.disconnectTimers, remoteId);
    this.clear(this.giveUpTimers, remoteId);
    this.clear(this.stableTimers, remoteId);
    this.stableTimers.set(
      remoteId,
      this.schedule(() => {
        this.stableTimers.delete(remoteId);
        this.ports.resetRelayFallback(remoteId);
      }, RELAY_RESET_STABLE_MS),
    );
  }

  onDisconnected(remoteId: string): void {
    if (this.disconnectTimers.has(remoteId)) return;
    this.disconnectTimers.set(
      remoteId,
      this.schedule(() => {
        this.disconnectTimers.delete(remoteId);
        if (!this.ports.isInitiator(remoteId)) return;
        this.ports.restartIce(remoteId);
        this.armGiveUp(remoteId);
      }, DISCONNECT_RESTART_MS),
    );
  }

  /** First offer or answer: give the pair 8 seconds before a relay request. */
  onSignaled(remoteId: string): void {
    if (this.giveUpTimers.has(remoteId)) return;
    this.armGiveUp(remoteId);
  }

  onFailed(remoteId: string): void {
    this.clear(this.disconnectTimers, remoteId);
    this.requestIfNeeded(remoteId, "failed");
  }

  /** `online` and `navigator.connection` `change`: every peer, then an immediate poll. */
  restartAll(remoteIds: readonly string[]): void {
    for (const remoteId of remoteIds) {
      this.clear(this.disconnectTimers, remoteId);
      this.ports.restartIce(remoteId);
      this.armGiveUp(remoteId);
    }
  }

  dispose(): void {
    for (const timers of [this.disconnectTimers, this.giveUpTimers, this.stableTimers]) {
      for (const remoteId of [...timers.keys()]) this.clear(timers, remoteId);
    }
  }

  private armGiveUp(remoteId: string): void {
    this.clear(this.giveUpTimers, remoteId);
    this.giveUpTimers.set(
      remoteId,
      this.schedule(() => {
        this.giveUpTimers.delete(remoteId);
        this.requestIfNeeded(remoteId, "timeout");
      }, RECOVERY_TIMEOUT_MS),
    );
  }

  private requestIfNeeded(remoteId: string, reason: "timeout" | "failed"): void {
    if (this.ports.alreadyRequested(remoteId)) return;
    const local = this.ports.localNet();
    if (!local) return;
    if (
      !shouldRequestRelay(local, this.ports.remoteNet(remoteId), this.ports.isInitiator(remoteId))
    ) {
      return;
    }
    this.ports.markRequested(remoteId);
    this.ports.requestRelay(remoteId, reason);
  }

  private schedule(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    return (this.ports.schedule ?? setTimeout.bind(globalThis))(fn, ms);
  }

  private clear(timers: Map<string, ReturnType<typeof setTimeout>>, remoteId: string): void {
    const timer = timers.get(remoteId);
    if (timer === undefined) return;
    (this.ports.cancel ?? clearTimeout.bind(globalThis))(timer);
    timers.delete(remoteId);
  }
}
