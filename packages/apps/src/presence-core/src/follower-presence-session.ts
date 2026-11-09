import type { RtcPeerDescriptor } from "@/lib/rtc/types";
import type {
  PresenceEnvelope,
  PresenceMeshEvent,
  PresenceMeshSession,
} from "@/presence-core/src/presence-types";
import type { PrincipalRosterSnapshot } from "@/presence-core/src/principal-tab-sync";

/**
 * Follower-window transport: no principal signaling dial. Outbound envelopes go
 * through BroadcastChannel to the sticky leader; inbound roster/envelopes arrive
 * from the leader via {@link applyRoster} / {@link applyEnvelope}.
 */
export class FollowerPresenceSession implements PresenceMeshSession {
  private peers: RtcPeerDescriptor[] = [];

  private selfPeerId: string | null = null;

  private linkedPeerIds = new Set<string>();

  private readonly listeners = new Set<(event: PresenceMeshEvent) => void>();

  constructor(private readonly publishOut: (envelope: PresenceEnvelope, peerId?: string) => void) {}

  async join(): Promise<{ peerId: string; superseded?: true }> {
    return { peerId: this.selfPeerId ?? "follower-proxy" };
  }

  async leave(): Promise<void> {
    this.peers = [];
    this.selfPeerId = null;
    this.linkedPeerIds = new Set();
  }

  broadcast(envelope: PresenceEnvelope): void {
    this.publishOut(envelope);
  }

  sendTo(peerId: string, envelope: PresenceEnvelope): void {
    this.publishOut(envelope, peerId);
  }

  getRoomPeers(): RtcPeerDescriptor[] {
    return this.peers;
  }

  /** As the leader's mesh last reported it. */
  isLinked(peerId: string): boolean {
    return this.linkedPeerIds.has(peerId);
  }

  onEvent(listener: (event: PresenceMeshEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  applyRoster(snapshot: PrincipalRosterSnapshot): void {
    this.peers = snapshot.peers;
    this.selfPeerId = snapshot.selfPeerId;
    this.linkedPeerIds = new Set(snapshot.linkedPeerIds ?? []);
    this.emit({ type: "roster" });
  }

  applyEnvelope(peerId: string, envelope: PresenceEnvelope): void {
    this.emit({ type: "envelope", peerId, envelope });
  }

  private emit(event: PresenceMeshEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
