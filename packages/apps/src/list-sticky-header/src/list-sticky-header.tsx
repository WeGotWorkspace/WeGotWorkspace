import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "@/list-sticky-header/src/list-sticky-header.css";

export type ListStickyHeaderProps = {
  children: ReactNode;
  id?: string;
  className?: string;
};

/** Full-width sticky list section row (hairline + label). Shared by contacts letters and chat days. */
export function ListStickyHeader({ children, id, className }: ListStickyHeaderProps): ReactNode {
  return (
    <div id={id} className={cn("list-sticky-header", className)}>
      {children}
    </div>
  );
}
