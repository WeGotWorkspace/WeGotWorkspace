import { normalizeParticipationStatus } from "@/calendar-core/src/calendar-attendees";
import { DEFAULT_CALENDAR_COLOR } from "@/calendar-core/src/calendar-calendar-dialog";
import { formatInvitationWhen } from "@/calendar-core/src/calendar-invitation-when";
import type { CalendarUILabels } from "@/calendar-core/src/calendar-labels";
import type { CalendarSchedulingNotification } from "@/lib/api/wgw/calendar-scheduling";

export type CalendarInvitationInboxTab = "new" | "responded";

export type InvitationEventCardFields = {
  summary: string;
  time: string;
  location: string;
  color: string;
  cancelled: boolean;
  recurring: boolean;
};

/** iTIP method, uppercased. Missing/blank METHOD defaults to REQUEST. */
export function invitationMethod(notification: CalendarSchedulingNotification): string {
  const method = notification.method?.trim().toUpperCase() ?? "";
  return method === "" ? "REQUEST" : method;
}

export function canRespondInvitation(notification: CalendarSchedulingNotification): boolean {
  return invitationMethod(notification) === "REQUEST" && Boolean(notification.eventId);
}

export function invitationInboxTab(
  notification: CalendarSchedulingNotification,
): CalendarInvitationInboxTab | null {
  if (!isInviteeNotification(notification)) return null;
  return normalizeParticipationStatus(notification.participationStatus) === "needs-action"
    ? "new"
    : "responded";
}

/** Invitee-inbox only: hide CANCEL and anything that is the current user's own event. */
export function isInviteeNotification(
  notification: CalendarSchedulingNotification,
  sessionAddresses: readonly string[] = [],
): boolean {
  if (invitationMethod(notification) === "CANCEL") return false;
  if (sessionAddresses.length === 0) return invitationMethod(notification) === "REQUEST";
  const organizer = notification.organizerEmail?.trim().toLowerCase() ?? "";
  if (!organizer) return invitationMethod(notification) === "REQUEST";
  const aliases = new Set(
    sessionAddresses.map((value) => value.trim().toLowerCase()).filter(Boolean),
  );
  if (aliases.has(organizer)) return false;
  const organizerLocal = organizer.split("@")[0] ?? "";
  return ![...aliases].some((address) => {
    if (address === organizer) return true;
    const local = address.split("@")[0] ?? "";
    return local !== "" && (local === organizer || local === organizerLocal);
  });
}

export function filterInviteeNotifications(
  notifications: CalendarSchedulingNotification[],
  sessionAddresses: readonly string[] = [],
): CalendarSchedulingNotification[] {
  return notifications.filter((notification) =>
    isInviteeNotification(notification, sessionAddresses),
  );
}

export function filterInvitationsByTab(
  notifications: CalendarSchedulingNotification[],
  tab: CalendarInvitationInboxTab,
  sessionAddresses: readonly string[] = [],
): CalendarSchedulingNotification[] {
  return notifications.filter(
    (notification) =>
      invitationInboxTab(notification) === tab &&
      isInviteeNotification(notification, sessionAddresses),
  );
}

export function pendingInvitationCount(notifications: CalendarSchedulingNotification[]): number {
  return filterInvitationsByTab(notifications, "new").length;
}

export function invitationToEventCardFields(
  notification: CalendarSchedulingNotification,
  labels: CalendarUILabels,
  locale: string,
): InvitationEventCardFields {
  return {
    summary: notification.title.trim() || labels.untitledEvent,
    time: formatInvitationWhen(notification.start, notification.end, locale) ?? "",
    location: notification.location?.trim() ?? "",
    color: notification.color?.trim() || DEFAULT_CALENDAR_COLOR,
    cancelled: invitationMethod(notification) === "CANCEL",
    recurring: notification.recurring === true,
  };
}
