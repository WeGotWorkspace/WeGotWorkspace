import type { ReactNode } from "react";
import { CalendarDays, MapPin, Pencil, Repeat, StickyNote, Users } from "lucide-react";
import { Button } from "@/button/src/button";
import {
  isSessionEventInvitee,
  sessionEventInviteeStatus,
} from "@/calendar-core/src/calendar-attendees";
import {
  detailsPopoverAnchorOrigin,
  detailsPopoverShouldDock,
  eventPreviewInviteeNames,
  eventPreviewNotesExcerpt,
  eventPreviewRepeatLabel,
  formatEventPreviewWhen,
  type CalendarEventPreviewModel,
  type CalendarEventSelectionOrigin,
} from "@/calendar-core/src/calendar-event-preview";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { CalendarRsvpActions } from "@/calendar-core/src/calendar-rsvp-actions";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import { Popover, PopoverAnchor, PopoverContent } from "@/ui/popover";
import "./calendar-event-details-popover.css";

export type CalendarEventDetailsPopoverProps = {
  open: boolean;
  preview: CalendarEventPreviewModel | null;
  calendars: CalendarInfo[];
  labels: CalendarUILabels;
  locale: string;
  origin?: CalendarEventSelectionOrigin;
  canEdit?: boolean;
  busy?: boolean;
  sessionEmail?: string;
  untitledLabel: string;
  onClose: () => void;
  onEdit?: () => void;
  onRsvp?: (status: CalendarSchedulingRespondStatus) => void | Promise<void>;
};

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="calendar-event-details-popover__row">
      <span className="calendar-event-details-popover__icon" aria-hidden>
        {icon}
      </span>
      <div className="calendar-event-details-popover__row-text">
        <p className="calendar-event-details-popover__dt">{label}</p>
        <p className="calendar-event-details-popover__dd">{value}</p>
      </div>
    </div>
  );
}

export function CalendarEventDetailsPopover({
  open,
  preview,
  calendars,
  labels,
  locale,
  origin,
  canEdit = false,
  busy = false,
  sessionEmail,
  untitledLabel,
  onClose,
  onEdit,
  onRsvp,
}: CalendarEventDetailsPopoverProps) {
  if (!preview) return null;

  const form = preview.form;
  const calendar = calendars.find((entry) => entry.id === form.calendarId);
  const title = form.title.trim() || untitledLabel;
  const when = formatEventPreviewWhen(form, locale);
  const notes = eventPreviewNotesExcerpt(form.description);
  const repeat = eventPreviewRepeatLabel(form, locale);
  const invitees = eventPreviewInviteeNames(form.attendees, labels);
  const showRsvp = Boolean(onRsvp) && isSessionEventInvitee(form.attendees, sessionEmail);
  const rsvpStatus = sessionEventInviteeStatus(form.attendees, sessionEmail);
  const docked = detailsPopoverShouldDock(origin);
  const placementOrigin = origin && !docked ? detailsPopoverAnchorOrigin(origin) : origin;
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

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      modal
    >
      <PopoverAnchor asChild>
        <span
          className={[
            "calendar-event-details-popover__anchor",
            docked ? "calendar-event-details-popover__anchor--docked" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          style={anchorStyle}
          aria-hidden
        />
      </PopoverAnchor>
      <PopoverContent
        align="center"
        side="bottom"
        sideOffset={8}
        collisionPadding={16}
        avoidCollisions={!docked}
        className={[
          "calendar-dialog-surface calendar-event-details-popover",
          docked ? "calendar-event-details-popover--docked" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={title}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const root = event.currentTarget;
          if (!(root instanceof HTMLElement)) return;
          const focusable = root.querySelector<HTMLElement>(
            "button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])",
          );
          focusable?.focus();
        }}
      >
        <header>
          <h2 className="calendar-event-details-popover__title">
            {calendar ? (
              <span
                className="calendar-event-details-popover__swatch"
                style={{ backgroundColor: calendar.color }}
                aria-hidden
              />
            ) : null}
            {title}
          </h2>
        </header>
        <div className="calendar-event-details-popover__details">
          <DetailRow
            icon={<CalendarDays className="size-4" />}
            label={labels.eventWhenSectionTitle}
            value={when}
          />
          {form.location.trim() ? (
            <DetailRow
              icon={<MapPin className="size-4" />}
              label={labels.eventLocationLabel}
              value={form.location.trim()}
            />
          ) : null}
          {repeat ? (
            <DetailRow
              icon={<Repeat className="size-4" />}
              label={labels.eventRepeatLabel}
              value={repeat}
            />
          ) : null}
          {notes ? (
            <DetailRow
              icon={<StickyNote className="size-4" />}
              label={labels.eventNotesLabel}
              value={notes}
            />
          ) : null}
          {invitees ? (
            <DetailRow
              icon={<Users className="size-4" />}
              label={labels.eventAttendeesLabel}
              value={invitees}
            />
          ) : null}
        </div>
        {showRsvp && onRsvp ? (
          <div className="calendar-event-details-popover__rsvp">
            {form.recurrencePreset !== "none" ? (
              <p className="calendar-event-details-popover__rsvp-hint">{labels.rsvpSeriesHint}</p>
            ) : null}
            <CalendarRsvpActions
              currentStatus={rsvpStatus ?? undefined}
              labels={labels}
              busy={busy}
              size="sm"
              onRespond={onRsvp}
            />
          </div>
        ) : null}
        {canEdit && onEdit ? (
          <footer className="calendar-event-details-popover__footer">
            <Button
              type="button"
              variant="outline"
              icon={<Pencil className="size-3.5" aria-hidden />}
              label={labels.eventDetailsEdit}
              onClick={onEdit}
            />
          </footer>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
