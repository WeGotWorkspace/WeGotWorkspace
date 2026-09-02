import { Maximize2, Mic, MicOff, PhoneOff, Video, VideoOff } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import type { MeetCallInvite } from "@/meet-core/src/meet-call-stage-layout";
import { MeetDevicePopover } from "@/meet-core/src/meet-device-popover";
import type { MeetDeviceOption } from "@/meet-core/src/meet-device-utils";
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
  onMuteSoon: (name: string) => void;
  /** IconButton cluster + camera tiles — only after this user joins. */
  joined?: boolean;
  /** Start or Join on the bar while this user is not in the call. */
  invite?: MeetCallInvite | null;
  onInvite?: () => void;
  className?: string;
};

export function meetCallBarMeta(count: number, elapsed: string): string {
  return [meetLabels.inCallCount(count), elapsed].join(" · ");
}

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
  onMuteSoon,
  joined = false,
  invite = null,
  onInvite,
  className,
}: MeetCallBarProps) {
  const roster: MeetCallBarPeer[] = [{ id: selfId, name: selfName, stream: selfStream }, ...peers];
  const meetingLive = joined || invite === "join";

  return (
    <div className={cn("meet-call-bar", className)}>
      <div className="meet-call-bar__row">
        <div className="meet-call-bar__start">
          <span className="meet-call-bar__mark" aria-hidden>
            <Video className="meet-workspace__header-kind-icon" />
          </span>
          {meetingLive ? (
            <>
              <div className="meet-call-bar__copy">
                <p className="meet-call-bar__title">{meetLabels.meetingStarted}</p>
                <p className="meet-call-bar__meta">
                  {meetCallBarMeta(participantCount, elapsedLabel)}
                </p>
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
            </>
          ) : null}
        </div>
        {invite && onInvite ? (
          <div className="meet-call-bar__invite">
            <Button
              className="meet-call-bar__invite-button"
              label={invite === "join" ? meetLabels.join : meetLabels.start}
              icon={<Video />}
              size="sm"
              variant="subtle"
              onClick={onInvite}
            />
          </div>
        ) : null}
        {joined ? (
          <div className="meet-call-bar__actions">
            <IconButton
              label={micOn ? meetLabels.mute : meetLabels.unmute}
              icon={micOn ? <Mic /> : <MicOff />}
              size="sm"
              variant="subtle"
              active={micOn}
              aria-pressed={micOn}
              onClick={onToggleMic}
            />
            <IconButton
              label={videoOn ? meetLabels.stopVideo : meetLabels.startVideo}
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
            disclosedMedia={{ camera: videoOn, mic: micOn }}
            micOn={micOn}
            onToggleMic={onToggleMic}
            onMuteSoon={onMuteSoon}
          />
          {peers.map((peer) => (
            <MeetPeerTile
              key={peer.id}
              name={peer.name}
              stream={peer.stream ?? null}
              compact
              remoteMedia={peer.remoteMedia}
              disclosedMedia={peer.disclosedMedia}
              onMuteSoon={onMuteSoon}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
