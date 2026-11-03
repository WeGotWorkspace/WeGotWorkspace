import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { cn } from "@/lib/utils";
import "@/ui/progress.css";

const RING_RADIUS = 7;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export type ProgressRingProps = Omit<
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>,
  "value" | "max" | "getValueLabel" | "aria-label" | "aria-valuetext"
> & {
  /** 0–100, or `null` while the amount done is unknown (indeterminate). */
  value: number | null;
  /** Accessible name, e.g. "Upload of report.pdf". */
  label: string;
  /** What a screen reader says for the value, e.g. "Uploading, 42%" or "Waiting to upload". */
  valueText: string;
  /**
   * Look of an indeterminate ring: `spin` (busy), `static` (waiting, dashed),
   * or `pulse` (nearly done, full ring). Ignored when `value` is a number.
   */
  indeterminate?: "spin" | "static" | "pulse";
  /** Optional glyph in the middle of the ring (decorative). */
  children?: React.ReactNode;
};

/**
 * Circular progress on the Radix progress primitive: `role="progressbar"`
 * with `aria-valuenow` (when known) and an `aria-valuetext` that always says
 * what is going on, so a waiting or busy ring is never announced as 0%.
 */
export const ProgressRing = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  ProgressRingProps
>(function ProgressRing(
  { value, label, valueText, indeterminate = "spin", className, children, ...props },
  ref,
) {
  const determinate = typeof value === "number";
  const clamped = determinate ? Math.min(100, Math.max(0, value)) : null;
  const look = determinate ? "determinate" : indeterminate;
  const dashOffset = clamped === null ? undefined : RING_CIRCUMFERENCE * (1 - clamped / 100);
  return (
    <ProgressPrimitive.Root
      ref={ref}
      value={clamped}
      max={100}
      aria-label={label}
      aria-valuetext={valueText}
      className={cn("progress-ring", `progress-ring--${look}`, className)}
      {...props}
    >
      <svg className="progress-ring__svg" viewBox="0 0 18 18" aria-hidden="true">
        <circle className="progress-ring__track" cx="9" cy="9" r={RING_RADIUS} />
        <ProgressPrimitive.Indicator asChild>
          <circle
            className="progress-ring__indicator"
            cx="9"
            cy="9"
            r={RING_RADIUS}
            strokeDasharray={RING_CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
          />
        </ProgressPrimitive.Indicator>
      </svg>
      {children ? <span className="progress-ring__glyph">{children}</span> : null}
    </ProgressPrimitive.Root>
  );
});
