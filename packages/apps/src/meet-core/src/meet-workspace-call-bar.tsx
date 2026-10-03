import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { CollectionSharePrincipal } from "@/share-ui/collection-share";
import { MeetCallBar } from "@/meet-core/src/meet-call-bar";
import { meetCallBarShownCount, meetCallPreviewPeers } from "@/meet-core/src/meet-call-bar-roster";
import { MeetCallKnockWaiting } from "@/meet-core/src/meet-call-knock";
import type { MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";
import {
  meetCallInviteStartOptions,
  type MeetCallInvite,
} from "@/meet-core/src/meet-call-stage-layout";
import { meetDeviceIdForOption } from "@/meet-core/src/meet-device-utils";

export type MeetWorkspaceCallBarProps = {
  visible: boolean;
  /** This user is in the call: live roster, device controls and the leave button. */
  joined: boolean;
  room?: MeetCallStageRoomProps | null;
  channelTitle: string;
  session: WorkspaceSession;
  /** Mesh `call-active` senders for this conversation — preview roster before joining. */
  previewPeerIds: readonly string[];
  directory?: readonly CollectionSharePrincipal[];
  invite?: MeetCallInvite | null;
  audioOnly: boolean;
  onExpand: () => void;
  onLeave: () => void;
  onInvite: (options?: { video?: boolean }) => void;
};

/**
 * Compact call chrome above the channel chat. Chunk-I knock chrome (chunk-H
 * join policy): the bar swaps to a knock-wait banner while this user waits to
 * be let in; joined members admit waiting guests from the action row.
 */
export function MeetWorkspaceCallBar({
  visible,
  joined,
  room,
  channelTitle,
  session,
  previewPeerIds,
  directory,
  invite,
  audioOnly,
  onExpand,
  onLeave,
  onInvite,
}: MeetWorkspaceCallBarProps) {
  if (!visible) return null;
  if (room?.controller.waitingForAdmission) {
    return <MeetCallKnockWaiting channelTitle={channelTitle} onCancel={onLeave} />;
  }
  return (
    <MeetCallBar
      elapsedLabel={joined ? (room?.controller.elapsedLabel ?? "") : ""}
      selfId={
        joined
          ? (room?.controller.selfId ?? session.user.username ?? "self")
          : (session.user.username ?? "self")
      }
      selfName={joined ? (room?.displayName ?? session.user.displayName) : session.user.displayName}
      selfStream={joined ? (room?.controller.getLocalStream() ?? null) : null}
      peers={
        joined ? (room?.controller.peers ?? []) : meetCallPreviewPeers(previewPeerIds, directory)
      }
      participantCount={meetCallBarShownCount({
        joined,
        participantCount: joined ? (room?.participantCount ?? 0) : 0,
        peerCount: previewPeerIds.length,
      })}
      micOn={room?.controller.micOn ?? true}
      videoOn={room?.controller.videoOn ?? false}
      cameras={room?.cameras ?? []}
      microphones={room?.microphones ?? []}
      speakers={room?.speakers ?? []}
      activeCamera={room?.activeCamera ?? ""}
      activeMic={room?.activeMic ?? ""}
      activeSpeaker={room?.activeSpeaker ?? ""}
      onToggleMic={room?.controller.toggleMic ?? (() => {})}
      onToggleVideo={room?.controller.toggleVideo ?? (() => {})}
      onCameraChange={(id) => {
        const deviceId = meetDeviceIdForOption(room?.cameras ?? [], id);
        if (!deviceId) return;
        void room?.controller.switchCamera(deviceId);
      }}
      onMicrophoneChange={(id) => {
        const deviceId = meetDeviceIdForOption(room?.microphones ?? [], id);
        if (!deviceId) return;
        void room?.controller.switchMic(deviceId);
      }}
      onSpeakerChange={room?.onSpeakerChange ?? (() => {})}
      onExpand={onExpand}
      onLeave={onLeave}
      onMuteParticipant={
        room?.hasSignedInIdentity
          ? (peerId, muted) => void room.controller.mutePeer(peerId, muted)
          : undefined
      }
      joined={joined}
      invite={invite}
      audioOnly={audioOnly}
      onInvite={() => onInvite(meetCallInviteStartOptions(audioOnly))}
      knockers={joined && room?.hasSignedInIdentity ? room.controller.knockers : []}
      onAdmitKnocker={
        joined && room ? (peerId) => void room.controller.admitKnocker(peerId) : undefined
      }
      onDenyKnocker={
        joined && room ? (peerId) => void room.controller.denyKnocker(peerId) : undefined
      }
    />
  );
}
