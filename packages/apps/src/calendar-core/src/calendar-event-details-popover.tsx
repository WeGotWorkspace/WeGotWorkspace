import { createElement, type ReactNode } from "react";
import {
  Bell,
  CalendarDays,
  Circle,
  MapPin,
  Repeat,
  StickyNote,
  Trash2,
  Users,
} from "lucide-react";
import { IconButton } from "@/button/src/button";
import {
  isSessionEventInvitee,
  isSessionEventOrganizer,
  sessionEventInviteeStatus,
} from "@/calendar-core/src/calendar-attendees";
import { isCalendarEventFormReadOnly } from "@/calendar-core/src/calendar-collection-write";
import {
  detailsPopoverAnchorOrigin,
  detailsPopoverShouldDock,
  eventPreviewAlarmSummary,
  eventPreviewInviteeNames,
  eventPreviewNotesExcerpt,
  eventPreviewRepeatLabel,
  formatEventPreviewWhen,
  type CalendarEventPreviewModel,
  type CalendarEventSelectionOrigin,
} from "@/calendar-core/src/calendar-event-preview";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import { CalendarMeetJoin } from "@/calendar-core/src/calendar-meet-join";
import type { CalendarMeetOperations } from "@/calendar-core/src/calendar-meet-link";
import { CalendarRsvpActions } from "@/calendar-core/src/calendar-rsvp-actions";
import { DEFAULT_CALENDAR_COLOR } from "@/calendar-core/src/calendar-calendar-dialog";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import {
  CalendarEventForm,
  type CalendarEventFormProps,
} from "@/calendar-core/src/calendar-event-form";
import { useIsMobile } from "@/hooks/use-mobile";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/ui/dialog";
import { Popover, PopoverAnchor, PopoverContent } from "@/ui/popover";
import "@/lib/calendar-elements/EventCard/EventCard";
import "./calendar-event-details-popover.css";

export type CalendarEventDetailsPopoverEditProps = Omit<
  CalendarEventFormProps,
  "mode" | "calendars" | "labels" | "locale" | "className" | "autoFocusTitle"
