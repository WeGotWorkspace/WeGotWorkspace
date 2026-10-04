import type { RtcSessionBinding } from "@/lib/rtc/session/bindings";
import { peerAdvertisesBin } from "@/lib/rtc/session/data-channel-frames";
import { DataChannelOutbound } from "@/lib/rtc/session/data-channel-outbound";
import type { IceMode, RtcLinkState } from "@/lib/rtc/types";

export type MeshPeerEntry = {
  name: string;
  pc: RTCPeerConnection;
  mode: IceMode;
  relayFallbackTried: boolean;
  initiator: boolean;
  pendingIce: RTCIceCandidateInit[];
  signalSent: boolean;
  remoteStream?: MediaStream;
  dataChannel?: RTCDataChannel | null;
  /** Roster capabilities. `bin` selects binary framing on the data channel. */
  caps?: readonly string[];
};

/**
 * The live peer entries of one mesh: an `RTCPeerConnection` per remote id with
 * its data channel or remote stream, the link state derived from the active
 * binding, and teardown. Deciding who to dial stays with the mesh.
 */
export class MeshPeerRegistry {
  private readonly entries = new Map<string, MeshPeerEntry>();

  private readonly outbound = new Map<string, DataChannelOutbound>();

  constructor(
    private readonly binding: RtcSessionBinding | undefined,
    private readonly onSendFailed?: (remoteId: string, error: unknown) => void,
  ) {}

  get size(): number {
    return this.entries.size;
  }

  get(remoteId: string): MeshPeerEntry | undefined {
    return this.entries.get(remoteId);
  }

  has(remoteId: string): boolean {
    return this.entries.has(remoteId);
  }

  add(remoteId: string, entry: MeshPeerEntry): void {
    this.entries.set(remoteId, entry);
  }

  /** Snapshot of the ids, safe to iterate while closing peers. */
  ids(): string[] {
    return [...this.entries.keys()];
  }

  values(): MeshPeerEntry[] {
    return [...this.entries.values()];
  }

  /** Close and forget a peer. Returns its display name, or null when unknown. */
  close(remoteId: string): string | null {
    const entry = this.entries.get(remoteId);
    if (!entry) return null;
    entry.dataChannel?.close();
    entry.pc.close();
    this.entries.delete(remoteId);
    this.outbound.delete(remoteId);
    return entry.name;
  }

  peerConnection(remoteId: string): RTCPeerConnection | null {
    return this.entries.get(remoteId)?.pc ?? null;
  }

  dataChannel(remoteId: string): RTCDataChannel | null {
    return this.entries.get(remoteId)?.dataChannel ?? null;
  }

  remoteStream(remoteId: string): MediaStream | null {
    return this.entries.get(remoteId)?.remoteStream ?? null;
  }

  linkState(entry: MeshPeerEntry): RtcLinkState {
    if (this.binding?.kind === "data") {
      return this.binding.linkState(entry.dataChannel ?? null, entry.pc);
    }
    const state = entry.pc.connectionState;
    if (state === "connected") return "connected";
    if (state === "connecting" || state === "new") return "connecting";
    if (state === "failed") return "failed";
    if (state === "disconnected") return "disconnected";
    return "closed";
  }

  linkStateOf(remoteId: string): RtcLinkState | null {
    const entry = this.entries.get(remoteId);
    return entry ? this.linkState(entry) : null;
  }

  /** Open data channels for a data binding, connected peer connections otherwise. */
  linkCount(): number {
    if (this.binding?.kind === "data") {
      let count = 0;
      for (const entry of this.entries.values()) {
        if (entry.dataChannel?.readyState === "open") count += 1;
      }
      return count;
    }
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.pc.connectionState === "connected") count += 1;
    }
    return count;
  }

  rememberCaps(remoteId: string, caps: readonly string[] | undefined): void {
    const entry = this.entries.get(remoteId);
    if (!entry) return;
    entry.caps = caps;
  }

  broadcastJson(message: unknown): void {
    for (const remoteId of this.entries.keys()) this.sendJsonTo(remoteId, message);
  }

  sendJsonTo(remoteId: string, message: unknown): void {
    const entry = this.entries.get(remoteId);
    const channel = entry?.dataChannel;
    if (!channel || channel.readyState !== "open") return;
    this.sender(remoteId, channel).sendJson(message, peerAdvertisesBin(entry.caps));
  }

  private sender(remoteId: string, channel: RTCDataChannel): DataChannelOutbound {
    const existing = this.outbound.get(remoteId);
    if (existing?.owns(channel)) return existing;
    const created = new DataChannelOutbound(channel, (error) => this.failSend(remoteId, error));
    this.outbound.set(remoteId, created);
    return created;
  }

  private failSend(remoteId: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[rtc] datachannel-send-failed", { remoteId, message });
    this.onSendFailed?.(remoteId, error);
  }

  /** Replace the outbound track of every sender of `kind` that already has one. */
  async replaceSenderTrack(kind: "audio" | "video", track: MediaStreamTrack): Promise<void> {
    const updates: Promise<void>[] = [];
    for (const entry of this.entries.values()) {
      const sender = entry.pc.getSenders().find((s) => s.track?.kind === kind);
      if (!sender) continue;
      updates.push(sender.replaceTrack(track));
    }
    await Promise.all(updates);
  }
}
