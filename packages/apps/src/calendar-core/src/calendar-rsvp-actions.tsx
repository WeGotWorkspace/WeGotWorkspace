import { useEffect, useState } from "react";
import { Check, CircleHelp, X, type LucideIcon } from "lucide-react";
import {
  normalizeParticipationStatus,
  type CalendarParticipationStatus,
} from "@/calendar-core/src/calendar-attendees";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import { cn } from "@/lib/utils";
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
  onRespond: (status: CalendarSchedulingRespondStatus) => void;
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
              onRespond(value);
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
