import { createContext } from "@lit/context";
import type {
  AddExceptionInput,
  AddExclusionInput,
  ApplyResult,
  CalendarAccounts,
  CalendarsMap,
  CreateInput,
  EventOperation,
  EventsAPI,
  EventsState,
  MoveInput,
  RemoveExceptionInput,
  RemoveExclusionInput,
  RemoveInput,
  ResizeEndInput,
  ResizeStartInput,
  UpdateInput,
} from "@/lib/calendar-engine";

export type EventsAPIContextValue = {
  getEvents: () => EventsState;
  /** Calendar display metadata keyed by id; empty map when the host has no calendars. */
  getCalendars: () => CalendarsMap;
  /** Distinct {@link CalendarsMap} account ids; empty set when there are no calendars. */
  getCalendarAccounts: () => CalendarAccounts;
  /**
   * Calendar ids whose events are shown (visibility). `undefined` means all calendars in
   * {@link EventsAPIContextValue.getCalendars} are visible (same as `event-calendar` `visibleCalendarIds`).
   */
  getVisibleCalendarIds: () => string[] | undefined;
  /**
   * Calendar id used when creating a new event (e.g. `event-calendar` sidebar selection), or `undefined`
   * when none applies.
   */
  getSelectedCalendarId: () => string | undefined;
  apply: (operation: EventOperation) => ApplyResult;
  getApi: () => EventsAPI;
  create: (input: CreateInput) => ApplyResult;
  update: (input: UpdateInput) => ApplyResult;
  move: (input: MoveInput) => ApplyResult;
  resizeStart: (input: ResizeStartInput) => ApplyResult;
  resizeEnd: (input: ResizeEndInput) => ApplyResult;
  remove: (input: RemoveInput) => ApplyResult;
  addExclusion: (input: AddExclusionInput) => ApplyResult;
  removeExclusion: (input: RemoveExclusionInput) => ApplyResult;
  addException: (input: AddExceptionInput) => ApplyResult;
  removeException: (input: RemoveExceptionInput) => ApplyResult;
};

export const eventsAPIContext = createContext<EventsAPIContextValue>(Symbol("events-api-context"));
