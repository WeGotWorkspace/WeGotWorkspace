import type { CalendarAccountId } from "../calendar/CalendarAccountId.js";
import type { CalendarId } from "../calendar/CalendarId.js";
import type { CalendarEventPendingOperation } from "./CalendarEventPendingOperation.js";

export type CalendarEventParticipationStatus =
  "needs-action" | "accepted" | "tentative" | "declined" | "delegated";

export type CalendarEventEnvelope = {
  accountId?: CalendarAccountId;
  calendarId?: CalendarId;
  eventId?: string;
  recurrenceId?: string;
  isRecurring?: boolean;
  isException?: boolean;
  pendingOp?: CalendarEventPendingOperation;
  /** Current user's PARTSTAT when they are an attendee (not the organizer). */
  participationStatus?: CalendarEventParticipationStatus;
  /**
   * Render-only overlay (Tasks due dates, teammates' busy blocks). Never
   * persisted through EventsAPI / Calendar JMAP. Task rows omit `calendarId`
   * so calendar hide does not drop them; busy blocks carry their virtual
   * `availability:{username}` calendar and are merged after the filter.
   */
  overlayKind?: "task" | "availability";
  overlayTaskListId?: string;
};
