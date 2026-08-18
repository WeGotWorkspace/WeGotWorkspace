/**
 * Access rights the current user has on a calendar. Mirrors the JMAP CalendarRights shape
 * (https://jmap.io/spec/calendars-draft/ section 4) but is protocol-agnostic: any backend
 * can populate it. All fields are optional; absence means "unknown", which consumers should
 * treat as permitted (local-only calendars have no rights model).
 */
export type CalendarRights = {
  mayReadFreeBusy?: boolean;
  mayReadItems?: boolean;
  mayWriteAll?: boolean;
  mayWriteOwn?: boolean;
  mayUpdatePrivate?: boolean;
  mayRSVP?: boolean;
  mayShare?: boolean;
  mayDelete?: boolean;
};
