import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

import "./card.css";

export type CardRowProps = {
  /** Optional leading mark (avatar, icon tile). */
  leading?: ReactNode;
  title?: string;
  subtitle?: string;
  /** Sits beside the title (inherited badge, etc.). */
  titleExtra?: ReactNode;
  /** Sits at the end of the title line (pending tag, etc.). */
  titleEnd?: ReactNode;
  /** Trailing controls (switch, select, icon buttons). */
  children?: ReactNode;
  /** Grow the trailing slot (full-width select with no title). */
  fill?: boolean;
  className?: string;
};

export function CardRow({
  leading,
  title,
  subtitle,
  titleExtra,
  titleEnd,
  children,
  fill = false,
  className,
}: CardRowProps): ReactNode {
  const hasMain = title != null || subtitle != null || titleExtra != null || titleEnd != null;

  return (
    <div className={cn("card__row", fill && "card__row--fill", className)}>
      {leading != null ? (
        <div className={cn("card__row-leading", !hasMain && "card__row-leading--fill")}>
          {leading}
        </div>
      ) : null}
      {hasMain ? (
        <div className="card__row-main">
          <div className="card__row-title-line">
            <div className="card__row-title-group">
              {title != null ? <div className="card__row-title">{title}</div> : null}
              {titleExtra}
            </div>
            {titleEnd}
          </div>
          {subtitle ? <div className="card__row-subtitle">{subtitle}</div> : null}
        </div>
      ) : null}
      {children ? <div className="card__row-action">{children}</div> : null}
    </div>
  );
}
