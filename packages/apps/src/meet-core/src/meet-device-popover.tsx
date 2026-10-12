import { useState } from "react";
import { Settings as SettingsIcon } from "lucide-react";
import { IconButton } from "@/button/src/button";
import { MenuItem } from "@/menu-item/src/menu-item";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { meetLabels } from "@/meet-core/src/meet-labels";
import type { MeetDeviceOption } from "@/meet-core/src/meet-device-utils";
import "@/menu-dropdown/src/dropdown-menu.css";

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
  /** Device setting, persisted in local storage. Omitted outside a live call. */
  lowData?: boolean;
  onLowDataChange?: (enabled: boolean) => void;
  /** Storybook: start with the device menu open. */
  defaultOpen?: boolean;
};

type DeviceSegmentProps = {
  label: string;
  value: string;
  options: MeetDeviceOption[];
  onValueChange: (value: string) => void;
};

function DeviceSegment({ label, value, options, onValueChange }: DeviceSegmentProps) {
  return (
    <DropdownMenuGroup aria-label={label}>
      <DropdownMenuLabel className="meet-device-menu__label">{label}</DropdownMenuLabel>
      {options.map((option) => {
        const active = option.id === value;
        return (
          <DropdownMenuItem
            key={option.id}
            asChild
            className="dropdown-menu__item"
            onSelect={() => onValueChange(option.id)}
          >
            <MenuItem
              label={option.label}
              checked={active}
              selected={active}
              className="dropdown-menu__menu-item"
              onClick={() => onValueChange(option.id)}
            />
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuGroup>
  );
}

/**
 * In-call device picker: one shared dropdown, one checked option per segment
 * (camera, microphone, speaker). Checkmark is MenuItem's, same slot as other menus.
 */
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
  lowData,
  onLowDataChange,
  defaultOpen,
}: MeetDevicePopoverProps) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <IconButton
          icon={<SettingsIcon />}
          label={meetLabels.devices}
          size="md"
          variant="outline"
          active={open}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" className="meet-device-menu">
        <DeviceSegment
          label={meetLabels.cameraLabel}
          value={camera}
          options={cameras}
          onValueChange={onCamera}
        />
        <DropdownMenuSeparator />
        <DeviceSegment
          label={meetLabels.microphoneLabel}
          value={microphone}
          options={microphones}
          onValueChange={onMicrophone}
        />
        <DropdownMenuSeparator />
        <DeviceSegment
          label={meetLabels.speakerLabel}
          value={speaker}
          options={speakers}
          onValueChange={onSpeaker}
        />
        {onLowDataChange ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup aria-label={meetLabels.lowDataMode}>
              <DropdownMenuItem
                asChild
                className="dropdown-menu__item"
                onSelect={() => onLowDataChange(!lowData)}
              >
                <MenuItem
                  label={meetLabels.lowDataMode}
                  checked={Boolean(lowData)}
                  selected={Boolean(lowData)}
                  className="dropdown-menu__menu-item"
                  onClick={() => onLowDataChange(!lowData)}
                />
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
