import { Temporal } from "@js-temporal/polyfill";
import { describe, expect, it } from "vitest";
import type {
  CalendarEvent,
  CalendarEventData,
  CalendarRecurrenceRule,
} from "@/lib/calendar-engine";
import type { CalendarEventView } from "../domain/events-api/eventMapBridge.js";
import {
  isCalendarEventException,
  isCalendarEventExcluded,
  isCalendarEventRecurring,
} from "./calendarEventSemantics.js";

const START = Temporal.PlainDateTime.from("2033-01-11T10:00:00");
const END = Temporal.PlainDateTime.from("2033-01-11T11:00:00");
const RECURRENCE_ID = "20330111T100000";
const DAILY: CalendarRecurrenceRule = { freq: "DAILY", interval: 1 };

type EventShape = {
  recurrenceId?: string;
  isRecurring?: boolean;
  isException?: boolean;
  exclusionDates?: Set<string>;
  recurrenceRule?: CalendarRecurrenceRule;
};

/** The time span stays fixed: `CalendarEventData` is an end-or-duration union. */
function eventData(shape: EventShape): CalendarEventData {
  return {
    start: START,
    end: END,
    summary: "Daily",
    exclusionDates: shape.exclusionDates,
    recurrenceRule: shape.recurrenceRule,
  };
}

/** Nested envelope + `data`, as `@lit-calendar/events-api` stores it. */
function apiEvent(shape: EventShape = {}): CalendarEvent {
  return {
    eventId: "ev-1",
    calendarId: "work",
    recurrenceId: shape.recurrenceId,
    isRecurring: shape.isRecurring,
    isException: shape.isException,
    data: eventData(shape),
  };
}

/** Flattened row, as the Lit views hold it. */
function flatEvent(shape: EventShape = {}): CalendarEventView {
  return {
    eventId: "ev-1",
    calendarId: "work",
    recurrenceId: shape.recurrenceId,
    isRecurring: shape.isRecurring,
    isException: shape.isException,
    exclusionDates: shape.exclusionDates,
    recurrenceRule: shape.recurrenceRule,
    summary: "Daily",
    start: START,
    end: END,
  };
}

describe("isCalendarEventExcluded", () => {
  it("is false without a recurrenceId", () => {
    expect(isCalendarEventExcluded(apiEvent())).toBe(false);
    expect(isCalendarEventExcluded(apiEvent({ exclusionDates: new Set([RECURRENCE_ID]) }))).toBe(
      false,
    );
  });

  it("is true when the occurrence is in the series exclusion dates", () => {
    expect(
      isCalendarEventExcluded(
        apiEvent({ recurrenceId: RECURRENCE_ID, exclusionDates: new Set([RECURRENCE_ID]) }),
      ),
    ).toBe(true);
  });

  it("is false when the exclusion set names another occurrence", () => {
    expect(
      isCalendarEventExcluded(
        apiEvent({ recurrenceId: RECURRENCE_ID, exclusionDates: new Set(["20330112T100000"]) }),
      ),
    ).toBe(false);
  });

  it("reads the same fields off a flattened row", () => {
    expect(
      isCalendarEventExcluded(
        flatEvent({ recurrenceId: RECURRENCE_ID, exclusionDates: new Set([RECURRENCE_ID]) }),
      ),
    ).toBe(true);
    expect(isCalendarEventExcluded(flatEvent({ recurrenceId: RECURRENCE_ID }))).toBe(false);
  });
});

describe("isCalendarEventException", () => {
  it("trusts an explicit isException flag", () => {
    expect(isCalendarEventException(apiEvent({ isException: true }))).toBe(true);
    expect(isCalendarEventException(flatEvent({ isException: true }))).toBe(true);
  });

  it("is false without a recurrenceId", () => {
    expect(isCalendarEventException(apiEvent())).toBe(false);
  });

  it("treats a detached occurrence without its own rule as an exception", () => {
    expect(isCalendarEventException(apiEvent({ recurrenceId: RECURRENCE_ID }))).toBe(true);
  });

  it("is false for an excluded occurrence", () => {
    expect(
      isCalendarEventException(
        apiEvent({ recurrenceId: RECURRENCE_ID, exclusionDates: new Set([RECURRENCE_ID]) }),
      ),
    ).toBe(false);
  });

  it("is false while the occurrence still carries the series rule", () => {
    expect(
      isCalendarEventException(apiEvent({ recurrenceId: RECURRENCE_ID, recurrenceRule: DAILY })),
    ).toBe(false);
  });
});

describe("isCalendarEventRecurring", () => {
  it("is false for a plain single event", () => {
    expect(isCalendarEventRecurring(apiEvent())).toBe(false);
  });

  it("is true for a master that carries a recurrence rule", () => {
    expect(isCalendarEventRecurring(apiEvent({ recurrenceRule: DAILY }))).toBe(true);
  });

  it("is true for a series row flagged isRecurring", () => {
    expect(isCalendarEventRecurring(apiEvent({ isRecurring: true }))).toBe(true);
  });

  it("is true for an occurrence that still points at its series", () => {
    expect(
      isCalendarEventRecurring(apiEvent({ recurrenceId: RECURRENCE_ID, recurrenceRule: DAILY })),
    ).toBe(true);
  });

  it("is false for an exception and for an exclusion", () => {
    expect(isCalendarEventRecurring(apiEvent({ isException: true }))).toBe(false);
    expect(
      isCalendarEventRecurring(
        apiEvent({ recurrenceId: RECURRENCE_ID, exclusionDates: new Set([RECURRENCE_ID]) }),
      ),
    ).toBe(false);
  });
});
