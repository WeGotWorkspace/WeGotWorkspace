import type { ReactNode } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { controlSizeClassName, type ControlSize } from "@/ui/control-size";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

import "./user-chip.css";

export type UserChipProps = {
  /** Visible name beside the avatar. */
  label: string;
  /** Replaces initials in the avatar circle (e.g. RSVP / organizer icon). */
  markIcon?: ReactNode;
  /** Accessible status / role name (tooltip + aria). */
  statusLabel?: string;
  /**
   * Tone class (or inline vars) that sets `--tag-bg` / `--tag-fg` for the
   * full chip wash + border. Avatar mark inherits the same hue.
   */
  className?: string;
  /**
   * Shared control height scale (`xs`…`xl`). Default `md` (36px) matches
   * Input / Select / Button.
   */
  size?: ControlSize;
  removable?: boolean;
  onRemove?: () => void;
  removeAriaLabel?: string;
};

/**
 * Compact person chip: button-rounded wash, leading avatar (+ optional status
 * icon), name, optional dismiss — for participant lists and similar.
 */
export function UserChip({
  label,
  markIcon,
  statusLabel,
  className,
  size = "md",
  removable = false,
  onRemove,
  removeAriaLabel,
}: UserChipProps) {
  const removeLabel = removeAriaLabel ?? `Remove ${label}`;
  const a11yName = statusLabel ? `${label}, ${statusLabel}` : label;

  const chip = (
    <span
      role="group"
      className={cn("user-chip", controlSizeClassName("user-chip", size), className)}
      aria-label={a11yName}
      tabIndex={statusLabel ? 0 : undefined}
    >
      <span className="user-chip__main">
        <span aria-hidden className="user-chip__mark-wrap">
          <UserAvatar
            displayName={label}
            compact
            size="xs"
            fallback={markIcon}
            className="user-chip__mark"
          />
        </span>
        <span className="user-chip__label" aria-hidden>
          {label}
        </span>
      </span>
      {removable && onRemove ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="user-chip__remove"
              aria-label={removeLabel}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onRemove();
              }}
            >
              <X aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent>{removeLabel}</TooltipContent>
        </Tooltip>
      ) : null}
    </span>
  );

  if (!statusLabel) return chip;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{chip}</TooltipTrigger>
      <TooltipContent>{statusLabel}</TooltipContent>
    </Tooltip>
  );
}
