import type { CalendarAccountId } from "../calendar/CalendarAccountId.js";
import type { CalendarId } from "../calendar/CalendarId.js";
import type { CalendarEventPendingOperation } from "./CalendarEventPendingOperation.js";

export type CalendarEventEnvelope = {
  accountId?: CalendarAccountId;
  calendarId?: CalendarId;
  eventId?: string;
  recurrenceId?: string;
  isRecurring?: boolean;
  isException?: boolean;
  pendingOp?: CalendarEventPendingOperation;
};
