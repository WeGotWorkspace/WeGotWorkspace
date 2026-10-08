import type { NetClass } from "@/lib/rtc/net-probe";
import { applyTurnOnPeerConnection } from "@/lib/rtc/session/apply-turn";
import { needsRelayPrecheck } from "@/lib/rtc/session/relay-policy";
import {
  requestRelay,
  type RelayReason,
  type RelayRequestClient,
  type RelayRequestOutcome,
} from "@/lib/rtc/session/relay-request";
import { selectedPairIsRelay } from "@/lib/rtc/stats";
import type { RtcSettings, TurnCredentials } from "@/lib/rtc/types";

/** Re-mint this long before the server-supplied `ttl` elapses. */
const REFRESH_LEAD_MS = 60_000;

export type MeshRelayPorts = {
  enabled: boolean;
  roomId: string;
  settings: RtcSettings;
  /** Debug `rtcForceRelay`. Join mints TURN even when the net class is open. */
  forceRelay: boolean;
  iceCandidatePoolSize?: number;
  localPeerId: () => string | null;
  localNet: () => NetClass | undefined;
  peerName: (remoteId: string) => string;
  postRelay?: RelayRequestClient["postRelay"];
  getPeerConnection: (remoteId: string) => RTCPeerConnection | null;
  /** Live peer ids, so a precheck can refresh each relay pair later. */
  peerIds?: () => readonly string[];
  onOutcome: (remoteId: string, name: string, outcome: RelayRequestOutcome) => void;
  /** Credentials are on the existing connection. The mesh times the rebuild. */
  onApplied?: (remoteId: string) => void;
  log: (event: string, details?: unknown) => void;
  /** Test clock. Production uses `Date.now`. */
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
};

/**
 * Meet relay requests for one mesh. The Docs fallback reuses `requestRelay`;
 * this class is the Meet timing around that call.
 *
 * Credentials die with the `ttl` the server returned. This re-mints at
 * `ttl - 60s` and again on ICE restart, then puts them on the existing
 * connection. Refresh posts `reason: "refresh"` and only for a pair whose
 * selected candidate is still a relay.
 */
export class MeshRelay {
  private turn: TurnCredentials | null = null;

  private issuedAtMs = 0;

  private prechecked = false;

