import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

import "./card.css";

type CardPanelProps = {
  children: ReactNode;
  className?: string;
};

/** Inner bordered group for stacked {@link CardRow}s (share dialog, event editor). */
export function CardPanel({ children, className }: CardPanelProps): ReactNode {
  return <div className={cn("card__panel", className)}>{children}</div>;
}

type CardRowDividerProps = {
  className?: string;
};

export function CardRowDivider({ className }: CardRowDividerProps): ReactNode {
  return <div className={cn("card__row-divider", className)} role="separator" />;
}
