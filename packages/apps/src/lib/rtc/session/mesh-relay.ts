import type { NetClass } from "@/lib/rtc/net-probe";
import { applyTurnOnPeerConnection } from "@/lib/rtc/session/apply-turn";
import { needsRelayPrecheck } from "@/lib/rtc/session/relay-policy";
import {
  requestRelay,
  type RelayReason,
  type RelayRequestClient,
  type RelayRequestOutcome,
} from "@/lib/rtc/session/relay-request";
import type { RtcSettings, TurnCredentials } from "@/lib/rtc/types";

export type MeshRelayPorts = {
  enabled: boolean;
  roomId: string;
  settings: RtcSettings;
  iceCandidatePoolSize?: number;
  localPeerId: () => string | null;
  localNet: () => NetClass | undefined;
  peerName: (remoteId: string) => string;
  postRelay?: RelayRequestClient["postRelay"];
  getPeerConnection: (remoteId: string) => RTCPeerConnection | null;
  onOutcome: (remoteId: string, name: string, outcome: RelayRequestOutcome) => void;
  /** Credentials are on the existing connection. The mesh times the rebuild. */
  onApplied?: (remoteId: string) => void;
  log: (event: string, details?: unknown) => void;
};

/**
 * Meet relay requests for one mesh. The Docs fallback reuses `requestRelay`;
 * this class is the Meet timing around that call.
 */
export class MeshRelay {
  private turn: TurnCredentials | null = null;

  private prechecked = false;

  private readonly requested = new Set<string>();

  constructor(private readonly ports: MeshRelayPorts) {}

  credentials(): TurnCredentials | null {
    return this.turn;
  }

  hasRequested(remoteId: string): boolean {
    return this.prechecked || this.requested.has(remoteId);
  }

  /** Join-time request. Runs before the first offer when our own path is bad. */
  async beforeDial(): Promise<void> {
    if (!this.ports.enabled || this.prechecked) return;
    if (!needsRelayPrecheck(this.ports.localNet())) return;
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
   * One request per peer. Credentials land on the existing connection; a new
   * `RTCPeerConnection` is the mesh's later rebuild, not this step.
   */
  async request(remoteId: string, reason: Exclude<RelayReason, "precheck">): Promise<void> {
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
    const pc = this.ports.getPeerConnection(remoteId);
    if (!pc) return;
    try {
      applyTurnOnPeerConnection(
        pc,
        this.ports.settings,
        outcome.turn,
        this.ports.iceCandidatePoolSize,
      );
      this.ports.onApplied?.(remoteId);
      this.ports.log("relay-applied", { remoteId });
    } catch (error) {
      this.ports.log("relay-apply-failed", { remoteId, error });
    }
  }

  private remember(remoteId: string, outcome: RelayRequestOutcome): void {
    if (outcome.outcome === "issued") this.turn = outcome.turn;
    this.ports.onOutcome(remoteId, this.ports.peerName(remoteId), outcome);
    this.ports.log("relay-request", { remoteId, outcome: outcome.outcome });
  }
}
