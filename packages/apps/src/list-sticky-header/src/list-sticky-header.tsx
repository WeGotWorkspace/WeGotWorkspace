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
  /** Trailing content on the far end (Meet's call band: who is in the call). */
  end?: ReactNode;
  /**
   * `frost`: the calm list header (Contacts letters, chat days). No rule; the pane fill
   * frosted so rows blur past beneath it; text on the list row text line.
   * `selection`: frost tinted with the selection wash (Meet's "Meeting started" band).
   */
  variant?: "default" | "frost" | "selection";
  className?: string;
};

/** Full-width sticky list section row (hairline + label). Shared by contacts letters, chat days, and calendar list headings. */
export function ListStickyHeader({
  children,
  emphasis,
  rest,
  label,
  id,
  end,
  variant = "default",
  className,
}: ListStickyHeaderProps): ReactNode {
  return (
    <div
      id={id}
      className={cn(
        "list-sticky-header",
        variant !== "default" && "list-sticky-header--frost",
        variant === "selection" && "list-sticky-header--selection",
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
      {end != null ? <div className="list-sticky-header__end">{end}</div> : null}
    </div>
  );
}
