import { Check, CircleHelp, X } from "lucide-react";
import { Button } from "@/button/src/button";
import { SidebarSection } from "@/sidebar-section/src/sidebar-section";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type {
  CalendarSchedulingNotification,
  CalendarSchedulingRespondStatus,
} from "@/lib/api/wgw/calendar-scheduling";
import "./calendar-invitations-section.css";

export type CalendarInvitationsSectionProps = {
  notifications: CalendarSchedulingNotification[];
  labels: CalendarUILabels;
  busy?: boolean;
  onRespond: (id: string, status: CalendarSchedulingRespondStatus) => void;
  onDismiss: (id: string) => void;
  onOpenEvent?: (eventId: string) => void;
};

export function CalendarInvitationsSection({
  notifications,
  labels,
  busy = false,
  onRespond,
  onDismiss,
  onOpenEvent,
}: CalendarInvitationsSectionProps) {
  const count = notifications.length;
  const title = count > 0 ? `${labels.invitationsSection} (${count})` : labels.invitationsSection;

  return (
    <SidebarSection title={title} className="calendar-invitations">
      {count === 0 ? (
        <li className="calendar-invitations__empty">{labels.invitationsEmpty}</li>
      ) : (
        notifications.map((notification) => (
          <li key={notification.id} className="calendar-invitations__item">
            <button
              type="button"
              className="calendar-invitations__open"
              disabled={!notification.eventId || !onOpenEvent}
              onClick={() => notification.eventId && onOpenEvent?.(notification.eventId)}
            >
              <span className="calendar-invitations__title">
                {notification.title || labels.untitledEvent}
              </span>
              {notification.organizerName || notification.organizerEmail ? (
                <span className="calendar-invitations__meta">
                  {notification.organizerName || notification.organizerEmail}
                </span>
              ) : null}
            </button>
            {notification.method === "REQUEST" ? (
              <div className="calendar-invitations__actions">
                <Button
                  size="sm"
                  variant="subtle"
                  label={labels.rsvpAccept}
                  icon={<Check />}
                  disabled={busy}
                  onClick={() => onRespond(notification.id, "accepted")}
                />
                <Button
                  size="sm"
                  variant="subtle"
                  label={labels.rsvpMaybe}
                  icon={<CircleHelp />}
                  disabled={busy}
                  onClick={() => onRespond(notification.id, "tentative")}
                />
                <Button
                  size="sm"
                  variant="subtle"
                  label={labels.rsvpDecline}
                  icon={<X />}
                  disabled={busy}
                  onClick={() => onRespond(notification.id, "declined")}
                />
              </div>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                label={labels.invitationsDismiss}
                disabled={busy}
                onClick={() => onDismiss(notification.id)}
              />
            )}
          </li>
        ))
      )}
    </SidebarSection>
  );
}
