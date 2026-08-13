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
  resolveCreateIntentAllDay,
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
      timeZone: "UTC",
      location: "Room 2.1",
    });
  });

  it("shows the inclusive last day for all-day events", () => {
    const form = calendarEventToForm(allDayEvent);
    expect(form).toMatchObject({
      allDay: true,
      startDate: "2033-01-17",
      endDate: "2033-01-18",
      timeZone: null,
    });
  });

  it("treats a missing timeZone as floating local wall time", () => {
    const floating = {
      ...timedEvent,
      timeZone: null,
    };
    delete (floating as { timeZone?: string | null }).timeZone;
    expect(calendarEventToForm(floating).timeZone).toBeNull();
  });
});

describe("formToDraft", () => {
  it("round-trips a timed form to start + duration and preserves timeZone", () => {
    const draft = formToDraft(calendarEventToForm(timedEvent));
    expect(draft.start).toBe("2033-01-12T14:00:00");
    expect(draft.duration).toBe("PT1H30M");
    expect(draft.calendarId).toBe("work");
    expect(draft.location).toBe("Room 2.1");
    expect(draft.timeZone).toBe("UTC");
  });

  it("omits timeZone for floating local wall time", () => {
    const form = {
      ...emptyCalendarEventForm("work", "2033-01-12", "14:00"),
      title: "Floating",
      timeZone: null,
    };
    expect(formToDraft(form).timeZone).toBeUndefined();
  });

  it("emits a named IANA timeZone on create", () => {
    const form = {
      ...emptyCalendarEventForm("work", "2033-01-12", "14:00"),
      title: "Amsterdam",
      timeZone: "Europe/Amsterdam",
    };
    expect(formToDraft(form).timeZone).toBe("Europe/Amsterdam");
  });

  it("round-trips an all-day form to an exclusive-end day duration without timeZone", () => {
    const draft = formToDraft(calendarEventToForm(allDayEvent));
    expect(draft.start).toBe("2033-01-17T00:00:00");
    expect(draft.duration).toBe("P2D");
    expect(draft.allDay).toBe(true);
    expect(draft.timeZone).toBeUndefined();
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

  it("includes recurrenceRules for a weekly preset", () => {
    const form = {
      ...emptyCalendarEventForm("work", "2033-01-12"),
      title: "Standup",
      recurrencePreset: "weekly" as const,
    };
    expect(formToDraft(form).recurrenceRules).toEqual([
      {
        "@type": "RecurrenceRule",
        frequency: "weekly",
        byDay: [{ "@type": "NDay", day: "we" }],
      },
    ]);
  });

  it("omits recurrenceRules for does-not-repeat", () => {
    const form = { ...emptyCalendarEventForm("work", "2033-01-12"), title: "Once" };
    expect(formToDraft(form).recurrenceRules).toBeUndefined();
  });
});

describe("resolveCreateIntentAllDay", () => {
  it("treats wall-clock ranges as timed even when allDay was wrongly set", () => {
    expect(
      resolveCreateIntentAllDay({
        start: Temporal.PlainDateTime.from("2033-01-12T14:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-12T15:00:00"),
        allDay: true,
      }),
    ).toBe(false);
  });

  it("treats day-snapped midnight ranges as all-day when flagged or when the flag is omitted", () => {
    const range = {
      start: Temporal.PlainDateTime.from("2033-01-17T00:00:00"),
      end: Temporal.PlainDateTime.from("2033-01-18T00:00:00"),
    };
    expect(resolveCreateIntentAllDay({ ...range, allDay: true })).toBe(true);
    expect(resolveCreateIntentAllDay(range)).toBe(true);
    expect(resolveCreateIntentAllDay({ ...range, allDay: false })).toBe(false);
  });
});

describe("createIntentToForm", () => {
  it("prefills a timed drag range with all-day off", () => {
    const form = createIntentToForm("work", {
      start: Temporal.PlainDateTime.from("2033-01-12T14:00:00"),
      end: Temporal.PlainDateTime.from("2033-01-12T15:30:00"),
      allDay: false,
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

  it("emits calendarId when the event moves to another calendar", () => {
    const form = { ...calendarEventToForm(timedEvent), calendarId: "default" };
    expect(formToPatch(form, timedEvent)).toEqual({ calendarId: "default" });
  });

  it("emits time changes as start + duration", () => {
    const form = { ...calendarEventToForm(timedEvent), startTime: "15:00", endTime: "16:00" };
    const patch = formToPatch(form, timedEvent);
    expect(patch.start).toBe("2033-01-12T15:00:00");
    expect(patch.duration).toBe("PT1H");
  });

  it("emits timeZone when switching floating to a named zone", () => {
    const floating = { ...timedEvent };
    delete (floating as { timeZone?: string | null }).timeZone;
    const form = {
      ...calendarEventToForm(floating),
      timeZone: "Europe/Amsterdam",
    };
    expect(formToPatch(form, floating)).toEqual({ timeZone: "Europe/Amsterdam" });
  });

  it("clears timeZone with null when switching to floating local wall time", () => {
    const form = { ...calendarEventToForm(timedEvent), timeZone: null };
    expect(formToPatch(form, timedEvent)).toEqual({ timeZone: null });
  });

  it("emits UTC when selecting the UTC option", () => {
    const form = {
      ...calendarEventToForm({ ...timedEvent, timeZone: "Europe/Amsterdam" }),
      timeZone: "UTC",
    };
    expect(formToPatch(form, { ...timedEvent, timeZone: "Europe/Amsterdam" })).toEqual({
      timeZone: "UTC",
    });
  });

  it("does not emit a timeZone patch when only Etc/UTC vs UTC spelling differs", () => {
    const form = calendarEventToForm(timedEvent);
    expect(form.timeZone).toBe("UTC");
    expect(formToPatch({ ...form, title: "Same zone" }, timedEvent)).toEqual({
      title: "Same zone",
    });
  });

  it("emits recurrenceRules when a preset is chosen", () => {
    const form = { ...calendarEventToForm(timedEvent), recurrencePreset: "daily" as const };
    expect(formToPatch(form, timedEvent).recurrenceRules).toEqual([
      { "@type": "RecurrenceRule", frequency: "daily" },
    ]);
  });

  it("clears recurrence with null when switching to does-not-repeat", () => {
    const recurring = {
      ...timedEvent,
      recurrenceRules: [{ "@type": "RecurrenceRule" as const, frequency: "daily" as const }],
    };
    const form = calendarEventToForm(recurring);
    expect(form.recurrencePreset).toBe("daily");
    const cleared = { ...form, recurrencePreset: "none" as const };
    expect(formToPatch(cleared, recurring).recurrenceRules).toBeNull();
  });

  it("preserves custom rules on save without emitting a recurrence patch", () => {
    const custom = {
      ...timedEvent,
      recurrenceRules: [
        { "@type": "RecurrenceRule" as const, frequency: "daily" as const, count: 3 },
      ],
    };
    const form = calendarEventToForm(custom);
    expect(form.recurrencePreset).toBe("custom");
    expect(formToPatch({ ...form, title: "Still custom" }, custom)).toEqual({
      title: "Still custom",
    });
  });
});
