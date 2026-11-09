import type { ReactNode } from "react";
import {
  detailsPopoverAnchorOrigin,
  detailsPopoverShouldDock,
  type CalendarEventSelectionOrigin,
} from "@/calendar-core/src/calendar-event-preview";
import { getLocaleDirection } from "@/lib/calendar-elements/utils/Locale";
import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Popover, PopoverAnchor, PopoverContent } from "@/ui/popover";
import "./calendar-event-details-popover.css";

export type CalendarOverlayPopoverShellProps = {
  open: boolean;
  locale: string;
  origin?: CalendarEventSelectionOrigin;
  /** Heading: the dialog title on phones, the first line of the popover elsewhere. */
  title: ReactNode;
  /** Accessible name of the popover. */
  ariaLabel: string;
  /** Extra class on the popover surface. */
  className: string;
  /** Class of the body wrapper around `title` and `children`. */
  bodyClassName: string;
  titleClassName: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * Read-only details next to a render-only grid card (task due markers, busy
 * blocks): a popover by the card, docked on wide layouts, a dialog on phones.
 */
export function CalendarOverlayPopoverShell({
  open,
  locale,
  origin,
  title,
  ariaLabel,
  className,
  bodyClassName,
  titleClassName,
  onClose,
  children,
}: CalendarOverlayPopoverShellProps) {
  const isMobile = useIsMobile();
  const docked = !isMobile && detailsPopoverShouldDock(origin);
  const placementOrigin =
    origin && !docked ? detailsPopoverAnchorOrigin(origin, getLocaleDirection(locale)) : origin;
  const fallbackLeft = Math.round(globalThis.innerWidth / 2);
  const fallbackTop = Math.round(globalThis.innerHeight * 0.28);
  const anchorStyle = docked
    ? { left: 0, top: 0, width: 0, height: 0 }
    : placementOrigin
      ? {
          left: placementOrigin.left,
          top: placementOrigin.top,
          width: placementOrigin.width,
          height: placementOrigin.height,
        }
      : { left: fallbackLeft, top: fallbackTop, width: 0, height: 0 };

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="calendar-dialog-surface">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <div className={bodyClassName}>{children}</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Popover open={open} onOpenChange={(next) => !next && onClose()}>
      <PopoverAnchor asChild>
        <span
          className={
            docked
              ? "calendar-event-details-popover__anchor calendar-event-details-popover__anchor--docked"
              : "calendar-event-details-popover__anchor"
          }
          style={anchorStyle}
          aria-hidden
        />
      </PopoverAnchor>
      <PopoverContent
        className={
          docked
            ? `calendar-dialog-surface calendar-event-details-popover calendar-event-details-popover--docked ${className}`
            : `calendar-dialog-surface calendar-event-details-popover ${className}`
        }
        aria-label={ariaLabel}
        side="right"
        align="center"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className={bodyClassName}>
          <div className={titleClassName}>{title}</div>
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}
