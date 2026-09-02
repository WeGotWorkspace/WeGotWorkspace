import { useId } from "react";
import { Mic, Video, Volume2 } from "lucide-react";
import { FieldLabelRow } from "@/ui/field-label-row";
import { Input } from "@/ui/input";
import { MeetDeviceRow } from "@/meet-core/src/meet-device-row";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { MeetDeviceOption } from "@/meet-core/src/meet-device-utils";
import { cn } from "@/lib/utils";

export type MeetDeviceFormProps = {
  displayName?: {
    value: string;
    onChange: (value: string) => void;
  };
  cameras: MeetDeviceOption[];
  microphones: MeetDeviceOption[];
  speakers: MeetDeviceOption[];
  camera: string;
  microphone: string;
  speaker: string;
  onCameraChange: (optionId: string) => void;
  onMicrophoneChange: (optionId: string) => void;
  onSpeakerChange: (optionId: string) => void;
  children?: React.ReactNode;
  className?: string;
  /** Portaled select menu surface. Lobby stays dark; the in-call sheet is paper. */
  menuClassName?: string;
};

export function MeetDeviceForm({
  displayName,
  cameras,
  microphones,
  speakers,
  camera,
  microphone,
  speaker,
  onCameraChange,
  onMicrophoneChange,
  onSpeakerChange,
  children,
  className,
  menuClassName,
}: MeetDeviceFormProps) {
  const displayNameId = useId();
  return (
    <div className={cn("meet-workspace__form", className)}>
      {displayName ? (
        <div className="meet-workspace__form-identity">
          <FieldLabelRow label={meetLabels.displayNameLabel} htmlFor={displayNameId}>
            <Input
              id={displayNameId}
              value={displayName.value}
              onChange={(event) => displayName.onChange(event.target.value)}
              className="meet-workspace__display-name-input"
            />
          </FieldLabelRow>
        </div>
      ) : null}
      <div className="meet-workspace__form-devices">
        <MeetDeviceRow
          icon={<Video />}
          label={meetLabels.cameraLabel}
          value={camera}
          onChange={onCameraChange}
          options={cameras}
          menuClassName={menuClassName}
        />
        <MeetDeviceRow
          icon={<Mic />}
          label={meetLabels.microphoneLabel}
          value={microphone}
          onChange={onMicrophoneChange}
          options={microphones}
          menuClassName={menuClassName}
        />
        <MeetDeviceRow
          icon={<Volume2 />}
          label={meetLabels.speakerLabel}
          value={speaker}
          onChange={onSpeakerChange}
          options={speakers}
          menuClassName={menuClassName}
        />
      </div>
      {children}
    </div>
  );
}
