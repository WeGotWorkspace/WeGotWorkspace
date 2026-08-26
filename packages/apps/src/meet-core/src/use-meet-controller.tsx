import { useRef } from "react";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { MeetAPIOperations, MeetRtcSettings } from "@/meet-core/src/meet-types";
import { useMeetCallSession } from "@/meet-core/src/use-meet-call-session";
import { meetCanModerateKnocks, useMeetMutations } from "@/meet-core/src/use-meet-mutations";
import { useMeetRoomState } from "@/meet-core/src/use-meet-room-state";

type UseMeetControllerArgs = {
  session: WorkspaceSession;
  defaultDisplayName: string;
  rtc: MeetRtcSettings;
  operations?: MeetAPIOperations;
  buildCallLink?: (roomCode: string) => string;
  onRoomChange?: (roomCode: string | null) => void;
};

/**
 * Meet workspace controller: composes room state, RTC/media session, and mutation slices.
 * UI shell state lives in useMeetWorkspaceShell (custom lobby/room layout).
 */
export function useMeetController({
  session,
  defaultDisplayName,
  rtc,
  operations,
  buildCallLink,
  onRoomChange,
}: UseMeetControllerArgs) {
  const leaveRef = useRef<null | ((opts?: { preserveEndedMessage?: boolean }) => Promise<void>)>(
    null,
  );

  const room = useMeetRoomState({
    defaultDisplayName,
    sessionDisplayName: session.user.displayName || "Guest",
    buildCallLink,
    onRoomChange,
  });
  const isGuestSession = !session.user.username?.trim() && !session.user.email?.trim();

  const callSession = useMeetCallSession({
    room,
    rtc,
    operations,
    isGuestSession,
    leaveRef,
  });
  const mutations = useMeetMutations({
    room,
    session: callSession,
    canModerateKnocks: meetCanModerateKnocks(session),
    actingUsername: session.user.username,
    leaveRef,
  });

  return {
    status: room.status,
    error: room.error,
    roomCode: room.roomCode,
    selfId: room.selfId,
    displayName: room.displayName,
    setDisplayName: room.setDisplayName,
    micOn: room.micOn,
    videoOn: room.videoOn,
    screenOn: room.screenOn,
    screenPreviewStream: callSession.screenPreviewStream,
    startedAt: room.startedAt,
    elapsedLabel: room.elapsedLabel,
    peers: room.peers,
    knockers: room.knockers,
    waitingForAdmission: room.waitingForAdmission,
    endedMessage: room.endedMessage,
    chatMessages: room.chatMessages,
    localVideoRef: callSession.localVideoRef,
    audioInputs: callSession.audioInputs,
    videoInputs: callSession.videoInputs,
    selectedMicId: callSession.selectedMicId,
    selectedCamId: callSession.selectedCamId,
    ensureLocalMedia: callSession.ensureLocalMedia,
    startMeeting: mutations.startMeeting,
    joinRoom: mutations.joinRoom,
    requestJoin: mutations.requestJoin,
    admitKnocker: mutations.admitKnocker,
    denyKnocker: mutations.denyKnocker,
    endCallForAll: mutations.endCallForAll,
    leave: mutations.leave,
    sendChat: mutations.sendChat,
    toggleMic: callSession.toggleMic,
    toggleVideo: callSession.toggleVideo,
    toggleScreenShare: callSession.toggleScreenShare,
    switchMic: callSession.switchMic,
    switchCamera: callSession.switchCamera,
    callLink: room.callLink,
    inCall: room.inCall,
  };
}
