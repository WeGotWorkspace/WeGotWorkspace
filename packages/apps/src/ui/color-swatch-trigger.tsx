import * as React from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { controlSizeClassName, type ControlSize } from "@/ui/control-size";
import "./input.css";
import "./color-swatch-trigger.css";

export type ColorSwatchTriggerProps = React.ComponentPropsWithoutRef<"button"> & {
  color?: string;
  label: string;
  /** Hide the color dot (action rows such as “New calendar”). Default true. */
  showSwatch?: boolean;
  /** Replaces the color dot; keeps the unlabeled mark + chevron layout. */
  icon?: React.ReactNode;
  /** Height, padding, and font-size. Default `md` — matches SelectTrigger / Input. */
  size?: ControlSize;
};

/** Shared control-surface trigger: color dot + chevron (dialogs + pickers). */
export const ColorSwatchTrigger = React.forwardRef<HTMLButtonElement, ColorSwatchTriggerProps>(
  function ColorSwatchTrigger(
    {
      color,
      label,
      showSwatch = true,
      icon,
      className,
      type = "button",
      size = "md",
      children,
      ...props
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "control-surface color-swatch-trigger",
          controlSizeClassName("control-surface", size),
          children ? "color-swatch-trigger--labeled" : null,
          className,
        )}
        aria-label={label}
        {...props}
      >
        {icon != null ? (
          <span className="color-swatch-trigger__icon" aria-hidden>
            {icon}
          </span>
        ) : showSwatch ? (
          <span
            className="color-swatch-trigger__dot"
            style={{ backgroundColor: color || "transparent" }}
            aria-hidden
          />
        ) : null}
        {children ? <span className="color-swatch-trigger__caption">{children}</span> : null}
        <ChevronsUpDown className="color-swatch-trigger__chevron" aria-hidden />
      </button>
    );
  },
);

ColorSwatchTrigger.displayName = "ColorSwatchTrigger";
