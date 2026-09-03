import { rtcLog } from "@/lib/rtc/log";
import { createDataBinding } from "@/lib/rtc/session/bindings";
import { createRtcSession } from "@/lib/rtc/session/create-rtc-session";
import type { RtcPeerMesh } from "@/lib/rtc/session/peer-mesh";
import type { PrincipalLinkRegistry } from "@/lib/rtc/session/principal-link-registry";
import type { RtcPeerDescriptor, RtcSettings } from "@/lib/rtc/types";
import { DocsCollabPrincipalReuse } from "@/text-editor-core/docs-collab/docs-collab-principal-reuse";
import type {
  DocsCollabMeshMessage,
  DocsCollabMeshPeer,
  DocsCollabMeshPeerStatus,
} from "@/text-editor-core/docs-collab/docs-collab-types";

const DC_LABEL = "collab";

type MeshListener = (msg: DocsCollabMeshMessage) => void;

/** Validate a peer-hint payload from the wire; drops malformed entries. */
export function parsePeerHintPeers(value: unknown): DocsCollabMeshPeer[] {
  if (!Array.isArray(value)) return [];
  const peers: DocsCollabMeshPeer[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const { id, name } = entry as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || id === "" || typeof name !== "string") continue;
    peers.push({ id, name });
  }
  return peers;
}

export type DocsRtcSessionOptions = {
  apiBase: string;
  room: string;
  authToken?: string;
  rtcSettings: RtcSettings;
  /** Injected in tests; the live app uses the suite-level singleton. */
  reuseRegistry?: PrincipalLinkRegistry;
};

export class DocsRtcSession {
  private myName = "";

  private readonly listeners = new Set<MeshListener>();

  private readonly knownRosterIds = new Set<string>();

  private loggedFirstSync = false;

  private loggedFirstAwareness = false;

  private readonly mesh: RtcPeerMesh;

  private readonly reuse: DocsCollabPrincipalReuse;

  /** Collab peer ids that have appeared in a signaling roster while reused. */
  private readonly seenReusedRosterIds = new Set<string>();

