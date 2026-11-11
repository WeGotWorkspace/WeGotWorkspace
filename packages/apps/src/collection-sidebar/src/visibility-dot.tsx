import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import "./visibility-dot.css";

/** `"mixed"` when only some of the rows a toggle-all covers are on. */
export type VisibilityDotChecked = boolean | "mixed";

export type VisibilityDotProps = {
  checked: VisibilityDotChecked;
  /** Accessible name, for example "Hide Work" or "Show all reminders". */
  label: string;
  onToggle: () => void;
  /** Extra classes on the button (a row keeps its own BEM names). */
  className?: string;
  dotClassName?: string;
  style?: CSSProperties;
};

function dataState(checked: VisibilityDotChecked): "checked" | "unchecked" | "indeterminate" {
  if (checked === "mixed") return "indeterminate";
  return checked ? "checked" : "unchecked";
}

/**
 * Suite visibility toggle: a coloured dot that turns grey while off. A row
 * uses it for one collection; a section heading uses it, in a neutral colour,
 * to show or hide every row at once (half-filled while only some are on).
 */
export function VisibilityDot({
  checked,
  label,
  onToggle,
  className,
  dotClassName,
  style,
}: VisibilityDotProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      data-state={dataState(checked)}
      aria-label={label}
      className={cn("visibility-dot", className)}
      style={style}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <span className={cn("visibility-dot__dot", dotClassName)} aria-hidden />
    </button>
  );
}
