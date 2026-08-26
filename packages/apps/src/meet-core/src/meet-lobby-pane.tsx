import { useEffect, useState } from "react";
import { Hand, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { Button } from "@/button/src/button";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { MeetCircleToggle } from "@/meet-core/src/meet-circle-toggle";
import { MeetDeviceForm } from "@/meet-core/src/meet-device-form";
import type { MeetControllerState } from "@/meet-core/src/meet-controller-state";
import type { MeetDeviceOption } from "@/meet-core/src/meet-device-utils";
import { meetDeviceIdForOption } from "@/meet-core/src/meet-device-utils";
import { MeetLobbyStatusCard } from "@/meet-core/src/meet-lobby-status-card";
import { meetLabels } from "@/meet-core/src/meet-labels";

export type MeetLobbyPaneProps = {
  controller: MeetControllerState;
  displayName: string;
  inJoinFlow: boolean;
  hasSignedInIdentity: boolean;
  invitedRoom: string | null;
  waitingForAdmission: boolean;
  knockDots: number;
  cameras: MeetDeviceOption[];
  microphones: MeetDeviceOption[];
  speakers: MeetDeviceOption[];
  activeCamera: string;
  activeMic: string;
  activeSpeaker: string;
  onSpeakerChange: (value: string) => void;
  endedMessage: string | null;
  showMissingInviteScreen: boolean;
  showInviteCheckingScreen: boolean;
  showWaitingForHostScreen: boolean;
  showInviteErrorScreen: boolean;
  canStartReservedRoom: boolean;
};

export function MeetLobbyPane({
  controller,
  displayName,
  inJoinFlow,
  hasSignedInIdentity,
  invitedRoom,
  waitingForAdmission,
  knockDots,
  cameras,
  microphones,
  speakers,
  activeCamera,
  activeMic,
  activeSpeaker,
  onSpeakerChange,
  endedMessage,
  showMissingInviteScreen,
  showInviteCheckingScreen,
  showWaitingForHostScreen,
  showInviteErrorScreen,
  canStartReservedRoom,
}: MeetLobbyPaneProps) {
  const [previewAspect, setPreviewAspect] = useState<number | null>(null);

  useEffect(() => {
    const video = controller.localVideoRef.current;
    if (!video || !controller.videoOn) {
      setPreviewAspect(null);
      return;
    }
    const update = () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      setPreviewAspect(w > 0 && h > 0 ? w / h : null);
    };
    update();
    video.addEventListener("loadedmetadata", update);
    video.addEventListener("resize", update);
    return () => {
      video.removeEventListener("loadedmetadata", update);
      video.removeEventListener("resize", update);
    };
  }, [controller.videoOn, controller.localVideoRef]);

  if (endedMessage) {
    return (
      <MeetLobbyStatusCard title={meetLabels.callEndedTitle} body={endedMessage} titleSize="lg" />
    );
  }

  if (showMissingInviteScreen) {
    return (
      <MeetLobbyStatusCard
        title={meetLabels.missingInviteTitle}
        body={meetLabels.missingInviteBody}
      />
    );
  }

  if (showInviteCheckingScreen) {
    return (
      <MeetLobbyStatusCard
        title={meetLabels.checkingInviteTitle}
        body={meetLabels.checkingInviteBody}
        titleSize="md"
      />
    );
  }

  if (showWaitingForHostScreen) {
    return (
      <MeetLobbyStatusCard
        title={meetLabels.waitingForHostTitle}
        body={meetLabels.waitingForHostBody}
      />
    );
  }

  if (showInviteErrorScreen) {
    return (
      <MeetLobbyStatusCard
        title={meetLabels.inviteErrorTitle}
        body={meetLabels.inviteErrorBody}
      />
    );
  }

  return (
    <div className="w-full max-w-md">
      <h1 className="meet-workspace__title meet-workspace__title--hero">
        {inJoinFlow ? meetLabels.lobbyJoinTitle : meetLabels.lobbyHostTitle}
      </h1>

      <div
        className="meet-workspace__preview"
        style={
          previewAspect != null && controller.videoOn ? { aspectRatio: previewAspect } : undefined
        }
      >
        {controller.videoOn ? (
          <video
            ref={controller.localVideoRef}
            autoPlay
            muted
            playsInline
            className="meet-workspace__preview-video"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <UserAvatar displayName={displayName} compact size="xl" />
          </div>
        )}
        <div className="meet-workspace__preview-controls">
          <MeetCircleToggle
            on={controller.micOn}
            onClick={controller.toggleMic}
            OnIcon={Mic}
            OffIcon={MicOff}
            label={controller.micOn ? "Mute" : "Unmute"}
          />
          <MeetCircleToggle
            on={controller.videoOn}
            onClick={controller.toggleVideo}
            OnIcon={Video}
            OffIcon={VideoOff}
            label={controller.videoOn ? "Stop video" : "Start video"}
          />
        </div>
        {waitingForAdmission ? (
          <div className="meet-workspace__knock-overlay">
            <div className="meet-workspace__knock-icon">
              <Hand className="size-7" />
            </div>
            <div className="text-base font-semibold">
              {meetLabels.knocking}
              {".".repeat(knockDots)}
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--meet-muted)" }}>
              {meetLabels.knockingHint}
            </div>
          </div>
        ) : null}
      </div>

      <MeetDeviceForm
        displayName={{
          value: controller.displayName,
          onChange: controller.setDisplayName,
        }}
        cameras={cameras}
        microphones={microphones}
        speakers={speakers}
        camera={activeCamera}
        microphone={activeMic}
        speaker={activeSpeaker}
        onCameraChange={(id) => {
          const deviceId = meetDeviceIdForOption(cameras, id);
          if (!deviceId) return;
          void controller.switchCamera(deviceId);
        }}
        onMicrophoneChange={(id) => {
          const deviceId = meetDeviceIdForOption(microphones, id);
          if (!deviceId) return;
          void controller.switchMic(deviceId);
        }}
        onSpeakerChange={onSpeakerChange}
      >
        {!waitingForAdmission ? (
          <Button
            variant="primary"
            pill
            onClick={() => {
              if (invitedRoom) {
                void (canStartReservedRoom
                  ? controller.joinRoom(invitedRoom)
                  : controller.requestJoin(invitedRoom));
                return;
              }
              if (!hasSignedInIdentity) return;
              void controller.startMeeting();
            }}
            className="meet-workspace__primary-button"
            disabled={!hasSignedInIdentity && !invitedRoom}
          >
            {invitedRoom
              ? canStartReservedRoom
                ? meetLabels.joinMeeting
                : meetLabels.askToJoin
              : hasSignedInIdentity
                ? meetLabels.startMeeting
                : meetLabels.inviteRequired}
          </Button>
        ) : (
          <Button
            onClick={() => void controller.leave()}
            variant="outline"
            pill
            className="meet-workspace__secondary-button"
          >
            {meetLabels.cancelRequest}
          </Button>
        )}
        {controller.error ? <p className="meet-workspace__error">{controller.error}</p> : null}
      </MeetDeviceForm>
    </div>
  );
}
