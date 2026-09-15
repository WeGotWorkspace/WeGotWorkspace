import { useEffect, useState } from "react";
import { Check, CircleHelp, Clock, Forward, X, type LucideIcon } from "lucide-react";
import {
  normalizeParticipationStatus,
  type CalendarParticipationStatus,
} from "@/calendar-core/src/calendar-attendees";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarSchedulingRespondStatus } from "@/lib/api/wgw/calendar-scheduling";
import { SegmentedControl } from "@/segmented-control/src/segmented-control";
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
    case "needs-action":
      return Clock;
    case "delegated":
      return Forward;
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

export type CalendarRsvpActionsSize = "xs" | "sm" | "lg";

export type CalendarRsvpActionsProps = {
  currentStatus?: string;
  labels: CalendarUILabels;
  busy?: boolean;
  size?: CalendarRsvpActionsSize;
  /**
   * When true, render Accept / Maybe / Decline labels beside icons.
   * Default stays icon-only unless a callsite opts in (cards, invitation popover).
   */
  showLabels?: boolean;
  className?: string;
  /**
   * Persist the RSVP. Return `false` (or reject) to revert optimistic selection —
   * e.g. when the recurrence-scope dialog is cancelled.
   */
  onRespond: (status: CalendarSchedulingRespondStatus) => void | boolean | Promise<void | boolean>;
};

function segmentedControlSize(size: CalendarRsvpActionsSize) {
  if (size === "lg") return "lg" as const;
  if (size === "xs") return "xs" as const;
  return "md" as const;
}

export function CalendarRsvpActions({
  currentStatus,
  labels,
  busy = false,
  size = "sm",
  showLabels = false,
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
  const selected = calendarRespondStatus(status) ?? null;
  const iconClassName = size === "xs" ? "size-3.5" : "size-4";

  return (
    <div
      className={cn("calendar-rsvp-actions", `calendar-rsvp-actions--${size}`, className)}
      onClick={(event) => event.stopPropagation()}
    >
      <SegmentedControl
        value={selected}
        size={segmentedControlSize(size)}
        disabled={busy}
        aria-label={labels.rsvpLabel}
        onChange={(next) => {
          setOptimisticStatus(next);
          void Promise.resolve(onRespond(next))
            .then((ok) => {
              if (ok === false) setOptimisticStatus(null);
            })
            .catch(() => {
              setOptimisticStatus(null);
            });
        }}
        options={RSVP_ACTIONS.map(({ kind, status: value, Icon, labelKey }) => ({
          value,
          label: labels[labelKey],
          icon: <Icon className={iconClassName} aria-hidden />,
          showLabel: showLabels || undefined,
          severity: kind === "accept" ? "success" : kind === "decline" ? "danger" : undefined,
        }))}
      />
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
