import { createDataBinding } from "@/lib/rtc/session/bindings";
import { createRtcSession } from "@/lib/rtc/session/create-rtc-session";
import type { RtcPeerMesh } from "@/lib/rtc/session/peer-mesh";
import type { RtcSettings } from "@/lib/rtc/types";
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
};

export class DocsRtcSession {
  private myName = "";

  private readonly listeners = new Set<MeshListener>();

  private readonly knownRosterIds = new Set<string>();

  private readonly mesh: RtcPeerMesh;

  constructor(private readonly options: DocsRtcSessionOptions) {
    const binding = createDataBinding({
      label: DC_LABEL,
      onOpen: (remoteId) => this.emit({ type: "dc-open", from: remoteId }),
      onMessage: (remoteId, data) => {
        try {
          const msg = JSON.parse(data) as DocsCollabMeshMessage;
          if (!msg || typeof msg !== "object") return;
          if (msg.type === "peer-hint") {
            this.mesh.applyPeerHint(parsePeerHintPeers(msg.peers));
            return;
          }
          this.emit({ ...msg, from: remoteId } as DocsCollabMeshMessage);
        } catch {
          // ignore malformed payloads
        }
      },
      onClose: () => this.emit({ type: "link" }),
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
      onLinkChange: () => this.emit({ type: "link" }),
      onPollData: (data) => this.gossipNewRosterPeers(data.peers),
    });
  }

  private emit(msg: DocsCollabMeshMessage): void {
    for (const listener of this.listeners) listener(msg);
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
    return this.mesh.getPeerIds();
  }

  getRoomPeers(): DocsCollabMeshPeer[] {
    return this.mesh.getRoomPeers();
  }

  getRoomPeerStatuses(): DocsCollabMeshPeerStatus[] {
    return this.mesh.getPeerLinkStates().map((peer) => ({
      id: peer.id,
      name: peer.name,
      link: peer.link as DocsCollabMeshPeerStatus["link"],
    }));
  }

  linkCount(): number {
    return this.mesh.linkCount();
  }

  broadcast(msg: DocsCollabMeshMessage): void {
    this.mesh.broadcastJson(msg);
  }

  sendTo(remoteId: string, msg: DocsCollabMeshMessage): void {
    this.mesh.sendJsonTo(remoteId, msg);
  }

  async join(name: string): Promise<{ peerId: string; peers: DocsCollabMeshPeer[] }> {
    this.myName = name.trim();
    const joined = await this.mesh.join({ name: this.myName });
    return { peerId: joined.peerId, peers: joined.peers };
  }

  async leave(): Promise<void> {
    await this.mesh.leave();
    this.myName = "";
  }
}
