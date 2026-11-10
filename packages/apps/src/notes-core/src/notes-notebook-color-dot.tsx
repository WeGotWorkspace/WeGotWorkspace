import type { CSSProperties, ReactElement } from "react";
import { cn } from "@/lib/utils";
import "@/notes-core/src/notes-notebook-color-dot.css";

/**
 * The notebook's colour dot (suite norm, same as the sidebar). Takes its colour
 * from `color`, else from `--collection-row-color` on an ancestor.
 */
export function NotesNotebookColorDot({
  className,
  color,
}: {
  className?: string;
  color?: string;
}): ReactElement {
  return (
    <span
      className={cn("notes-notebook-color-dot", className)}
      aria-hidden
      style={color ? ({ "--collection-row-color": color } as CSSProperties) : undefined}
    />
  );
}
