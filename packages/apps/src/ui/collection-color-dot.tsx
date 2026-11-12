import type { CSSProperties, ReactElement } from "react";
import { cn } from "@/lib/utils";
import "@/ui/collection-color-dot.css";

/**
 * A collection's colour dot (suite norm, same as the sidebar). Takes its colour
 * from `color`, else from `--collection-row-color` on an ancestor.
 */
export function CollectionColorDot({
  className,
  color,
}: {
  className?: string;
  color?: string;
}): ReactElement {
  return (
    <span
      className={cn("collection-color-dot", className)}
      aria-hidden
      style={color ? ({ "--collection-row-color": color } as CSSProperties) : undefined}
    />
  );
}
