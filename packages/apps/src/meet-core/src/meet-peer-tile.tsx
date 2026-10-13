import { useCallback, useEffect, useState } from "react";
import { Mic, MicOff, Pin } from "lucide-react";
import { IconButton } from "@/button/src/button";
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
  /**
   * Local pin. When omitted, the tile keeps its own state for Storybook.
   * A live call passes `pinned` from the parent, which is what makes pin exclusive.
   */
  pinned?: boolean;
  onTogglePin?: (pinned: boolean) => void;
  /**
   * Low-data receive cap. The stream stays mounted so audio continues; the
   * picture is replaced by the avatar.
   */
  hideVideo?: boolean;
  /**
   * Skip the media element. A pinned peer's filmstrip copy still reads
   * `stream` for the mic indicator; the featured tile owns playback.
   */
  omitPlayback?: boolean;
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
  pinned: pinnedProp,
  onTogglePin,
  muted,
  hideVideo = false,
  omitPlayback = false,
}: MeetPeerTileProps) {
  const toast = useAppToast();
  const [uncontrolledPinned, setUncontrolledPinned] = useState(false);
  const pinned = pinnedProp ?? uncontrolledPinned;
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
  const showRemoteVideo =
    !hideVideo &&
    !!(
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
  const avatarSize = spotlight ? "lg" : compact ? "sm" : "md";
  const playbackMuted = muted ?? isSelfMute;
  const canForceMute = !isSelfMute && typeof onMuteParticipant === "function";
  const canToggleMute = isSelfMute || canForceMute;
  const muteLabel = micLiveUi ? meetLabels.mutePeer(name) : meetLabels.unmutePeer(name);
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
  const onPinClick = () => {
    const next = !pinned;
    if (pinnedProp === undefined) setUncontrolledPinned(next);
    onTogglePin?.(next);
  };
  const avatar = (
    <UserAvatar
      displayName={name}
      compact
      size={avatarSize}
      color={userId ? avatarColorForUserId(userId) : undefined}
    />
  );
  const identity = caption ? (
    <div className="meet-peer-tile__identity">
      <p className="meet-peer-tile__caption">{caption}</p>
    </div>
  ) : null;

  return (
    <div
      className={cn(
        "meet-peer-tile",
        compact && "meet-peer-tile--compact",
        spotlight && "meet-peer-tile--spotlight",
        speaking && "meet-peer-tile--speaking",
      )}
    >
      {playbackStream && !omitPlayback ? (
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
        </div>
      ) : null}
      {showAvatarFill ? (
        <div className="meet-peer-tile__fill">
          {avatar}
          {identity}
        </div>
      ) : null}
      {speaking ? (
        <p className="meet-peer-tile__speaking">
          <span className="meet-peer-tile__speaking-dot" aria-hidden />
          {meetLabels.speaking}
        </p>
      ) : null}
      <p className="meet-peer-tile__name">{name}</p>
      {canToggleMute ? (
        <IconButton
          className={cn(
            "meet-peer-tile__control meet-peer-tile__mute",
            !micLiveUi && "meet-peer-tile__control--persistent",
          )}
          size="xs"
          variant="outline"
          icon={micLiveUi ? <Mic /> : <MicOff />}
          label={muteLabel}
          onClick={onMuteClick}
        />
      ) : (
        <span
          className={cn(
            "meet-peer-tile__control meet-peer-tile__mic-state",
            !micLiveUi && "meet-peer-tile__control--persistent",
          )}
          role="img"
          aria-label={micLiveUi ? meetLabels.micLive(name) : meetLabels.micMuted(name)}
        >
          {micLiveUi ? <Mic /> : <MicOff />}
        </span>
      )}
      <IconButton
        className={cn(
          "meet-peer-tile__control meet-peer-tile__pin",
          pinned && "meet-peer-tile__control--persistent",
        )}
        size="xs"
        variant="outline"
        active={pinned}
        icon={<Pin />}
        label={pinned ? meetLabels.unpinParticipant(name) : meetLabels.pinParticipant(name)}
        aria-pressed={pinned}
        onClick={onPinClick}
      />
    </div>
  );
}
