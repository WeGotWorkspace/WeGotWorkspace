import { createMediaBinding } from "@/lib/rtc/session/bindings";
import { createRtcSession } from "@/lib/rtc/session/create-rtc-session";
import type { RtcPeerMesh } from "@/lib/rtc/session/peer-mesh";
import { toSessionDescriptionPayload } from "@/lib/rtc/session/sdp";
import type { HttpSignalingFetch, HttpSignalingPollResult } from "@/lib/rtc/signaling/http-client";
import type { RtcPeerDescriptor, RtcSettings } from "@/lib/rtc/types";
import { announceMeetJoin } from "@/meet-core/src/meet-join-hint";
import { sanitizeRtcSdp } from "@/meet-core/src/meet-rtc-sdp";
import {
  applyMeetSendEncodings,
  cameraSendingDisabled,
  DEFAULT_ENCODING_PREFS,
  type MeetEncodingPrefs,
} from "@/meet-core/src/meet-send-encoding";
import {
  videoLimitsFromJoin,
  DEFAULT_VIDEO_LIMITS,
  type VideoLimits,
} from "@/meet-core/src/meet-video-sender";
import type { RelayRequestOutcome } from "@/lib/rtc/session/relay-request";

function formatMeetInboundDescription(
  payload: unknown,
  fallbackType: RTCSdpType,
): RTCSessionDescriptionInit | null {
  const raw = toSessionDescriptionPayload(payload, fallbackType);
  if (!raw || typeof raw.sdp !== "string") return raw;
  return { ...raw, sdp: sanitizeRtcSdp(raw.sdp) };
}

/** Leave local descriptions untouched — sanitizing outbound SDP strips SSRC lines and can break senders. */
function formatMeetOutboundDescription(
  description: RTCSessionDescriptionInit,
): RTCSessionDescriptionInit {
  return description;
}

export type MeetRtcSessionOptions = {
  rtcSettings: RtcSettings;
  apiBase?: string;
  fetchImpl?: HttpSignalingFetch;
  getLocalStream: () => MediaStream | null;
  onLinkChange?: () => void;
  onPollData?: (data: HttpSignalingPollResult) => void | Promise<void>;
  shouldConnectToPeer?: (peer: RtcPeerDescriptor) => boolean;
  shouldHandleRtcSignals?: () => boolean;
  /** Offer gate: a knocker or an id outside the roster is never answered. */
  shouldAcceptOffer?: (from: string) => boolean;
  onPeerRemoved?: (remoteId: string, name: string, reason: "bye" | "roster") => void;
  onConnectionFailed?: (remoteId: string, name: string) => void;
  onPollError?: (error: unknown) => void;
  onPeerConnected?: (remoteId: string) => void;
  onRelayOutcome?: (remoteId: string, name: string, outcome: RelayRequestOutcome) => void;
  /** Join delivered `rtc.limits`. `audio` has already disabled camera sending. */
  onVideoLimits?: (limits: VideoLimits) => void;
};

export class MeetRtcSession {
  private mesh: RtcPeerMesh | null = null;

  private limits: VideoLimits | null = null;

  private encoding: MeetEncodingPrefs = { ...DEFAULT_ENCODING_PREFS };

  private encodingRunning = false;

  private encodingDirty = false;

  constructor(private readonly options: MeetRtcSessionOptions) {}

  private createMesh(room: string): RtcPeerMesh {
    const binding = createMediaBinding({
      getLocalStream: this.options.getLocalStream,
      onRemoteStream: () => this.options.onLinkChange?.(),
    });

    return createRtcSession({
      channel: "meet",
      room,
      rtcSettings: this.options.rtcSettings,
      binding,
      signaling: {
        apiBase: this.options.apiBase,
        fetchImpl: this.options.fetchImpl,
      },
      formatInboundDescription: formatMeetInboundDescription,
      formatOutboundDescription: formatMeetOutboundDescription,
      shouldConnectToPeer: this.options.shouldConnectToPeer,
      shouldHandleRtcSignals: this.options.shouldHandleRtcSignals,
      shouldAcceptOffer: this.options.shouldAcceptOffer,
      onPollData: this.options.onPollData,
      onPeerRemoved: this.options.onPeerRemoved,
      onConnectionFailed: this.options.onConnectionFailed,
      onPollError: this.options.onPollError,
      onPeerConnected: (remoteId) => {
        this.scheduleEncodingRefresh();
        this.options.onPeerConnected?.(remoteId);
      },
      onRelayOutcome: this.options.onRelayOutcome,
      onLinkChange: () => {
        if (this.iceSettled()) this.scheduleEncodingRefresh();
        this.options.onLinkChange?.();
      },
    });
  }

