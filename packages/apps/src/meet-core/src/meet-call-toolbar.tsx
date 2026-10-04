import type { ReactNode } from "react";
import { Mic, MicOff, MonitorUp, PhoneOff, Video, VideoOff } from "lucide-react";
import { Button, IconButton } from "@/button/src/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/ui/alert-dialog";
import "@/floating-action-bar/src/floating-action-bar.css";
import type { MeetCallKnocker } from "@/meet-core/src/meet-call-knock";
import { MeetCircleToggle } from "@/meet-core/src/meet-circle-toggle";
import { MeetDevicePopover } from "@/meet-core/src/meet-device-popover";
import type { MeetDeviceOption } from "@/meet-core/src/meet-device-utils";
import { isDisplayCaptureSupported } from "@/meet-core/src/meet-display-capture";
import { MeetKnockBadge } from "@/meet-core/src/meet-knock-badge";
import { meetLabels } from "@/meet-core/src/meet-labels";

type MeetCallToolbarProps = {
  micOn: boolean;
  videoOn: boolean;
  screenOn: boolean;
  callExitLabel: string;
  callExitTitle: string;
  callExitDescription: string;
  cameras: MeetDeviceOption[];
  microphones: MeetDeviceOption[];
  speakers: MeetDeviceOption[];
  activeCamera: string;
  activeMic: string;
  activeSpeaker: string;
  onToggleMic: () => void;
  onToggleVideo: () => void;
  /** Instance ceiling is audio-only. The camera control stays off. */
  videoLocked?: boolean;
  onToggleScreenShare: () => void;
  /**
   * Override getDisplayMedia feature detection. When false, Share screen is
   * omitted so the user is not offered a broken action.
   */
  canShareScreen?: boolean;
  onCameraChange: (optionId: string) => void;
  onMicrophoneChange: (optionId: string) => void;
  onSpeakerChange: (optionId: string) => void;
  onConfirmExit: () => void;
  /**
   * Ask before leaving. Guests get the confirmation (leaving may be hard to
   * undo for them); signed-in members leave instantly — rejoining is one click.
   */
  confirmExit?: boolean;
  extraActions?: ReactNode;
  /** Host: waiting knockers. Shown as an action-row icon (production MeetKnockBadge). */
  knockers?: readonly MeetCallKnocker[];
  onAdmitKnocker?: (peerId: string) => void;
  onDenyKnocker?: (peerId: string) => void;
};

export function MeetCallToolbar({
  micOn,
  videoOn,
  screenOn,
  callExitLabel,
  callExitTitle,
  callExitDescription,
  cameras,
  microphones,
  speakers,
  activeCamera,
  activeMic,
  activeSpeaker,
  onToggleMic,
  onToggleVideo,
  videoLocked = false,
  onToggleScreenShare,
  canShareScreen,
  onCameraChange,
  onMicrophoneChange,
  onSpeakerChange,
  onConfirmExit,
  confirmExit = true,
  extraActions,
  knockers = [],
  onAdmitKnocker,
  onDenyKnocker,
}: MeetCallToolbarProps) {
  const shareAvailable = canShareScreen ?? isDisplayCaptureSupported();
  const videoLabel = videoLocked
    ? meetLabels.cameraDisabledByAdmin
    : videoOn
      ? meetLabels.disableVideo
      : meetLabels.enableVideo;
  return (
    <div className="meet-workspace__toolbar floating-action-bar">
      <MeetCircleToggle
        on={micOn}
        onClick={onToggleMic}
        OnIcon={Mic}
        OffIcon={MicOff}
        label={micOn ? meetLabels.disableAudio : meetLabels.enableAudio}
      />
      <MeetCircleToggle
        on={videoLocked ? false : videoOn}
        onClick={onToggleVideo}
        OnIcon={Video}
        OffIcon={VideoOff}
        disabled={videoLocked}
        label={videoLabel}
      />
      {shareAvailable || screenOn ? (
        <IconButton
          onClick={onToggleScreenShare}
          icon={<MonitorUp />}
          label={screenOn ? meetLabels.stopSharing : meetLabels.shareScreen}
          size="md"
          variant="outline"
          active={screenOn}
          aria-pressed={screenOn}
        />
      ) : null}
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
      {extraActions}
      {onAdmitKnocker && onDenyKnocker ? (
        <MeetKnockBadge knockers={knockers} onAdmit={onAdmitKnocker} onDeny={onDenyKnocker} />
      ) : null}
      <span className="floating-action-bar__spacer" aria-hidden />
      {confirmExit ? (
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <IconButton icon={<PhoneOff />} label={callExitLabel} size="md" variant="destructive" />
          </AlertDialogTrigger>
          <AlertDialogContent className="meet-call-dialog">
            <AlertDialogHeader className="meet-call-dialog__header">
              <AlertDialogTitle>{callExitTitle}</AlertDialogTitle>
              <AlertDialogDescription>{callExitDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="meet-call-dialog__footer">
              <AlertDialogCancel asChild>
                <Button variant="outline" className="meet-call-dialog__cancel">
                  {meetLabels.cancel}
                </Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  variant="destructive"
                  className="meet-call-dialog__confirm"
                  onClick={onConfirmExit}
                >
                  {callExitLabel}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : (
        <IconButton
          onClick={onConfirmExit}
          icon={<PhoneOff />}
          label={callExitLabel}
          size="md"
          variant="destructive"
        />
      )}
    </div>
  );
}
