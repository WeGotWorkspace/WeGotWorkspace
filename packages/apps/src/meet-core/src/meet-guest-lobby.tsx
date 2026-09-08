import { useEffect, useId, useState } from "react";
import { DoorOpen, Hand, Mic, MicOff, Video, VideoOff } from "lucide-react";
import { Button } from "@/button/src/button";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { UserAvatar, avatarColorForUserId } from "@/user-avatar/src/user-avatar";
import { MeetCircleToggle } from "@/meet-core/src/meet-circle-toggle";
import { MeetDeviceForm } from "@/meet-core/src/meet-device-form";
import { meetDeviceIdForOption } from "@/meet-core/src/meet-device-utils";
import {
  MeetGuestLobbyCard,
  MeetGuestLobbyHeading,
  MeetGuestLobbyStatus,
} from "@/meet-core/src/meet-guest-lobby-card";
import type { MeetLobbyPaneProps } from "@/meet-core/src/meet-lobby-props";
import { MeetMicLevelBar } from "@/meet-core/src/meet-mic-level-bar";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { MeetChannelKind } from "@/meet-core/src/meet-types";
import { useMeetMicLevel } from "@/meet-core/src/use-meet-mic-level";

export type MeetGuestLobbyProps = MeetLobbyPaneProps & {
  channelName: string;
  channelTopic?: string | null;
  channelKind?: MeetChannelKind;
};

export function MeetGuestLobby({
  controller,
  displayName,
  hasSignedInIdentity,
  invitedRoom,
  waitingForAdmission,
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
  displayNameLocked = false,
}: MeetGuestLobbyProps) {
  const [previewAspect, setPreviewAspect] = useState<number | null>(null);
  const nameFieldId = useId();
  const micLevel = useMeetMicLevel(controller.getLocalStream(), controller.micOn);

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
    return <MeetGuestLobbyStatus title={meetLabels.callEndedTitle} body={endedMessage} />;
  }

  if (showMissingInviteScreen) {
    return (
      <MeetGuestLobbyStatus
        title={meetLabels.missingInviteTitle}
        body={meetLabels.missingInviteBody}
      />
    );
  }

  if (showInviteCheckingScreen) {
    return (
      <MeetGuestLobbyStatus
        title={meetLabels.checkingInviteTitle}
        body={meetLabels.checkingInviteBody}
      />
    );
  }

  if (showWaitingForHostScreen) {
    return (
      <MeetGuestLobbyStatus
        title={meetLabels.waitingForHostTitle}
        body={meetLabels.waitingForHostBody}
      />
    );
  }

  if (showInviteErrorScreen) {
    return (
      <MeetGuestLobbyStatus title={meetLabels.inviteErrorTitle} body={meetLabels.inviteErrorBody} />
    );
  }

  const join = () => {
    if (invitedRoom) {
      void (canStartReservedRoom
        ? controller.joinRoom(invitedRoom)
        : controller.requestJoin(invitedRoom));
      return;
    }
    if (!hasSignedInIdentity) return;
    void controller.startMeeting();
  };

  const knockLabel = invitedRoom
    ? canStartReservedRoom
      ? meetLabels.joinMeeting
      : meetLabels.knockToJoin
    : hasSignedInIdentity
      ? meetLabels.startMeeting
      : meetLabels.inviteRequired;

  return (
    <MeetGuestLobbyCard
      heading={<MeetGuestLobbyHeading title={meetLabels.invitedTitle} />}
      media={
        <>
          <div
            className="meet-workspace__preview meet-guest-lobby__preview"
            style={
              previewAspect != null && controller.videoOn
                ? { aspectRatio: previewAspect }
                : undefined
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
              <div className="meet-guest-lobby__preview-idle">
                <UserAvatar
                  displayName={displayName}
                  compact
                  size="xl"
                  color={avatarColorForUserId(displayName)}
                />
                <p className="meet-guest-lobby__camera-off">{meetLabels.cameraOff}</p>
              </div>
            )}
            <div className="meet-workspace__preview-controls meet-guest-lobby__preview-controls">
              <MeetCircleToggle
                on={controller.micOn}
                onClick={controller.toggleMic}
                OnIcon={Mic}
                OffIcon={MicOff}
                label={controller.micOn ? meetLabels.disableAudio : meetLabels.enableAudio}
              />
              <MeetCircleToggle
                on={controller.videoOn}
                onClick={controller.toggleVideo}
                OnIcon={Video}
                OffIcon={VideoOff}
                label={controller.videoOn ? meetLabels.disableVideo : meetLabels.enableVideo}
              />
            </div>
          </div>
          <MeetMicLevelBar level={micLevel} />
          <MeetDeviceForm
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
            menuClassName="meet-device-popover"
            deviceLayout="row"
            className="meet-guest-lobby__devices"
          />
        </>
      }
      invite={
        <>
          <div className="meet-guest-lobby__name">
            <FieldLabelRow label={meetLabels.yourNameLabel} htmlFor={nameFieldId}>
              <Input
                id={nameFieldId}
                value={controller.displayName}
                onChange={(event) => {
                  if (displayNameLocked) return;
                  controller.setDisplayName(event.target.value);
                }}
                disabled={displayNameLocked}
                readOnly={displayNameLocked}
                className="meet-workspace__display-name-input"
              />
            </FieldLabelRow>
          </div>
          <Button
            variant="primary"
            icon={waitingForAdmission ? <Hand /> : <DoorOpen />}
            label={knockLabel}
            onClick={join}
            className={
              waitingForAdmission
                ? "meet-guest-lobby__knock meet-guest-lobby__knock--waiting"
                : "meet-guest-lobby__knock"
            }
            disabled={waitingForAdmission || (!hasSignedInIdentity && !invitedRoom)}
            aria-busy={waitingForAdmission || undefined}
          />
          <div className="meet-guest-lobby__after-knock">
            <p className="meet-guest-lobby__footer" aria-hidden={waitingForAdmission || undefined}>
              {meetLabels.knockNoAccount}
            </p>
            {waitingForAdmission ? (
              <Button
                variant="subtle"
                label={meetLabels.cancelKnock}
                onClick={() => void controller.leave()}
                className="meet-guest-lobby__cancel"
              />
            ) : null}
          </div>
          {controller.error ? <p className="meet-workspace__error">{controller.error}</p> : null}
        </>
      }
    />
  );
}
