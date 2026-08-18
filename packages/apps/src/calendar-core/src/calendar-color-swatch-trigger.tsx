import * as React from "react";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import "./calendar-color-swatch-trigger.css";

export type CalendarColorSwatchTriggerProps = React.ComponentPropsWithoutRef<"button"> & {
  color: string;
  label: string;
};

/** Shared control-surface trigger: color dot + chevron (edit-calendar + event calendar switcher). */
export const CalendarColorSwatchTrigger = React.forwardRef<
  HTMLButtonElement,
  CalendarColorSwatchTriggerProps
>(function CalendarColorSwatchTrigger({ color, label, className, type = "button", ...props }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn("control-surface calendar-color-swatch-trigger", className)}
      aria-label={label}
      {...props}
    >
      <span
        className="calendar-color-swatch-trigger__dot"
        style={{ backgroundColor: color || "transparent" }}
        aria-hidden
      />
      <ChevronsUpDown className="calendar-color-swatch-trigger__chevron" aria-hidden />
    </button>
  );
});

CalendarColorSwatchTrigger.displayName = "CalendarColorSwatchTrigger";
