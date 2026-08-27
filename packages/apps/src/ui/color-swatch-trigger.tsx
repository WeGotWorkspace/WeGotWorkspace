import * as React from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import "./color-swatch-trigger.css";

export type ColorSwatchTriggerProps = React.ComponentPropsWithoutRef<"button"> & {
  color?: string;
  label: string;
  /** Hide the color dot (action rows such as “New calendar”). Default true. */
  showSwatch?: boolean;
};

/** Shared control-surface trigger: color dot + chevron (dialogs + pickers). */
export const ColorSwatchTrigger = React.forwardRef<HTMLButtonElement, ColorSwatchTriggerProps>(
  function ColorSwatchTrigger(
    { color, label, showSwatch = true, className, type = "button", children, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type}
        className={cn(
          "control-surface color-swatch-trigger",
          children ? "color-swatch-trigger--labeled" : null,
          className,
        )}
        aria-label={label}
        {...props}
      >
        {showSwatch ? (
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
