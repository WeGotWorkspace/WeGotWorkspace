import * as React from "react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/tooltip";

import "./switch.css";

export type SwitchProps = {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  /** Hover hint, like an icon button's: what a click does (follow `checked`). */
  tooltip?: React.ReactNode;
};

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  (
    {
      checked = false,
      onCheckedChange,
      disabled = false,
      size = "sm",
      className,
      id,
      "aria-label": ariaLabel,
      "aria-labelledby": ariaLabelledBy,
      tooltip,
    },
    ref,
  ) => {
    const button = (
      <button
        ref={ref}
        type="button"
        role="switch"
        id={id}
        aria-checked={checked}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        disabled={disabled}
        data-state={checked ? "on" : "off"}
        data-disabled={disabled ? "" : undefined}
        className={cn("switch", size === "md" && "switch--size-md", className)}
        onClick={() => {
          if (disabled) {
            return;
          }
          onCheckedChange?.(!checked);
        }}
      >
        <span className="switch__thumb" aria-hidden />
      </button>
    );
    if (tooltip == null) return button;
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent>{tooltip}</TooltipContent>
      </Tooltip>
    );
  },
);
Switch.displayName = "Switch";

export { Switch };
