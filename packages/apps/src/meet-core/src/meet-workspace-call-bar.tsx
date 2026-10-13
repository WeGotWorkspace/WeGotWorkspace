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

export type MeetWorkspaceCallBarProps = {
  visible: boolean;
  /** This user is in the call: the roster includes them and shows elapsed time. */
  joined: boolean;
  room?: MeetCallStageRoomProps | null;
  channelTitle: string;
  session: WorkspaceSession;
  /** Mesh `call-active` senders for this conversation — preview roster before joining. */
  previewPeerIds: readonly string[];
  directory?: readonly CollectionSharePrincipal[];
  invite?: MeetCallInvite | null;
  audioOnly: boolean;
  onLeave: () => void;
  onInvite: (options?: { video?: boolean }) => void;
};

/**
 * Pre-join bar above the channel chat. While this user is waiting to be let
 * in, the bar is the knock-wait banner. Device controls and host admit live
 * on the expanded stage.
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
      joined={joined}
      invite={invite}
      audioOnly={audioOnly}
      onInvite={() => onInvite(meetCallInviteStartOptions(audioOnly))}
    />
  );
}
