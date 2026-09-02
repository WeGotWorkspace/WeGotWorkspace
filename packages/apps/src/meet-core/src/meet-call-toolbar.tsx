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
import { MeetDevicePopover } from "@/meet-core/src/meet-device-popover";
import type { MeetDeviceOption } from "@/meet-core/src/meet-device-utils";
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
  extraActions?: ReactNode;
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
  extraActions,
}: MeetCallToolbarProps) {
  return (
    <div className="meet-workspace__toolbar">
      <div className="meet-workspace__toolbar-inner">
        <IconButton
          onClick={onToggleMic}
          icon={micOn ? <Mic /> : <MicOff />}
          label={micOn ? meetLabels.mute : meetLabels.unmute}
          size="sm"
          variant="subtle"
          active={micOn}
          aria-pressed={micOn}
        />
        <IconButton
          onClick={onToggleVideo}
          icon={videoOn ? <Video /> : <VideoOff />}
          label={videoOn ? meetLabels.stopVideo : meetLabels.startVideo}
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
        <div className="meet-workspace__toolbar-divider" aria-hidden />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <IconButton icon={<PhoneOff />} label={callExitLabel} size="sm" variant="destructive" />
          </AlertDialogTrigger>
          <AlertDialogContent className="meet-call-dialog">
            <AlertDialogHeader>
              <AlertDialogTitle>{callExitTitle}</AlertDialogTitle>
              <AlertDialogDescription>{callExitDescription}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel asChild>
                <Button variant="outline">Cancel</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button variant="destructive" onClick={onConfirmExit}>
                  {callExitLabel}
                </Button>
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
