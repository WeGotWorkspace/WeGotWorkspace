import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  calendarEventFormIsValid,
  calendarEventToForm,
  createIntentToForm,
  emptyCalendarEventForm,
  formToDraft,
  formToPatch,
} from "@/calendar-core/src/calendar-editor-model";

const timedEvent = {
  "@type": "Event",
  id: "ev-1",
  uid: "urn:uuid:ev-1",
  calendarIds: { work: true },
  title: "Design review",
  start: "2033-01-12T14:00:00",
  duration: "PT1H30M",
  timeZone: "Etc/UTC",
  locations: { office: { "@type": "Location", name: "Room 2.1" } },
} as JmapCalendarEvent;

const allDayEvent = {
  "@type": "Event",
  id: "ev-2",
  uid: "urn:uuid:ev-2",
  calendarIds: { default: true },
  title: "Offsite",
  start: "2033-01-17T00:00:00",
  duration: "P2D",
  showWithoutTime: true,
} as JmapCalendarEvent;

describe("calendarEventToForm", () => {
  it("splits a timed event into date/time fields", () => {
    const form = calendarEventToForm(timedEvent);
    expect(form).toMatchObject({
      title: "Design review",
      calendarId: "work",
      allDay: false,
      startDate: "2033-01-12",
      startTime: "14:00",
      endDate: "2033-01-12",
      endTime: "15:30",
      location: "Room 2.1",
    });
  });

  it("shows the inclusive last day for all-day events", () => {
    const form = calendarEventToForm(allDayEvent);
    expect(form).toMatchObject({
      allDay: true,
      startDate: "2033-01-17",
      endDate: "2033-01-18",
    });
  });
});

describe("formToDraft", () => {
  it("round-trips a timed form to start + duration", () => {
    const draft = formToDraft(calendarEventToForm(timedEvent));
    expect(draft.start).toBe("2033-01-12T14:00:00");
    expect(draft.duration).toBe("PT1H30M");
    expect(draft.calendarId).toBe("work");
    expect(draft.location).toBe("Room 2.1");
  });

  it("round-trips an all-day form to an exclusive-end day duration", () => {
    const draft = formToDraft(calendarEventToForm(allDayEvent));
    expect(draft.start).toBe("2033-01-17T00:00:00");
    expect(draft.duration).toBe("P2D");
    expect(draft.allDay).toBe(true);
  });

  it("spans days for overnight timed events", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12", "23:00"),
      title: "Night shift",
      endDate: "2033-01-13",
      endTime: "01:00",
    };
    expect(formToDraft(form).duration).toBe("PT2H");
  });
});

describe("createIntentToForm", () => {
  it("prefills a timed drag range", () => {
    const form = createIntentToForm("work", {
      start: Temporal.PlainDateTime.from("2033-01-12T14:00:00"),
      end: Temporal.PlainDateTime.from("2033-01-12T15:30:00"),
    });
    expect(form).toMatchObject({
      calendarId: "work",
      allDay: false,
      startDate: "2033-01-12",
      startTime: "14:00",
      endDate: "2033-01-12",
      endTime: "15:30",
      title: "",
    });
  });

  it("uses inclusive last day for all-day ranges", () => {
    const form = createIntentToForm("default", {
      start: Temporal.PlainDateTime.from("2033-01-17T00:00:00"),
      end: Temporal.PlainDateTime.from("2033-01-19T00:00:00"),
      allDay: true,
      title: "  ",
    });
    expect(form).toMatchObject({
      allDay: true,
      startDate: "2033-01-17",
      endDate: "2033-01-18",
      title: "",
    });
  });
});

describe("calendarEventFormIsValid", () => {
  it("accepts a defaulted form once titled", () => {
    const form = { ...emptyCalendarEventForm("default", "2033-01-12"), title: "x" };
    expect(calendarEventFormIsValid(form)).toBe(true);
  });

  it("rejects an empty title and end before start", () => {
    const form = emptyCalendarEventForm("default", "2033-01-12");
    expect(calendarEventFormIsValid(form)).toBe(false);
    const inverted = { ...form, title: "x", endDate: "2033-01-11", endTime: "09:00" };
    expect(calendarEventFormIsValid(inverted)).toBe(false);
  });
});

describe("formToPatch", () => {
  it("emits only changed fields", () => {
    const form = { ...calendarEventToForm(timedEvent), title: "Renamed" };
    expect(formToPatch(form, timedEvent)).toEqual({ title: "Renamed" });
  });

  it("emits time changes as start + duration", () => {
    const form = { ...calendarEventToForm(timedEvent), startTime: "15:00", endTime: "16:00" };
    const patch = formToPatch(form, timedEvent);
    expect(patch.start).toBe("2033-01-12T15:00:00");
    expect(patch.duration).toBe("PT1H");
  });
});
