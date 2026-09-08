import { useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/popover";
import { MeetDeviceForm } from "@/meet-core/src/meet-device-form";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { MeetDeviceOption } from "@/meet-core/src/meet-device-utils";

type MeetDevicePopoverProps = {
  cameras: MeetDeviceOption[];
  microphones: MeetDeviceOption[];
  speakers: MeetDeviceOption[];
  camera: string;
  microphone: string;
  speaker: string;
  onCamera: (value: string) => void;
  onMicrophone: (value: string) => void;
  onSpeaker: (value: string) => void;
  /** Storybook: start with the device sheet open. */
  defaultOpen?: boolean;
};

export function MeetDevicePopover({
  cameras,
  microphones,
  speakers,
  camera,
  microphone,
  speaker,
  onCamera,
  onMicrophone,
  onSpeaker,
  defaultOpen,
}: MeetDevicePopoverProps) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          icon={<SettingsIcon />}
          label={meetLabels.devices}
          size="sm"
          variant="subtle"
          active={open}
        />
      </PopoverTrigger>
      <PopoverContent side="top" align="center" className="meet-device-popover">
        <MeetDeviceForm
          cameras={cameras}
          microphones={microphones}
          speakers={speakers}
          camera={camera}
          microphone={microphone}
          speaker={speaker}
          onCameraChange={onCamera}
          onMicrophoneChange={onMicrophone}
          onSpeakerChange={onSpeaker}
          menuClassName="meet-device-popover"
        />
      </PopoverContent>
    </Popover>
  );
}