  constructor(private readonly options: DocsRtcSessionOptions) {
    const binding = createDataBinding({
      label: DC_LABEL,
      onOpen: (remoteId) => {
        rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "datachannel-open", {
          remoteId,
          reused: false,
        });
        this.emit({ type: "dc-open", from: remoteId });
      },
      onMessage: (remoteId, data) => {
        try {
          const msg = JSON.parse(data) as DocsCollabMeshMessage;
          if (!msg || typeof msg !== "object") return;
          if (msg.type === "peer-hint") {
            this.mesh.applyPeerHint(parsePeerHintPeers(msg.peers));
            return;
          }
          if (msg.type === "sync" && !this.loggedFirstSync) {
            this.loggedFirstSync = true;
            rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "first-remote-sync", {
              from: remoteId,
              bytes: Array.isArray(msg.u) ? msg.u.length : 0,
            });
          }
          if (msg.type === "awareness" && !this.loggedFirstAwareness) {
            this.loggedFirstAwareness = true;
            rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "first-remote-awareness", {
              from: remoteId,
            });
          }
          this.emit({ ...msg, from: remoteId } as DocsCollabMeshMessage);
        } catch {
          // ignore malformed payloads
        }
      },
      onClose: () => this.emit({ type: "link" }),
    });

    this.reuse = new DocsCollabPrincipalReuse({
      room: options.room,
      registry: options.reuseRegistry,
      getMyCollabPeerId: () => this.mesh.getMyId(),
      getMyName: () => this.myName,
      onDcOpen: (remoteId) => this.emit({ type: "dc-open", from: remoteId }),
      onReuseFallback: () => this.mesh.retryRoomPeerConnections(),
      onReuseAttached: (remoteId) => this.mesh.abortPeerConnection(remoteId),
      onLinkChange: () => this.emit({ type: "link" }),
      onMessage: (msg) => this.handleReuseMeshMessage(msg),
    });

    this.mesh = createRtcSession({
      channel: "collab",
      room: options.room,
      rtcSettings: options.rtcSettings,
      binding,
      iceCandidatePoolSize: 2,
      signaling: {
        apiBase: options.apiBase,
        getAuth: () => ({ bearerToken: options.authToken }),
      },
      shouldConnectToPeer: (peer) => !this.reuse.shouldSkipIce(peer),
      onLinkChange: () => this.emit({ type: "link" }),
      onPollData: (data) => {
        this.reuse.considerRoster(data.peers, this.mesh.getMyId());
        this.dropStaleReusedPeers(data.peers);
        this.gossipNewRosterPeers(data.peers);
      },
    });
  }

  private emit(msg: DocsCollabMeshMessage): void {
    for (const listener of this.listeners) listener(msg);
  }

  private handleReuseMeshMessage(msg: DocsCollabMeshMessage): void {
    if (msg.type === "peer-hint") {
      this.mesh.applyPeerHint(parsePeerHintPeers(msg.peers));
      return;
    }
    if (msg.type === "sync" && !this.loggedFirstSync) {
      this.loggedFirstSync = true;
      rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "first-remote-sync", {
        from: msg.from,
        bytes: Array.isArray(msg.u) ? msg.u.length : 0,
        reused: true,
      });
    }
    if (msg.type === "awareness" && !this.loggedFirstAwareness) {
      this.loggedFirstAwareness = true;
      rtcLog({ channel: "collab", peerId: this.mesh.getMyId() }, "first-remote-awareness", {
        from: msg.from,
        reused: true,
      });
    }
    this.emit(msg);
  }

  private dropStaleReusedPeers(rosterPeers: RtcPeerDescriptor[]): void {
    const roomIds = new Set(rosterPeers.map((peer) => peer.id));
    for (const extra of this.reuse.extraPeers()) {
      if (roomIds.has(extra.id)) this.seenReusedRosterIds.add(extra.id);
    }
    for (const id of [...this.seenReusedRosterIds]) {
      if (roomIds.has(id)) continue;
      this.seenReusedRosterIds.delete(id);
      this.reuse.dropPeer(id, true);
    }
  }

  /**
   * Gossip discovery send side: when a roster poll reveals peers we have not
   * seen before, forward them over the already-open data channels so connected
   * peers do not wait out their own idle poll cycle. Best effort — peers
   * without an open channel simply rely on their normal poll.
   */
  private gossipNewRosterPeers(rosterPeers: DocsCollabMeshPeer[]): void {
    const myId = this.mesh.getMyId();
    const others = rosterPeers.filter((peer) => peer.id !== myId);
    const added = others.filter((peer) => !this.knownRosterIds.has(peer.id));
    this.knownRosterIds.clear();
    for (const peer of others) this.knownRosterIds.add(peer.id);
    if (added.length === 0) return;
    this.broadcast({
      type: "peer-hint",
      peers: added.map(({ id, name }) => ({ id, name })),
    });
  }

  onMessage(listener: MeshListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Drop all message listeners, e.g. when the owning mount lingers the session. */
  clearMessageListeners(): void {
    this.listeners.clear();
  }

  getMyId(): string | null {
    return this.mesh.getMyId();
  }

  getMyName(): string {
    return this.myName;
  }

  getPeerIds(): string[] {
    const ids = new Set(this.mesh.getPeerIds());
    for (const peer of this.reuse.extraPeers()) ids.add(peer.id);
    return [...ids];
  }

  getRoomPeers(): DocsCollabMeshPeer[] {
    const byId = new Map<string, DocsCollabMeshPeer>();
    for (const peer of this.mesh.getRoomPeers()) {
      byId.set(peer.id, { id: peer.id, name: peer.name });
    }
    for (const peer of this.reuse.extraPeers()) {
      if (!byId.has(peer.id)) byId.set(peer.id, peer);
    }
    return [...byId.values()];
  }

  getRoomPeerStatuses(): DocsCollabMeshPeerStatus[] {
    return this.reuse.overlayStatuses(
      this.mesh.getPeerLinkStates().map((peer) => ({
        id: peer.id,
        name: peer.name,
        link: peer.link as DocsCollabMeshPeerStatus["link"],
      })),
    );
  }

  linkCount(): number {
    return this.getRoomPeerStatuses().filter((peer) => peer.link === "connected").length;
  }

  broadcast(msg: DocsCollabMeshMessage): void {
    this.reuse.broadcast(msg);
    this.mesh.broadcastJson(msg);
  }

  sendTo(remoteId: string, msg: DocsCollabMeshMessage): void {
    if (this.reuse.sendTo(remoteId, msg)) return;
    this.mesh.sendJsonTo(remoteId, msg);
  }

  async join(name: string): Promise<{ peerId: string; peers: DocsCollabMeshPeer[] }> {
    this.myName = name.trim();
    const joined = await this.mesh.join({ name: this.myName });
    return { peerId: joined.peerId, peers: joined.peers };
  }

  async leave(): Promise<void> {
    this.reuse.dispose();
    this.seenReusedRosterIds.clear();
    await this.mesh.leave();
    this.myName = "";
  }
}
