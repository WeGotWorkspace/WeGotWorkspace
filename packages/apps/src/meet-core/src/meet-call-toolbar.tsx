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
import { MeetCircleToggle } from "@/meet-core/src/meet-circle-toggle";
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
}: MeetCallToolbarProps) {
  return (
    <div className="meet-workspace__toolbar">
      <div className="meet-workspace__toolbar-inner">
        <MeetCircleToggle
          on={micOn}
          onClick={onToggleMic}
          OnIcon={Mic}
          OffIcon={MicOff}
          label={micOn ? "Mute" : "Unmute"}
          large
        />
        <MeetCircleToggle
          on={videoOn}
          onClick={onToggleVideo}
          OnIcon={Video}
          OffIcon={VideoOff}
          label={videoOn ? "Stop video" : "Start video"}
          large
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
          onClick={onToggleScreenShare}
          icon={<MonitorUp />}
          label={screenOn ? meetLabels.stopSharing : meetLabels.shareScreen}
          size="lg"
          variant="subtle"
          active={screenOn}
        />
        <div className="meet-workspace__toolbar-divider" aria-hidden />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <IconButton icon={<PhoneOff />} label={callExitLabel} size="lg" variant="destructive" />
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
