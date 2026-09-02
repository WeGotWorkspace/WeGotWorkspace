import { useCallback, useEffect, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { IconButton } from "@/button/src/button";
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
  /** Peer tile: mute-for-me mock (toast / local only). */
  onMuteSoon: (name: string) => void;
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
  onMuteSoon,
}: MeetPeerTileProps) {
  const { cameraRendering, micLive } = usePeerStreamPresence(stream);
  const [remoteVideoOk, setRemoteVideoOk] = useState(true);
  const [mutedForMe, setMutedForMe] = useState(false);

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

  const showRemoteVideo = !!(stream && (disclosedMedia ? disclosedMedia.camera : cameraFromTracks));
  const micLiveUi = disclosedMedia ? disclosedMedia.mic : micFromTracks;
  const showAvatarFill = !showRemoteVideo || !remoteVideoOk;
  const mirrored = shouldMirrorMeetStream(stream, disclosedMedia?.screen);
  const playbackStream = stream && stream.getTracks().length > 0 ? stream : null;
  const avatarSize = spotlight ? "xl" : compact ? "md" : "lg";
  const isSelfMute = typeof onToggleMic === "function";
  const mutePressed = isSelfMute ? Boolean(micOn) : !mutedForMe;
  const muteLabel = isSelfMute
    ? micOn
      ? meetLabels.mute
      : meetLabels.unmute
    : mutedForMe
      ? meetLabels.unmute
      : meetLabels.muteParticipant;
  const onMuteClick = () => {
    if (isSelfMute) {
      onToggleMic();
      return;
    }
    setMutedForMe((value) => !value);
    onMuteSoon(name);
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
      <div className={cn("meet-peer-tile__name", !micLiveUi && "meet-peer-tile__name--mic-muted")}>
        {micLiveUi ? <Mic className="size-3" /> : <MicOff className="size-3 text-red-400" />}
        <span>{name}</span>
      </div>
      <IconButton
        icon={mutePressed ? <Mic /> : <MicOff />}
        label={muteLabel}
        size="sm"
        variant="subtle"
        active={mutePressed}
        aria-pressed={mutePressed}
        showTooltip={false}
        className="meet-peer-tile__mute"
        onClick={onMuteClick}
      />
    </div>
  );
}