  /** True when a selected pair can be read. Re-checked after every ICE restart. */
  private iceSettled(): boolean {
    return this.peerConnections().some((pc) => {
      const ice = pc.iceConnectionState;
      return ice === "connected" || ice === "completed";
    });
  }

  private peerConnections(): RTCPeerConnection[] {
    const mesh = this.mesh;
    if (!mesh) return [];
    return mesh.getPeerIds().flatMap((id) => {
      const pc = mesh.getPeerConnection(id);
      return pc ? [pc] : [];
    });
  }

  private remotePeerCount(): number {
    const mesh = this.mesh;
    if (!mesh) return 0;
    const selfId = mesh.getMyId();
    return mesh.getPeerIds().filter((id) => id !== selfId).length;
  }

  private disableLocalCameraIfRequired(): void {
    if (!cameraSendingDisabled(this.limits)) return;
    const screenId = this.encoding.screenTrackId;
    for (const track of this.options.getLocalStream()?.getVideoTracks() ?? []) {
      if (screenId && track.id === screenId) continue;
      track.enabled = false;
    }
  }

  /**
   * Coalesce overlapping stats reads. `setParameters` does not renegotiate,
   * so a low-data or relay change never creates an offer.
   */
  scheduleEncodingRefresh(): void {
    this.encodingDirty = true;
    if (this.encodingRunning) return;
    this.encodingRunning = true;
    void this.drainEncodingRefresh();
  }

  private async drainEncodingRefresh(): Promise<void> {
    try {
      while (this.encodingDirty) {
        this.encodingDirty = false;
        const connections = this.peerConnections();
        if (connections.length === 0) continue;
        try {
          await applyMeetSendEncodings(
            connections,
            this.remotePeerCount(),
            this.limits ?? DEFAULT_VIDEO_LIMITS,
            this.encoding,
          );
        } catch {
          // A sender that is not ready yet is applied again on the next connect.
        }
      }
    } finally {
      this.encodingRunning = false;
      if (this.encodingDirty) this.scheduleEncodingRefresh();
    }
  }

  setEncodingPrefs(partial: Partial<MeetEncodingPrefs>): void {
    this.encoding = { ...this.encoding, ...partial };
    this.disableLocalCameraIfRequired();
    this.scheduleEncodingRefresh();
  }

  isCameraSendingDisabled(): boolean {
    return cameraSendingDisabled(this.limits);
  }

  getMesh(): RtcPeerMesh | null {
    return this.mesh;
  }

  getMyId(): string | null {
    return this.mesh?.getMyId() ?? null;
  }

  getSessionKey(): string | null {
    return this.mesh?.getSessionKey() ?? null;
  }

  getPeerConnection(remoteId: string): RTCPeerConnection | null {
    return this.mesh?.getPeerConnection(remoteId) ?? null;
  }

  getRemoteStream(remoteId: string): MediaStream | null {
    return this.mesh?.getRemoteStream(remoteId) ?? null;
  }

  getPeerIds(): string[] {
    return this.mesh?.getPeerIds() ?? [];
  }

  getLimits(): VideoLimits | null {
    return this.limits;
  }

  kickPoll(): void {
    this.mesh?.kickPoll();
  }

  async join(input: { room: string; peerId: string; name: string }): Promise<{
    peerId: string;
    peers: RtcPeerDescriptor[];
    sessionKey?: string | null;
  }> {
    if (this.mesh) await this.leave();
    this.mesh = this.createMesh(input.room);
    const joined = await this.mesh.join({ name: input.name, peerId: input.peerId });
    this.limits = videoLimitsFromJoin(joined.limits);
    this.disableLocalCameraIfRequired();
    this.options.onVideoLimits?.(this.limits);
    this.scheduleEncodingRefresh();
    announceMeetJoin(input.room, joined.peers);
    return joined;
  }

  async updateJoinName(name: string): Promise<void> {
    await this.mesh?.updateJoinName(name);
  }

  retryRoomPeerConnections(): void {
    this.mesh?.retryRoomPeerConnections();
  }

  async replaceAudioTrack(track: MediaStreamTrack): Promise<void> {
    await this.mesh?.replaceAudioTrack(track);
  }

  async replaceVideoTrack(track: MediaStreamTrack): Promise<void> {
    await this.mesh?.replaceVideoTrack(track);
    this.scheduleEncodingRefresh();
  }

  async leave(opts?: { sendBye?: boolean }): Promise<void> {
    if (!this.mesh) return;
    if (opts?.sendBye !== false) {
      await this.mesh.sendByeToAll();
    }
    await this.mesh.leave();
    this.mesh = null;
  }
}