  private readonly requested = new Set<string>();

  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ports: MeshRelayPorts) {}

  dispose(): void {
    this.clearRefresh();
  }

  credentials(): TurnCredentials | null {
    return this.credentialsAreStale() ? null : this.turn;
  }

  hasRequested(remoteId: string): boolean {
    return this.prechecked || this.requested.has(remoteId);
  }

  /**
   * Join-time request. Runs before the first offer when our own path is bad,
   * and whenever debug force-relay is on — including an open path, where the
   * net class would otherwise skip the mint. A denied force-relay attempt
   * (lobby) may run again once the peer is allowed in.
   */
  async beforeDial(): Promise<void> {
    if (!this.ports.enabled) return;
    const forced = this.ports.forceRelay;
    if (this.prechecked && !(forced && !this.turn)) return;
    if (!this.ports.forceRelay && !needsRelayPrecheck(this.ports.localNet())) return;
    const peerId = this.ports.localPeerId();
    if (!peerId || !this.ports.postRelay) return;
    this.prechecked = true;
    const outcome = await requestRelay(
      { postRelay: this.ports.postRelay },
      {
        roomId: this.ports.roomId,
        peerId,
        target: "*",
        reason: "precheck",
        net: this.ports.localNet(),
      },
    );
    this.remember(peerId, outcome);
  }

  /**
   * One request per peer until the credential is inside its refresh window.
   * Credentials land on the existing connection; a new `RTCPeerConnection`
   * is the mesh's later rebuild, not this step.
   */
  async request(remoteId: string, reason: Exclude<RelayReason, "precheck">): Promise<void> {
    if (this.credentialsAreStale()) this.requested.delete(remoteId);
    if (!this.ports.enabled || this.requested.has(remoteId)) return;
    const peerId = this.ports.localPeerId();
    if (!peerId || !this.ports.postRelay) return;
    this.requested.add(remoteId);
    const outcome = await requestRelay(
      { postRelay: this.ports.postRelay },
      {
        roomId: this.ports.roomId,
        peerId,
        target: remoteId,
        reason,
        net: this.ports.localNet(),
      },
    );
    this.remember(remoteId, outcome);
    if (outcome.outcome !== "issued") return;
    this.apply(remoteId, outcome.turn);
  }

  /**
   * ICE restart drops the "already requested" mark and mints again, then
   * `applyTurnOnPeerConnection` puts the new servers on the live connection.
   */
  async onIceRestart(remoteId: string): Promise<void> {
    if (!this.ports.enabled) return;
    if (!this.turn && !this.requested.has(remoteId)) return;
    this.requested.delete(remoteId);
    await this.request(remoteId, "failed");
  }

  private apply(remoteId: string, turn: TurnCredentials): void {
    const pc = this.ports.getPeerConnection(remoteId);
    if (!pc) return;
    try {
      applyTurnOnPeerConnection(pc, this.ports.settings, turn, this.ports.iceCandidatePoolSize);
      this.ports.onApplied?.(remoteId);
      this.ports.log("relay-applied", { remoteId, ttl: turn.ttl });
    } catch (error) {
      this.ports.log("relay-apply-failed", { remoteId, error });
    }
  }

  private remember(remoteId: string, outcome: RelayRequestOutcome): void {
    if (outcome.outcome === "issued") {
      this.turn = outcome.turn;
      this.issuedAtMs = this.now();
      this.armRefresh(outcome.turn.ttl);
    }
    this.ports.onOutcome(remoteId, this.ports.peerName(remoteId), outcome);
    this.ports.log("relay-request", {
      remoteId,
      outcome: outcome.outcome,
      ttl: this.turn?.ttl,
      ...(outcome.outcome === "error" ? { error: outcome.error } : {}),
    });
  }

  /** `ttl` is seconds from the relay response, not a client constant. */
  private credentialsAreStale(now = this.now()): boolean {
    if (!this.turn) return false;
    const ttlMs = this.turn.ttl * 1000;
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return true;
    return now >= this.issuedAtMs + Math.max(0, ttlMs - REFRESH_LEAD_MS);
  }

  private armRefresh(ttlSeconds: number): void {
    this.clearRefresh();
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;
    const delay = Math.max(0, (ttlSeconds - 60) * 1000);
    const schedule = this.ports.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    const timer = schedule(() => {
      this.refreshTimer = null;
      void this.remintRequested();
    }, delay);
    if (typeof timer === "object" && timer !== null && "unref" in timer) {
      timer.unref();
    }
    this.refreshTimer = timer;
  }

  private async remintRequested(): Promise<void> {
    const ids = new Set(this.requested);
    for (const id of this.ports.peerIds?.() ?? []) ids.add(id);
    const redoPrecheck = this.prechecked;
    this.requested.clear();
    this.prechecked = false;
    this.turn = null;
    this.issuedAtMs = 0;
    const relayIds: string[] = [];
    for (const remoteId of ids) {
      if (await this.pairStillUsesRelay(remoteId)) relayIds.push(remoteId);
    }
    if (redoPrecheck && relayIds.length === 0) await this.beforeDial();
    for (const remoteId of relayIds) {
      await this.request(remoteId, "refresh");
    }
  }

  private async pairStillUsesRelay(remoteId: string): Promise<boolean> {
    const pc = this.ports.getPeerConnection(remoteId);
    if (!pc) return false;
    try {
      return await selectedPairIsRelay(pc);
    } catch {
      return false;
    }
  }

  private clearRefresh(): void {
    if (this.refreshTimer === null) return;
    const cancel = this.ports.cancel ?? ((timer) => clearTimeout(timer));
    cancel(this.refreshTimer);
    this.refreshTimer = null;
  }

  private now(): number {
    return this.ports.now?.() ?? Date.now();
  }
}
