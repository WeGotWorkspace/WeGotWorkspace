import { Clock, MapPin } from "lucide-react";
import type { CalendarEventSelectionOrigin } from "@/calendar-core/src/calendar-event-preview";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { CalendarOverlayPopoverShell } from "@/calendar-core/src/calendar-overlay-popover-shell";
import {
  formatAvailabilityPeriodWhen,
  type AvailabilityPreview,
} from "@/calendar-core/src/calendar-availability-preview";
import { UserAvatar } from "@/user-avatar/src/user-avatar";
import { avatarColorForUserId } from "@/user-avatar/src/user-avatar-color";
import "./calendar-availability-popover.css";

export type CalendarAvailabilityPopoverProps = {
  open: boolean;
  preview: AvailabilityPreview;
  labels: CalendarUILabels;
  locale: string;
  /** The grid's display zone, so the time reads like the block. */
  timeZone?: string;
  origin?: CalendarEventSelectionOrigin;
  onClose: () => void;
};

/** Read-only details of a teammate's busy block: who, when, and what when they share it. */
export function CalendarAvailabilityPopover({
  open,
  preview,
  labels,
  locale,
  timeZone,
  origin,
  onClose,
}: CalendarAvailabilityPopoverProps) {
  const { period, name, username } = preview;
  const title = period.title?.trim() ?? "";
  const location = period.location?.trim() ?? "";
  return (
    <CalendarOverlayPopoverShell
      open={open}
      locale={locale}
      origin={origin}
      title={
        <span className="calendar-availability-popover__person">
          <UserAvatar displayName={name} compact size="xs" color={avatarColorForUserId(username)} />
          <span>{name}</span>
        </span>
      }
      ariaLabel={labels.teamAvailabilityPreviewTitle(name)}
      className="calendar-availability-popover"
      bodyClassName="calendar-availability-popover__body"
      titleClassName="calendar-availability-popover__heading"
      onClose={onClose}
    >
      <p className="calendar-availability-popover__title">{title || labels.teamAvailabilityBusy}</p>
      <p className="calendar-availability-popover__row">
        <Clock className="size-3.5 shrink-0" aria-hidden />
        <span>
          <span className="sr-only">{labels.teamAvailabilityPreviewTime}: </span>
          {formatAvailabilityPeriodWhen(period, locale, timeZone)}
        </span>
      </p>
      {location ? (
        <p className="calendar-availability-popover__row">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span>
            <span className="sr-only">{labels.teamAvailabilityPreviewLocation}: </span>
            {location}
          </span>
        </p>
      ) : null}
      {title || location ? null : (
        <p className="calendar-availability-popover__hint">
          {labels.teamAvailabilityPreviewNoDetails}
        </p>
      )}
    </CalendarOverlayPopoverShell>
  );
}
