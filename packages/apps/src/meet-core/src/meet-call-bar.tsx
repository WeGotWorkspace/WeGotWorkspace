import { Maximize2, Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import { meetCallLiveIcon } from "@/meet-core/src/meet-call-live-icon";
import type { MeetCallInvite } from "@/meet-core/src/meet-call-stage-layout";
import type { MeetCallKnocker } from "@/meet-core/src/meet-call-knock";
import { MeetDevicePopover } from "@/meet-core/src/meet-device-popover";
import type { MeetDeviceOption } from "@/meet-core/src/meet-device-utils";
import { MeetKnockBadge } from "@/meet-core/src/meet-knock-badge";
import {
  meetCallBarMeta,
  meetCallBarRoster,
  meetCallBarShownCount,
} from "@/meet-core/src/meet-call-bar-roster";
import { meetLabels } from "@/meet-core/src/meet-labels";
import { MeetPeerTile } from "@/meet-core/src/meet-peer-tile";
import { UserAvatar, avatarColorForUserId } from "@/user-avatar/src/user-avatar";
import { cn } from "@/lib/utils";

export type MeetCallBarPeer = {
  id: string;
  name: string;
  stream?: MediaStream | null;
  remoteMedia?: { camera: boolean; mic: boolean } | null;
  disclosedMedia?: { camera: boolean; mic: boolean; screen?: boolean } | null;
};

export type MeetCallBarProps = {
  elapsedLabel: string;
  selfId: string;
  selfName: string;
  selfStream?: MediaStream | null;
  peers: MeetCallBarPeer[];
  participantCount: number;
  micOn: boolean;
  videoOn: boolean;
  cameras: MeetDeviceOption[];
  microphones: MeetDeviceOption[];
  speakers: MeetDeviceOption[];
  activeCamera: string;
  activeMic: string;
  activeSpeaker: string;
  onToggleMic: () => void;
  onToggleVideo: () => void;
  onCameraChange: (optionId: string) => void;
  onMicrophoneChange: (optionId: string) => void;
  onSpeakerChange: (optionId: string) => void;
  onExpand: () => void;
  onLeave: () => void;
  /** Host/moderator: force-mute a remote peer. Omitted for guests. */
  onMuteParticipant?: (peerId: string) => void;
  /** IconButton cluster + camera tiles — only after this user joins. */
  joined?: boolean;
  /** Join on the bar while a meeting is live and this user has not joined. Start never lives here. */
  invite?: MeetCallInvite | null;
  onInvite?: () => void;
  /** Meeting was started as Meet (Audio Only) — mark and Join use audio chrome. */
  audioOnly?: boolean;
  /** Host: waiting knockers. Shown as an action-row icon (production MeetKnockBadge). */
  knockers?: readonly MeetCallKnocker[];
  onAdmitKnocker?: (peerId: string) => void;
  onDenyKnocker?: (peerId: string) => void;
  className?: string;
};

export {
  meetCallBarMeta,
  meetCallBarRoster,
  meetCallBarShownCount,
  meetCallPreviewPeers,
} from "@/meet-core/src/meet-call-bar-roster";

export function MeetCallBar({
  elapsedLabel,
  selfId,
  selfName,
  selfStream = null,
  peers,
  participantCount,
  micOn,
  videoOn,
  cameras,
  microphones,
  speakers,
  activeCamera,
  activeMic,
  activeSpeaker,
  onToggleMic,
  onToggleVideo,
  onCameraChange,
  onMicrophoneChange,
  onSpeakerChange,
  onExpand,
  onLeave,
  onMuteParticipant,
  joined = false,
  invite = null,
  onInvite,
  audioOnly = false,
  knockers = [],
  onAdmitKnocker,
  onDenyKnocker,
  className,
}: MeetCallBarProps) {
  const LiveIcon = meetCallLiveIcon(audioOnly);
  const roster = meetCallBarRoster({
    joined,
    self: { id: selfId, name: selfName, stream: selfStream },
    peers,
  });
  const meta = meetCallBarMeta(
    meetCallBarShownCount({ joined, participantCount, peerCount: peers.length }),
    joined ? elapsedLabel : undefined,
  );

  return (
    <div className={cn("meet-call-bar", className)}>
      <div className="meet-call-bar__row">
        <div className="meet-call-bar__start">
          <span className="meet-call-bar__mark" aria-hidden>
            <LiveIcon className="meet-workspace__header-kind-icon" />
          </span>
          <div className="meet-call-bar__copy">
            <p className="meet-call-bar__title">{meetLabels.meetingStarted}</p>
            {meta ? <p className="meet-call-bar__meta">{meta}</p> : null}
          </div>
          <ul className="meet-call-bar__avatars">
            {roster.map((person) => (
              <li key={person.id}>
                <UserAvatar
                  displayName={person.name}
                  compact
                  size="sm"
                  color={avatarColorForUserId(person.id)}
                />
              </li>
            ))}
          </ul>
        </div>
        {invite === "join" && onInvite ? (
          <div className="meet-call-bar__invite">
            <Button
              className="meet-call-bar__invite-button"
              label={meetLabels.join}
              icon={<LiveIcon />}
              size="sm"
              variant="subtle"
              onClick={onInvite}
            />
          </div>
        ) : null}
        {joined ? (
          <div className="meet-call-bar__actions">
            <IconButton
              label={micOn ? meetLabels.disableAudio : meetLabels.enableAudio}
              icon={micOn ? <Mic /> : <MicOff />}
              size="sm"
              variant="subtle"
              active={micOn}
              aria-pressed={micOn}
              onClick={onToggleMic}
            />
            <IconButton
              label={videoOn ? meetLabels.disableVideo : meetLabels.enableVideo}
              icon={videoOn ? <Video /> : <VideoOff />}
              size="sm"
              variant="subtle"
              active={videoOn}
              aria-pressed={videoOn}
              onClick={onToggleVideo}
            />
            <MeetDevicePopover
              cameras={cameras}
              microphones={microphones}
              speakers={speakers}
              camera={activeCamera}
              microphone={activeMic}
              speaker={activeSpeaker}
              onCamera={onCameraChange}
              onMicrophone={onMicrophoneChange}
              onSpeaker={onSpeakerChange}
            />
            {onAdmitKnocker && onDenyKnocker ? (
              <MeetKnockBadge knockers={knockers} onAdmit={onAdmitKnocker} onDeny={onDenyKnocker} />
            ) : null}
            <IconButton
              label={meetLabels.expandCall}
              icon={<Maximize2 />}
              size="sm"
              variant="subtle"
              onClick={onExpand}
            />
            <div className="meet-call-bar__divider" aria-hidden />
            <IconButton
              label={meetLabels.leave}
              icon={<PhoneOff />}
              size="sm"
              variant="destructive"
              onClick={onLeave}
            />
          </div>
        ) : null}
      </div>
      {joined && videoOn ? (
        <div className="meet-call-bar__tiles">
          <MeetPeerTile
            name={meetLabels.youLabel}
            stream={selfStream}
            compact
            muted
            disclosedMedia={{ camera: videoOn, mic: micOn }}
            micOn={micOn}
            onToggleMic={onToggleMic}
          />
          {peers.map((peer) => (
            <MeetPeerTile
              key={peer.id}
              name={peer.name}
              stream={peer.stream ?? null}
              compact
              remoteMedia={peer.remoteMedia}
              disclosedMedia={peer.disclosedMedia}
              onMuteParticipant={onMuteParticipant ? () => onMuteParticipant(peer.id) : undefined}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
