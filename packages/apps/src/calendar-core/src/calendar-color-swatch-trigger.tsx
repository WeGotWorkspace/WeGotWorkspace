import * as React from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import "./calendar-color-swatch-trigger.css";

export type CalendarColorSwatchTriggerProps = React.ComponentPropsWithoutRef<"button"> & {
  color?: string;
  label: string;
  /** Hide the color dot (action rows such as “New calendar”). Default true. */
  showSwatch?: boolean;
};

/** Shared control-surface trigger: color dot + chevron (edit-calendar + event calendar switcher). */
export const CalendarColorSwatchTrigger = React.forwardRef<
  HTMLButtonElement,
  CalendarColorSwatchTriggerProps
>(function CalendarColorSwatchTrigger(
  { color, label, showSwatch = true, className, type = "button", children, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        "control-surface calendar-color-swatch-trigger",
        children ? "calendar-color-swatch-trigger--labeled" : null,
        className,
      )}
      aria-label={label}
      {...props}
    >
      {showSwatch ? (
        <span
          className="calendar-color-swatch-trigger__dot"
          style={{ backgroundColor: color || "transparent" }}
          aria-hidden
        />
      ) : null}
      {children ? <span className="calendar-color-swatch-trigger__caption">{children}</span> : null}
      <ChevronsUpDown className="calendar-color-swatch-trigger__chevron" aria-hidden />
    </button>
  );
});

CalendarColorSwatchTrigger.displayName = "CalendarColorSwatchTrigger";
