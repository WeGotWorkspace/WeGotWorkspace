import { wgwFetch, wgwReadJson } from "@/lib/api/wgw/http";
import type {
  CalendarInvitee,
  CalendarParticipationStatus,
} from "@/calendar-core/src/calendar-attendees";

export type CalendarSchedulingNotification = {
  id: string;
  uid: string;
  method: string;
  title: string;
  organizerEmail: string | null;
  organizerName?: string | null;
  start?: string | null;
  end?: string | null;
  participationStatus: CalendarParticipationStatus;
  eventId?: string | null;
  etag?: string;
};

export type CalendarSchedulingRespondStatus = "accepted" | "tentative" | "declined";

export async function fetchCalendarSchedulingNotifications(): Promise<
  CalendarSchedulingNotification[]
> {
  const response = await wgwFetch("/calendars/scheduling/notifications");
  if (!response.ok) throw new Error("Could not load invitations");
  const body = (await wgwReadJson(response)) as { list?: CalendarSchedulingNotification[] };
  return Array.isArray(body.list) ? body.list : [];
}

export type CalendarInviteesResponse = {
  list: CalendarInvitee[];
  canSubmitEmail: boolean;
};

export async function fetchCalendarSchedulingInvitees(): Promise<CalendarInviteesResponse> {
  const response = await wgwFetch("/calendars/scheduling/invitees");
  if (!response.ok) throw new Error("Could not load invitees");
  const body = (await wgwReadJson(response)) as {
    list?: CalendarInvitee[];
    canSubmitEmail?: boolean;
  };
  return {
    list: Array.isArray(body.list) ? body.list : [],
    canSubmitEmail: body.canSubmitEmail === true,
  };
}

export async function respondCalendarSchedulingNotification(
  notificationId: string,
  participationStatus: CalendarSchedulingRespondStatus,
): Promise<CalendarSchedulingNotification> {
  const response = await wgwFetch(
    `/calendars/scheduling/notifications/${encodeURIComponent(notificationId)}/respond`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participationStatus }),
    },
  );
  if (!response.ok) throw new Error("Could not send RSVP");
  return (await wgwReadJson(response)) as CalendarSchedulingNotification;
}

export async function dismissCalendarSchedulingNotification(notificationId: string): Promise<void> {
  const response = await wgwFetch(
    `/calendars/scheduling/notifications/${encodeURIComponent(notificationId)}`,
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 204) throw new Error("Could not dismiss invitation");
}