> & {
  /** Defaults to edit (interactive selection). Pass create for pointer/drag create; invitation for invitee RSVP. */
  mode?: "create" | "edit" | "invitation";
};

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
  pendingSync?: boolean;
  onClose: () => void;
  /** When set, the popover hosts the shared editable event form (writable organizer path). */
  edit?: CalendarEventDetailsPopoverEditProps;
  onDelete?: () => void;
  onRsvp?: (status: CalendarSchedulingRespondStatus) => void | Promise<void>;
  meetOperations?: CalendarMeetOperations;
  workspaceOrigin?: string;
  onJoinMeeting?: (href: string) => void;
};

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="calendar-event-details-popover__row">
      <span className="calendar-event-details-popover__icon" aria-hidden>
        {icon}
      </span>
      <p className="calendar-event-details-popover__dd">
        <span className="sr-only">{label}. </span>
        {value}
      </p>
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
  pendingSync = false,
  onClose,
  edit,
  onDelete,
  onRsvp,
  meetOperations,
  workspaceOrigin = typeof window !== "undefined" ? window.location.origin : "",
  onJoinMeeting,
}: CalendarEventDetailsPopoverProps) {
  const isMobile = useIsMobile();

  if (!preview) return null;

  const form = preview.form;
  const calendar = calendars.find((entry) => entry.id === form.calendarId);
  const isOrganizer = isSessionEventOrganizer(form.attendees, sessionEmail);
  const editMode = edit?.mode ?? "edit";
  const invitationMode = editMode === "invitation";
  const formReadOnly =
    invitationMode ||
    isCalendarEventFormReadOnly({
      mode: editMode === "create" ? "create" : "edit",
      calendar,
      isOrganizer,
    });
  const editable = Boolean(edit) && (invitationMode || (canEdit && !formReadOnly));
  const showDelete = !editable && canEdit && Boolean(onDelete) && !formReadOnly;
  const title = form.title.trim() || untitledLabel;
  const when = formatEventPreviewWhen(form, locale);
  const location = form.location.trim();
  const notes = eventPreviewNotesExcerpt(form.description);
  const repeat = eventPreviewRepeatLabel(form, locale);
  const invitees = eventPreviewInviteeNames(form.attendees, labels);
  const alarms = eventPreviewAlarmSummary(form.alerts, labels);
  const showRsvp = Boolean(onRsvp) && isSessionEventInvitee(form.attendees, sessionEmail);
  const rsvpStatus = sessionEventInviteeStatus(form.attendees, sessionEmail);
  const eventColor = calendar?.color?.trim() || DEFAULT_CALENDAR_COLOR;
  const showMeet = Boolean(form.meetingUrl.trim());
  const showFooter = !editable && (showMeet || showDelete || showRsvp);
  const dialogLabel = editable ? edit?.form.title.trim() || title : title;
  const shellTitle =
    editable && editMode === "create"
      ? labels.createEventTitle
      : editable && editMode === "edit"
        ? labels.editEventTitle
        : dialogLabel;
  const surfaceBusy = busy || Boolean(edit?.busy);
  const detailRows: ReactNode[] = [
    <DetailRow
      key="when"
      icon={<CalendarDays className="size-3.5" />}
      label={labels.eventWhenSectionTitle}
      value={when}
    />,
  ];
  if (location) {
    detailRows.push(
      <DetailRow
        key="location"
        icon={<MapPin className="size-3.5" />}
        label={labels.eventLocationLabel}
        value={location}
      />,
    );
  }
  if (repeat) {
    detailRows.push(
      <DetailRow
        key="repeat"
        icon={<Repeat className="size-3.5" />}
        label={labels.eventRepeatLabel}
        value={repeat}
      />,
    );
  }
  if (notes) {
    detailRows.push(
      <DetailRow
        key="notes"
        icon={<StickyNote className="size-3.5" />}
        label={labels.eventNotesLabel}
        value={notes}
      />,
    );
  }
  if (invitees) {
    detailRows.push(
      <DetailRow
        key="invitees"
        icon={<Users className="size-3.5" />}
        label={labels.eventAttendeesLabel}
        value={invitees}
      />,
    );
  }
  if (alarms) {
    detailRows.push(
      <DetailRow
        key="alarms"
        icon={<Bell className="size-3.5" />}
        label={labels.eventAlarmsLabel}
        value={alarms}
      />,
    );
  }
  const docked = !isMobile && detailsPopoverShouldDock(origin);
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

  const dismiss = () => {
    if (editable && edit) {
      edit.onClose();
      return;
    }
    onClose();
  };

  const body =
    editable && edit ? (
      <CalendarEventForm
        calendars={calendars}
        labels={labels}
        locale={locale}
        busy={surfaceBusy}
        autoFocusTitle={editMode === "create"}
        controlSize={isMobile ? "md" : "sm"}
        collisionContentClassName="calendar-dialog-surface calendar-event-dialog"
        {...edit}
        mode={editMode}
      />
    ) : (
      <>
        <div className="calendar-event-details-popover__body">
          {createElement(
            "event-card",
            {
              class: "calendar-event-details-popover__event",
              layout: "flow",
              lang: locale,
              summary: title,
              color: eventColor,
              recurring: form.recurrencePreset !== "none",
              "data-selected": "",
            },
            createElement(
              "div",
              { className: "calendar-event-details-popover__details" },
              ...detailRows,
            ),
          )}
          {showRsvp && onRsvp && form.recurrencePreset !== "none" ? (
            <p className="calendar-event-details-popover__rsvp-hint">{labels.rsvpSeriesHint}</p>
          ) : null}
        </div>
        {showFooter ? (
          <footer className="calendar-event-details-popover__footer">
            {showRsvp || showMeet ? (
              <div className="calendar-event-details-popover__footer-primary">
                {showMeet ? (
                  <CalendarMeetJoin
                    href={form.meetingUrl}
                    labels={labels}
                    workspaceOrigin={workspaceOrigin}
                    meetOperations={meetOperations}
                    onJoin={onJoinMeeting}
                  />
                ) : null}
                {showRsvp && onRsvp ? (
                  <CalendarRsvpActions
                    currentStatus={rsvpStatus ?? undefined}
                    labels={labels}
                    busy={busy}
                    size="sm"
                    showLabels
                    onRespond={onRsvp}
                  />
                ) : null}
              </div>
            ) : null}
            {showDelete && onDelete ? (
              <div className="calendar-event-details-popover__footer-actions">
                <IconButton
                  type="button"
                  size="md"
                  variant="outline"
                  severity="danger"
                  label={labels.delete}
                  icon={<Trash2 className="size-3.5" aria-hidden />}
                  disabled={busy}
                  onClick={onDelete}
                />
              </div>
            ) : null}
          </footer>
        ) : null}
      </>
    );

  const pendingSyncBadge = pendingSync ? (
    <span
      className="calendar-event-details-popover__pending-sync"
      role="img"
      aria-label={labels.pendingSync}
    >
      <Circle className="size-2.5" fill="currentColor" strokeWidth={0} />
    </span>
  ) : null;

  if (isMobile) {
    const dialogClassName = [
      "calendar-dialog-surface",
      editable
        ? "calendar-event-dialog"
        : "calendar-event-details-popover calendar-event-details-popover--dialog",
    ].join(" ");
    return (
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !surfaceBusy) dismiss();
        }}
      >
        <DialogContent
          className={dialogClassName}
          lang={locale}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            if (editable && editMode === "create") return;
            event.preventDefault();
            const root = event.currentTarget;
            if (root instanceof HTMLElement) root.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{shellTitle}</DialogTitle>
          </DialogHeader>
          {pendingSyncBadge}
          {body}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) dismiss();
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
        // Prefer beside the event (right → left on collision), vertically centered on the
        // anchor; Radix shifts/flips when the preferred side would clip the viewport.
        side="right"
        align="center"
        sideOffset={8}
        collisionPadding={16}
        sticky="partial"
        avoidCollisions={!docked}
        className={[
          "calendar-dialog-surface calendar-event-details-popover",
          editable ? "calendar-event-details-popover--editable calendar-event-dialog" : "",
          docked ? "calendar-event-details-popover--docked" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        aria-label={dialogLabel}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          const root = event.currentTarget;
          if (root instanceof HTMLElement) root.focus();
        }}
      >
        {pendingSyncBadge}
        {body}
      </PopoverContent>
    </Popover>
  );
}
