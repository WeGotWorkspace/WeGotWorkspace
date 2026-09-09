import { useCallback, useEffect, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { useAppToast } from "@/hooks/use-app-toast";
import { UserAvatar, avatarColorForUserId } from "@/user-avatar/src/user-avatar";
import { shouldMirrorMeetStream } from "@/meet-core/src/meet-stream-mirror";
import { MeetStreamVideo } from "@/meet-core/src/meet-stream-video";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { usePeerStreamPresence } from "@/meet-core/src/use-peer-stream-presence";
import { cn } from "@/lib/utils";

type MeetPeerTileProps = {
  name: string;
  stream: MediaStream | null;
  compact?: boolean;
  spotlight?: boolean;
  speaking?: boolean;
  caption?: string;
  userId?: string;
  /** Inbound RTP heuristics; null = omit override. */
  remoteMedia?: { camera: boolean; mic: boolean } | null;
  /** Peer's announced mic/camera (control chat); when set, overrides track/stats for UI. */
  disclosedMedia?: { camera: boolean; mic: boolean; screen?: boolean } | null;
  /** Self tile: mirrors dock mic. When set with onToggleMic, mute toggles local mic. */
  micOn?: boolean;
  onToggleMic?: () => void;
  /**
   * Mute `<video>` playback. Defaults on for the self tile so local mic never
   * loops through speakers. Remote tiles stay unmuted (they carry remote audio).
   */
  muted?: boolean;
  /**
   * Host/moderator: set this remote peer muted (`true`) or unmuted (`false`).
   * Omitted for guests and self.
   */
  onMuteParticipant?: (muted: boolean) => void;
};

export function MeetPeerTile({
  name,
  stream,
  compact,
  spotlight,
  speaking,
  caption,
  userId,
  remoteMedia,
  disclosedMedia,
  micOn,
  onToggleMic,
  onMuteParticipant,
  muted,
}: MeetPeerTileProps) {
  const toast = useAppToast();
  const { cameraRendering, micLive } = usePeerStreamPresence(stream);
  const [remoteVideoOk, setRemoteVideoOk] = useState(true);

  const onPresentationViable = useCallback((viable: boolean) => {
    setRemoteVideoOk(viable);
  }, []);

  useEffect(() => {
    setRemoteVideoOk(true);
  }, [cameraRendering, disclosedMedia?.camera, stream]);

  const statsAllowCamera = remoteMedia?.camera !== false;
  const statsAllowMic = remoteMedia?.mic !== false;
  const cameraFromTracks = cameraRendering && statsAllowCamera;
  const micFromTracks = micLive && statsAllowMic;

  // A screen share replaces the peer's video track — render it even when the
  // camera toggle is announced as off.
  const showRemoteVideo = !!(
    stream && (disclosedMedia ? disclosedMedia.camera || disclosedMedia.screen : cameraFromTracks)
  );
  const isSelfMute = typeof onToggleMic === "function";
  const micLiveUi = isSelfMute
    ? Boolean(micOn)
    : disclosedMedia
      ? disclosedMedia.mic
      : micFromTracks;
  const showAvatarFill = !showRemoteVideo || !remoteVideoOk;
  const mirrored = shouldMirrorMeetStream(stream, disclosedMedia?.screen);
  const playbackStream = stream && stream.getTracks().length > 0 ? stream : null;
  const avatarSize = spotlight ? "xl" : compact ? "md" : "lg";
  const playbackMuted = muted ?? isSelfMute;
  const canForceMute = !isSelfMute && typeof onMuteParticipant === "function";
  const canToggleMute = isSelfMute || canForceMute;
  const muteLabel = isSelfMute
    ? micLiveUi
      ? meetLabels.mute
      : meetLabels.unmute
    : micLiveUi
      ? meetLabels.muteParticipant
      : meetLabels.unmuteParticipant;
  const onMuteClick = () => {
    if (isSelfMute) {
      onToggleMic();
      toast.show(micLiveUi ? meetLabels.microphoneMuted : meetLabels.microphoneUnmuted, {
        severity: "info",
      });
      return;
    }
    onMuteParticipant?.(micLiveUi);
  };
  const avatar = (
    <UserAvatar
      displayName={name}
      compact
      size={avatarSize}
      color={userId ? avatarColorForUserId(userId) : undefined}
    />
  );
  const identity =
    spotlight || caption ? (
      <div className="meet-peer-tile__identity">
        {spotlight ? <p className="meet-peer-tile__display-name">{name}</p> : null}
        {speaking ? (
          <p className="meet-peer-tile__speaking">
            <span className="meet-peer-tile__speaking-dot" aria-hidden />
            {meetLabels.speaking}
          </p>
        ) : null}
        {caption ? <p className="meet-peer-tile__caption">{caption}</p> : null}
      </div>
    ) : null;
  const nameBadge = (
    <>
      {micLiveUi ? <Mic className="size-3" /> : <MicOff className="size-3 text-red-400" />}
      <span>{name}</span>
    </>
  );
  const nameClassName = cn("meet-peer-tile__name", !micLiveUi && "meet-peer-tile__name--mic-muted");

  return (
    <div
      className={cn(
        "meet-peer-tile",
        compact && "meet-peer-tile--compact",
        spotlight && "meet-peer-tile--spotlight",
        speaking && "meet-peer-tile--speaking",
      )}
    >
      {playbackStream ? (
        <div className={cn("meet-peer-tile__media", !showRemoteVideo && "sr-only")}>
          <MeetStreamVideo
            stream={playbackStream}
            mirrored={mirrored}
            muted={playbackMuted}
            onPresentationViable={showRemoteVideo ? onPresentationViable : undefined}
            className={cn(
              "meet-peer-tile__stream h-full w-full",
              !showRemoteVideo && "pointer-events-none absolute h-px w-px opacity-0",
              showRemoteVideo && !remoteVideoOk && "meet-peer-tile__stream--hidden",
            )}
          />
          {showRemoteVideo && showAvatarFill ? (
            <div className="meet-peer-tile__fill">
              {avatar}
              {identity}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="meet-peer-tile__fill">
          {avatar}
          {identity}
        </div>
      )}
      {canToggleMute ? (
        <button
          type="button"
          className={nameClassName}
          aria-label={muteLabel}
          aria-pressed={!micLiveUi}
          title={muteLabel}
          onClick={onMuteClick}
        >
          {nameBadge}
        </button>
      ) : (
        <div className={nameClassName}>{nameBadge}</div>
      )}
    </div>
  );
}
