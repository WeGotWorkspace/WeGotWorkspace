import { Inbox } from "lucide-react";
import { IconButton } from "@/button/src/button";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";

export type CalendarInvitationsTriggerProps = {
  count: number;
  open: boolean;
  labels: CalendarUILabels;
  onToggle: () => void;
};

export function CalendarInvitationsTrigger({
  count,
  open,
  labels,
  onToggle,
}: CalendarInvitationsTriggerProps) {
  const label = open
    ? labels.invitationsToggleHide
    : count > 0
      ? `${labels.invitationsToggleShow} (${count})`
      : labels.invitationsToggleShow;

  return (
    <IconButton
      label={label}
      icon={<Inbox aria-hidden />}
      active={open}
      aria-pressed={open}
      className="calendar-invitations-trigger"
      data-count={count > 0 ? String(count) : undefined}
      onClick={onToggle}
    />
  );
}
