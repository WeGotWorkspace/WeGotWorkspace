import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import "@/selection-mark/src/selection-mark.css";

/**
 * The multi-select mark (suite norm), one for every list and grid: Notes,
 * Contacts, Tasks rows and the Drive / Docs browser. An empty ring, or when
 * checked a solid fill in the selection tint with a dark check
 * (`--workspace-selected-mark-*`). Decorative: the row carries the state.
 */
export function SelectionMark({ checked, className }: { checked: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("selection-mark", className)}
      data-state={checked ? "checked" : "unchecked"}
    >
      {checked ? <Check className="selection-mark__icon" strokeWidth={2.75} /> : null}
    </span>
  );
}
