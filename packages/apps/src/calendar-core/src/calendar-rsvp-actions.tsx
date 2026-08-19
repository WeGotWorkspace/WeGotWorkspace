import { useEffect, useState } from "react";
import { Check, CircleHelp, X, type LucideIcon } from "lucide-react";
import {
  normalizeParticipationStatus,
  type CalendarParticipationStatus,
} from "@/calendar-core/src/calendar-attendees";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ui/select";
import "./calendar-rsvp-actions.css";

const RSVP_ACTIONS: {
  kind: "accept" | "maybe" | "decline";
  status: CalendarSchedulingRespondStatus;
  Icon: LucideIcon;
  labelKey: "rsvpAccept" | "rsvpMaybe" | "rsvpDecline";
}[] = [
  { kind: "accept", status: "accepted", Icon: Check, labelKey: "rsvpAccept" },
  { kind: "maybe", status: "tentative", Icon: CircleHelp, labelKey: "rsvpMaybe" },
  { kind: "decline", status: "declined", Icon: X, labelKey: "rsvpDecline" },
];

export function calendarRsvpStatusIcon(
  status: CalendarParticipationStatus,
): LucideIcon | undefined {
  switch (status) {
    case "accepted":
      return Check;
    case "tentative":
      return CircleHelp;
    case "declined":
      return X;
    default:
      return undefined;
  }
}

export function calendarRespondStatus(
  status: CalendarParticipationStatus | string | null | undefined,
): CalendarSchedulingRespondStatus | undefined {
  const normalized = normalizeParticipationStatus(status ?? undefined);
  if (normalized === "accepted" || normalized === "tentative" || normalized === "declined") {
    return normalized;
  }
  return undefined;
}

export type CalendarRsvpActionsSize = "sm" | "lg";

function rsvpActionClass(
  kind: "accept" | "maybe" | "decline",
  selected: boolean,
  size: CalendarRsvpActionsSize,
): string {
  return cn(
    "calendar-rsvp-action",
    `calendar-rsvp-action--${kind}`,
    `calendar-rsvp-action--${size}`,
    selected && "calendar-rsvp-action--selected",
    "calendar-invitation-card__action",
    `calendar-invitation-card__action--${kind}`,
    selected && "calendar-invitation-card__action--selected",
  );
}

export type CalendarRsvpActionsProps = {
  currentStatus?: string;
  labels: CalendarUILabels;
  busy?: boolean;
  size?: CalendarRsvpActionsSize;
  className?: string;
  onRespond: (status: CalendarSchedulingRespondStatus) => void | Promise<void>;
};

export function CalendarRsvpActions({
  currentStatus,
  labels,
  busy = false,
  size = "sm",
  className,
  onRespond,
}: CalendarRsvpActionsProps) {
  const incoming = normalizeParticipationStatus(currentStatus);
  const [optimisticStatus, setOptimisticStatus] = useState<CalendarParticipationStatus | null>(
    null,
  );

  useEffect(() => {
    setOptimisticStatus(null);
  }, [incoming]);

  const status = optimisticStatus ?? incoming;

  return (
    <div className={cn("calendar-rsvp-actions", `calendar-rsvp-actions--${size}`, className)}>
      {RSVP_ACTIONS.map(({ kind, status: value, Icon, labelKey }) => {
        const selected = status === value;
        return (
          <button
            key={kind}
            type="button"
            className={rsvpActionClass(kind, selected, size)}
            aria-pressed={selected}
            disabled={busy}
            onClick={(event) => {
              event.stopPropagation();
              setOptimisticStatus(value);
              void Promise.resolve(onRespond(value)).catch(() => {
                setOptimisticStatus(null);
              });
            }}
          >
            <Icon
              className={cn(
                "calendar-rsvp-action-icon",
                `calendar-rsvp-action-icon--${size}`,
                "calendar-invitation-card__action-icon",
              )}
              aria-hidden
            />
            {labels[labelKey]}
          </button>
        );
      })}
    </div>
  );
}

export type CalendarRsvpSelectProps = {
  value?: CalendarSchedulingRespondStatus | "";
  labels: CalendarUILabels;
  busy?: boolean;
  className?: string;
  onChange: (status: CalendarSchedulingRespondStatus) => void;
};

/** Deferred RSVP control for the invitee event-dialog footer. Sidebar keeps CalendarRsvpActions. */
export function CalendarRsvpSelect({
  value,
  labels,
  busy = false,
  className,
  onChange,
}: CalendarRsvpSelectProps) {
  const selected = RSVP_ACTIONS.find((action) => action.status === value);

  return (
    <Select
      value={selected ? selected.status : undefined}
      onValueChange={(next) => onChange(next as CalendarSchedulingRespondStatus)}
      disabled={busy}
    >
      <SelectTrigger
        className={cn(
          "calendar-rsvp-select",
          selected && `calendar-rsvp-select--${selected.kind}`,
          selected && "calendar-rsvp-select--selected",
          className,
        )}
        aria-label={labels.rsvpLabel}
      >
        <SelectValue placeholder={labels.rsvpRespond} />
      </SelectTrigger>
      <SelectContent className="calendar-rsvp-select__menu">
        {RSVP_ACTIONS.map(({ kind, status, Icon, labelKey }) => (
          <SelectItem
            key={kind}
            value={status}
            className={cn("calendar-rsvp-select__item", `calendar-rsvp-select__item--${kind}`)}
          >
            <span className="calendar-rsvp-select__option">
              <Icon className="calendar-rsvp-select__icon" aria-hidden />
              {labels[labelKey]}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
