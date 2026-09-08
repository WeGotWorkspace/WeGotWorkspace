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
import type { MeetCallKnocker } from "@/meet-core/src/meet-call-knock";
import { MeetDevicePopover } from "@/meet-core/src/meet-device-popover";
import type { MeetDeviceOption } from "@/meet-core/src/meet-device-utils";
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
  onToggleScreenShare: () => void;
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
  onToggleScreenShare,
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
  return (
    <div className="meet-workspace__toolbar">
      <div className="meet-workspace__toolbar-inner">
        <IconButton
          onClick={onToggleMic}
          icon={micOn ? <Mic /> : <MicOff />}
          label={micOn ? meetLabels.disableAudio : meetLabels.enableAudio}
          size="sm"
          variant="subtle"
          active={micOn}
          aria-pressed={micOn}
        />
        <IconButton
          onClick={onToggleVideo}
          icon={videoOn ? <Video /> : <VideoOff />}
          label={videoOn ? meetLabels.disableVideo : meetLabels.enableVideo}
          size="sm"
          variant="subtle"
          active={videoOn}
          aria-pressed={videoOn}
        />
        <IconButton
          onClick={onToggleScreenShare}
          icon={<MonitorUp />}
          label={screenOn ? meetLabels.stopSharing : meetLabels.shareScreen}
          size="sm"
          variant="subtle"
          active={screenOn}
          aria-pressed={screenOn}
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
        {extraActions}
        {onAdmitKnocker && onDenyKnocker ? (
          <MeetKnockBadge knockers={knockers} onAdmit={onAdmitKnocker} onDeny={onDenyKnocker} />
        ) : null}
        <div className="meet-workspace__toolbar-divider" aria-hidden />
        {confirmExit ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <IconButton
                icon={<PhoneOff />}
                label={callExitLabel}
                size="sm"
                variant="destructive"
              />
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
            size="sm"
            variant="destructive"
          />
        )}
      </div>
    </div>
  );
}
