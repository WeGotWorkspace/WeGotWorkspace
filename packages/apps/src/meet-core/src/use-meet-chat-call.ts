import { useCallback, useMemo, useRef, useState } from "react";
import { useAppToast } from "@/hooks/use-app-toast";
import type { WorkspaceSession } from "@/lib/workspace/workspace-session";
import type { MeetCallStageRoomProps } from "@/meet-core/src/meet-call-stage";
import { meetChannelIdForRoom, meetChannelRoomId } from "@/meet-core/src/meet-channel-room";
import { isMeetDirectMessageChannelId } from "@/meet-core/src/meet-direct-messages";
import {
  MEET_AD_HOC_RESERVATION_TTL_MS,
  meetActorPrincipal,
} from "@/meet-core/src/meet-invite-status";
import { meetLabels } from "@/meet-core/src/meet-labels";
import {
  meetSpeakerOptionsFromAudioInputs,
  normalizeMeetDeviceOptions,
  selectedMeetDeviceOptionId,
} from "@/meet-core/src/meet-device-utils";
import type {
  MeetAPIOperations,
  MeetChannel,
  MeetChatOperations,
  MeetUIData,
} from "@/meet-core/src/meet-types";
import { useMeetController } from "@/meet-core/src/use-meet-controller";

export type UseMeetChatCallArgs = {
  session: WorkspaceSession;
  data: MeetUIData;
  /** False while the live bootstrap loads (identity props are placeholders). */
  identityReady: boolean;
  channels: readonly MeetChannel[];
  /** Meet signaling REST surface (rooms/reservations). */
  meetOperations: MeetAPIOperations;
  /** Chunk-E chat operations (hybrid Dexie + REST); wrapped with call verbs. */
  chatOperations?: MeetChatOperations;
};

/**
 * Live call slice for `MeetWorkspace`: the real Meet controller (`useMeetRtc`,
 * suite call store via `MeetCallProvider`) exposed as the `callStageRoom` the
 * stage expects, plus `MeetChatOperations.startCall`/`leaveCall` implementations
 * on the deterministic channel-room convention (`meetChannelRoomId`).
 */
export function useMeetChatCall({
  session,
  data,
  identityReady,
  channels,
  meetOperations,
  chatOperations,
}: UseMeetChatCallArgs) {
  const toast = useAppToast();
  const controller = useMeetController({
    session,
    defaultDisplayName: data.defaultDisplayName,
    identityReady,
    rtc: data.rtc,
    operations: meetOperations,
  });

  // Refs keep the operation callbacks stable across controller re-renders.
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const channelsRef = useRef(channels);
  channelsRef.current = channels;
  const meetOperationsRef = useRef(meetOperations);
  meetOperationsRef.current = meetOperations;
  const usernameRef = useRef(session.user.username ?? null);
  usernameRef.current = session.user.username ?? null;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  /** Best-effort reservation so the room shows up in status polls with an owner. */
  const reserveChannelRoom = useCallback(async (room: string) => {
    const reserve = meetOperationsRef.current.reserveRoom;
    const username = usernameRef.current?.trim();
    if (!reserve || !username) return;
    try {
      const status = await meetOperationsRef.current.roomStatus({ room });
      if (status.reserved || status.active) return;
      await reserve({
        room,
        ownerPrincipal: meetActorPrincipal(username),
        expiresAt: new Date(Date.now() + MEET_AD_HOC_RESERVATION_TTL_MS).toISOString(),
      });
    } catch {
      // Reservation is best-effort (e.g. a concurrent starter won the race);
      // the join below decides whether the call actually works.
    }
  }, []);

  const startCall = useCallback(
    async (channelId: string) => {
      // DM calls need the chunk-G provisioned collections; guard until then.
      if (isMeetDirectMessageChannelId(channelId)) {
        toastRef.current.show(meetLabels.dmCallUnavailable, { severity: "info" });
        return;
      }
      const channel = channelsRef.current.find((row) => row.id === channelId);
      const room = meetChannelRoomId(channel ?? { id: channelId, kind: "channel" });
      await reserveChannelRoom(room);
      try {
        await controllerRef.current.joinRoom(room);
      } catch (error) {
        // The layout sync collapses the channel chrome (session never reached
        // "in-call"); surface why here.
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : meetLabels.couldNotStartCall;
        toastRef.current.showError(message);
      }
    },
    [reserveChannelRoom],
  );

  const leaveCall = useCallback(async () => {
    await controllerRef.current.leave();
  }, []);

  const operations = useMemo<MeetChatOperations | undefined>(() => {
    if (!chatOperations) return undefined;
    const sendMessage = chatOperations.sendMessage;
    return {
      ...chatOperations,
      // DM sends need chunk-G auto-provisioned collections; fail with a clear
      // message instead of a REST 404 (surfaced by the workspace toast).
      sendMessage: sendMessage
        ? (channelId, body, opts) => {
            if (isMeetDirectMessageChannelId(channelId)) {
              return Promise.reject(new Error(meetLabels.dmSendUnavailable));
            }
            return sendMessage(channelId, body, opts);
          }
        : undefined,
      startCall,
      leaveCall: () => leaveCall(),
    };
  }, [chatOperations, leaveCall, startCall]);

  // Device chrome for the stage/toolbar (mirrors the retired lobby shell).
  const [speakerId, setSpeakerId] = useState("default");
  const cameras = useMemo(
    () => normalizeMeetDeviceOptions("videoinput", controller.videoInputs),
    [controller.videoInputs],
  );
  const microphones = useMemo(
    () => normalizeMeetDeviceOptions("audioinput", controller.audioInputs),
    [controller.audioInputs],
  );
  const speakers = useMemo(
    () => meetSpeakerOptionsFromAudioInputs(controller.audioInputs),
    [controller.audioInputs],
  );

  const onCopyLink = useCallback(() => {
    const link = controllerRef.current.callLink;
    if (!link) return;
    void navigator.clipboard?.writeText(link);
    toastRef.current.showSuccess(meetLabels.linkCopied);
  }, []);

  const callStageRoom: MeetCallStageRoomProps = {
    controller,
    displayName: controller.displayName || session.user.displayName || "Guest",
    hasSignedInIdentity: true,
    participantCount: controller.peers.length + (controller.inCall ? 1 : 0),
    // Channel calls are shared spaces: leaving never ends the call for others.
    callExitLabel: meetLabels.leaveCall,
    callExitTitle: meetLabels.leaveCallTitle,
    callExitDescription: meetLabels.leaveCallDescription,
    cameras,
    microphones,
    speakers,
    activeCamera: selectedMeetDeviceOptionId(cameras, controller.selectedCamId),
    activeMic: selectedMeetDeviceOptionId(microphones, controller.selectedMicId),
    activeSpeaker: speakerId || speakers[0]?.id || "default",
    onSpeakerChange: setSpeakerId,
    onCopyLink,
    onMuteSoon: (name: string) => toast.show(meetLabels.muteSoon(name), { severity: "info" }),
    onToastInfo: (message: string) => toast.show(message, { severity: "info" }),
    onToastError: (message: string) => toast.showError(message),
  };

  const sessionEngaged =
    controller.status === "in-call" ||
    controller.status === "preparing" ||
    controller.status === "waiting";
  const joinedRoomCode = sessionEngaged ? controller.roomCode : null;
  const liveCallChannelId = useMemo(
    () => meetChannelIdForRoom(channels, joinedRoomCode),
    [channels, joinedRoomCode],
  );

  return {
    operations,
    callStageRoom,
    liveCallChannelId,
    joinedRoomCode,
  };
}
