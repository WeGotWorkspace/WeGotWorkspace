import type { ComponentType } from "react";
import { IconButton } from "@/button/src/button";

type MeetCircleToggleProps = {
  on: boolean;
  onClick: () => void;
  OnIcon: ComponentType<{ className?: string }>;
  OffIcon: ComponentType<{ className?: string }>;
  label: string;
  disabled?: boolean;
  /** @deprecated Same `sm` IconButton as ViewHeader — size no longer changes. */
  large?: boolean;
};

export function MeetCircleToggle({
  on,
  onClick,
  OnIcon,
  OffIcon,
  label,
  disabled,
}: MeetCircleToggleProps) {
  const Icon = on ? OnIcon : OffIcon;

  return (
    <IconButton
      onClick={onClick}
      label={label}
      icon={<Icon />}
      size="md"
      variant="outline"
      severity={on ? undefined : "danger"}
      aria-pressed={on}
      disabled={disabled}
    />
  );
}
