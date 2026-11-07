import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "@/list-sticky-header/src/list-sticky-header.css";

export type ListStickyHeaderProps = {
  children?: ReactNode;
  /** Bold lead (calendar weekday, chat Today / Yesterday). */
  emphasis?: ReactNode;
  /** Regular remainder (calendar/chat date). */
  rest?: ReactNode;
  /** Accessible name when emphasis/rest are split (flex gap is not a space). */
  label?: string;
  id?: string;
  /**
   * `frost`: the calm list header (Contacts letters, chat days). No rule; the pane fill
   * frosted so rows blur past beneath it; text on the list row text line.
   */
  variant?: "default" | "frost";
  className?: string;
};

/** Full-width sticky list section row (hairline + label). Shared by contacts letters, chat days, and calendar list headings. */
export function ListStickyHeader({
  children,
  emphasis,
  rest,
  label,
  id,
  variant = "default",
  className,
}: ListStickyHeaderProps): ReactNode {
  return (
    <div
      id={id}
      className={cn(
        "list-sticky-header",
        variant === "frost" && "list-sticky-header--frost",
        className,
      )}
      aria-label={label}
    >
      {emphasis != null ? (
        <>
          <span className="list-sticky-header__emphasis">{emphasis}</span>
          {rest != null && rest !== "" ? (
            <span className="list-sticky-header__rest">{rest}</span>
          ) : null}
        </>
      ) : (
        children
      )}
    </div>
  );
}
