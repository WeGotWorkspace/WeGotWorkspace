import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "./name-color-row.css";

export const NAME_COLOR_ROW_INPUT_CLASS = "name-color-row__input";

export type NameColorRowProps = {
  children: ReactNode;
  className?: string;
};

/** Title/name field + compact color (or calendar) swatch on one row. */
export function NameColorRow({ children, className }: NameColorRowProps) {
  return <div className={cn("name-color-row", className)}>{children}</div>;
}
