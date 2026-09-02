import type { ComponentType } from "react";
import { IconButton } from "@/button/src/button";

type MeetCircleToggleProps = {
  on: boolean;
  onClick: () => void;
  OnIcon: ComponentType<{ className?: string }>;
  OffIcon: ComponentType<{ className?: string }>;
  label: string;
  /** @deprecated Same `sm` IconButton as ViewHeader — size no longer changes. */
  large?: boolean;
};

export function MeetCircleToggle({ on, onClick, OnIcon, OffIcon, label }: MeetCircleToggleProps) {
  const Icon = on ? OnIcon : OffIcon;

  return (
    <IconButton
      onClick={onClick}
      label={label}
      icon={<Icon />}
      size="sm"
      variant="subtle"
      active={on}
      aria-pressed={on}
    />
  );
}
