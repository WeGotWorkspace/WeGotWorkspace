import { afterEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  calendarEventFormIsValid,
  calendarEventToForm,
  createIntentToForm,
  emptyCalendarEventForm,
  engineEventToForm,
  formToCreateIntent,
  formToDraft,
  formToFullPatch,
  formToPatch,
  patchCalendarEventForm,
  resolveCreateIntentAllDay,
} from "@/calendar-core/src/calendar-editor-model";
import { defaultTimedEventTimeZone } from "@/calendar-core/src/calendar-timezones";

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
      freeBusyStatus: "busy",
      alerts: [],
    });
  });

  it("loads freeBusyStatus and relative alerts", () => {
    const form = calendarEventToForm({
      ...timedEvent,
      freeBusyStatus: "free",
      alerts: {
        alert1: {
          "@type": "Alert",
          action: "display",
          trigger: { "@type": "RelativeAlert", offset: "-PT15M" },
        },
      },
    });
    expect(form.freeBusyStatus).toBe("free");
    expect(form.alerts).toEqual([{ id: "alert1", action: "display", offset: "-PT15M" }]);
  });

  it("maps leftover wire freeBusyStatus tentative to busy", () => {
    const original = { ...timedEvent, freeBusyStatus: "tentative" as const };
    const form = calendarEventToForm(original);
    expect(form.freeBusyStatus).toBe("busy");
    expect(formToDraft(form).freeBusyStatus).toBe("busy");
    expect(formToPatch({ ...form, title: "Renamed" }, original)).toEqual({ title: "Renamed" });
  });

  it("maps leftover wire alert action audio to display", () => {
    const original = {
      ...timedEvent,
      alerts: {
        alert1: {
          "@type": "Alert" as const,
          action: "audio" as const,
          trigger: { "@type": "RelativeAlert" as const, offset: "-PT15M" },
        },
      },
    };
    const form = calendarEventToForm(original);
    expect(form.alerts).toEqual([{ id: "alert1", action: "display", offset: "-PT15M" }]);
    expect(formToDraft(form).alerts).toEqual({
      alert1: {
        "@type": "Alert",
        action: "display",
        trigger: { "@type": "RelativeAlert", offset: "-PT15M" },
      },
    });
    expect(formToPatch({ ...form, title: "Renamed" }, original)).toEqual({ title: "Renamed" });
  });

  it("maps leftover wire alert action email to display and leaves it unwritten unless alarms change", () => {
    const original = {
      ...timedEvent,
      alerts: {
        alert1: {
          "@type": "Alert" as const,
          action: "email" as const,
          trigger: { "@type": "RelativeAlert" as const, offset: "-PT15M" },
        },
      },
    };
    const form = calendarEventToForm(original);
    expect(form.alerts).toEqual([{ id: "alert1", action: "display", offset: "-PT15M" }]);
    expect(formToDraft(form).alerts).toEqual({
      alert1: {
        "@type": "Alert",
        action: "display",
        trigger: { "@type": "RelativeAlert", offset: "-PT15M" },
      },
    });
    expect(formToPatch({ ...form, title: "Renamed" }, original)).toEqual({ title: "Renamed" });
    expect(
      formToPatch(
        { ...form, alerts: [{ id: "alert1", action: "display" as const, offset: "-PT1H" }] },
        original,
      ),
    ).toEqual({
      alerts: {
        alert1: {
          "@type": "Alert",
          action: "display",
          trigger: { "@type": "RelativeAlert", offset: "-PT1H" },
        },
      },
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

describe("emptyCalendarEventForm", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("defaults timed creates to Temporal.Now.timeZoneId", () => {
    vi.spyOn(Temporal.Now, "timeZoneId").mockReturnValue("America/Los_Angeles");
    const form = emptyCalendarEventForm("work", "2033-01-12", "14:00");
    expect(form.allDay).toBe(false);
    expect(form.timeZone).toBe("America/Los_Angeles");
    expect(formToDraft({ ...form, title: "Lunch" }).timeZone).toBe("America/Los_Angeles");
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

  it("emits the device IANA timeZone for a default timed create", () => {
    const form = {
      ...emptyCalendarEventForm("work", "2033-01-12", "14:00"),
      title: "Lunch",
    };
    expect(form.timeZone).toBe(defaultTimedEventTimeZone());
    expect(form.timeZone).toEqual(expect.any(String));
    expect(formToDraft(form).timeZone).toBe(form.timeZone);
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

  it("defaults new events to busy and omits empty alerts", () => {
    const form = { ...emptyCalendarEventForm("work", "2033-01-12"), title: "Once" };
    expect(form.freeBusyStatus).toBe("busy");
    expect(form.alerts).toEqual([]);
    const draft = formToDraft(form);
    expect(draft.freeBusyStatus).toBe("busy");
    expect(draft.alerts).toBeUndefined();
  });

  it("round-trips freeBusyStatus and alerts on create", () => {
    const form = {
      ...emptyCalendarEventForm("work", "2033-01-12"),
      title: "Blocked",
      freeBusyStatus: "free" as const,
      alerts: [{ id: "alert1", action: "display" as const, offset: "-PT15M" }],
    };
    expect(formToDraft(form)).toMatchObject({
      freeBusyStatus: "free",
      alerts: {
        alert1: {
          "@type": "Alert",
          action: "display",
          trigger: { "@type": "RelativeAlert", offset: "-PT15M" },
        },
      },
    });
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it("defaults timed drag-create to the device IANA timezone", () => {
    vi.spyOn(Temporal.Now, "timeZoneId").mockReturnValue("Pacific/Auckland");
    const form = createIntentToForm("work", {
      start: Temporal.PlainDateTime.from("2033-01-12T14:00:00"),
      end: Temporal.PlainDateTime.from("2033-01-12T15:30:00"),
      allDay: false,
    });
    expect(form.timeZone).toBe("Pacific/Auckland");
    expect(formToDraft({ ...form, title: "Drag" }).timeZone).toBe("Pacific/Auckland");
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
      timeZone: null,
    });
    expect(formToDraft({ ...form, title: "Offsite" }).timeZone).toBeUndefined();
  });

  it("formToCreateIntent round-trips timed and exclusive all-day ends", () => {
    const timed = {
      start: Temporal.PlainDateTime.from("2033-01-12T14:00:00"),
      end: Temporal.PlainDateTime.from("2033-01-12T15:30:00"),
      allDay: false,
    };
    expect(formToCreateIntent(createIntentToForm("work", timed))).toEqual({
      calendarId: "work",
      allDay: false,
      start: timed.start,
      end: timed.end,
    });

    const allDay = {
      start: Temporal.PlainDateTime.from("2033-01-17T00:00:00"),
      end: Temporal.PlainDateTime.from("2033-01-19T00:00:00"),
      allDay: true,
      title: "Offsite",
    };
    expect(formToCreateIntent(createIntentToForm("default", allDay))).toEqual({
      calendarId: "default",
      allDay: true,
      start: allDay.start,
      end: allDay.end,
      title: "Offsite",
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

describe("patchCalendarEventForm", () => {
  it("sets end to start + 30 minutes when leaving all-day", () => {
    const form = calendarEventToForm(allDayEvent);
    expect(form).toMatchObject({
      allDay: true,
      startDate: "2033-01-17",
      startTime: "00:00",
      endDate: "2033-01-18",
    });
    const next = patchCalendarEventForm(form, { allDay: false });
    expect(next).toMatchObject({
      allDay: false,
      startDate: "2033-01-17",
      startTime: "00:00",
      endDate: "2033-01-17",
      endTime: "00:30",
      timeZone: defaultTimedEventTimeZone(),
    });
  });

  it("keeps a stored timezone when leaving all-day", () => {
    const form = { ...calendarEventToForm(allDayEvent), timeZone: "Europe/Berlin" };
    expect(patchCalendarEventForm(form, { allDay: false }).timeZone).toBe("Europe/Berlin");
  });

  it("moves end to preserve duration when start time changes", () => {
    const form = calendarEventToForm(timedEvent);
    expect(form).toMatchObject({ startTime: "14:00", endTime: "15:30" });
    const next = patchCalendarEventForm(form, { startTime: "16:00" });
    expect(next).toMatchObject({
      startDate: "2033-01-12",
      startTime: "16:00",
      endDate: "2033-01-12",
      endTime: "17:30",
    });
  });

  it("preserves overnight duration when start date moves", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12", "23:00"),
      endDate: "2033-01-13",
      endTime: "01:00",
    };
    const next = patchCalendarEventForm(form, { startDate: "2033-01-15" });
    expect(next).toMatchObject({
      startDate: "2033-01-15",
      startTime: "23:00",
      endDate: "2033-01-16",
      endTime: "01:00",
    });
  });

  it("coerces end equal to start up to start + 30 minutes", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12", "14:00"),
      endDate: "2033-01-12",
      endTime: "15:00",
    };
    expect(patchCalendarEventForm(form, { endTime: "14:00" })).toMatchObject({
      startTime: "14:00",
      endDate: "2033-01-12",
      endTime: "14:30",
    });
  });

  it("coerces end before start up to start + 30 minutes", () => {
    const form = {
      ...emptyCalendarEventForm("default", "2033-01-12", "14:00"),
      endDate: "2033-01-12",
      endTime: "15:00",
    };
    expect(patchCalendarEventForm(form, { endTime: "13:00" })).toMatchObject({
      startTime: "14:00",
      endTime: "14:30",
    });
  });

  it("does not auto-shift all-day end when start date changes", () => {
    const form = calendarEventToForm(allDayEvent);
    const next = patchCalendarEventForm(form, { startDate: "2033-01-16" });
    expect(next).toMatchObject({
      allDay: true,
      startDate: "2033-01-16",
      endDate: "2033-01-18",
    });
  });
});

describe("recurrence ends (until / count)", () => {
  it("loads until into form fields and round-trips through formToDraft", () => {
    const event = {
      ...timedEvent,
      recurrenceRules: [
        {
          "@type": "RecurrenceRule" as const,
          frequency: "daily" as const,
          until: "2033-02-01T14:00:00",
        },
      ],
    };
    const form = calendarEventToForm(event);
    expect(form).toMatchObject({
      recurrencePreset: "daily",
      recurrenceEnds: "until",
      recurrenceUntilDate: "2033-02-01",
    });
    expect(formToDraft(form).recurrenceRules).toEqual([
      {
        "@type": "RecurrenceRule",
        frequency: "daily",
        until: "2033-02-01T14:00:00",
      },
    ]);
  });

  it("loads count into form fields and round-trips through formToDraft", () => {
    const event = {
      ...timedEvent,
      recurrenceRules: [
        {
          "@type": "RecurrenceRule" as const,
          frequency: "daily" as const,
          count: 8,
        },
      ],
    };
    const form = calendarEventToForm(event);
    expect(form).toMatchObject({
      recurrencePreset: "daily",
      recurrenceEnds: "count",
      recurrenceCount: 8,
    });
    expect(formToDraft(form).recurrenceRules).toEqual([
      { "@type": "RecurrenceRule", frequency: "daily", count: 8 },
    ]);
  });

  it("emits until without count and count without until (mutual exclusion)", () => {
    const base = {
      ...emptyCalendarEventForm("work", "2033-01-12"),
      title: "Series",
      recurrencePreset: "daily" as const,
    };
    const withUntil = formToDraft({
      ...base,
      recurrenceEnds: "until",
      recurrenceUntilDate: "2033-03-01",
      recurrenceCount: 99,
    });
    expect(withUntil.recurrenceRules).toEqual([
      {
        "@type": "RecurrenceRule",
        frequency: "daily",
        until: "2033-03-01T10:00:00",
      },
    ]);
    const withCount = formToDraft({
      ...base,
      recurrenceEnds: "count",
      recurrenceCount: 5,
      recurrenceUntilDate: "2033-03-01",
    });
    expect(withCount.recurrenceRules).toEqual([
      { "@type": "RecurrenceRule", frequency: "daily", count: 5 },
    ]);
  });

  it("clears until and count when Ends is Never", () => {
    const form = {
      ...emptyCalendarEventForm("work", "2033-01-12"),
      title: "Open",
      recurrencePreset: "daily" as const,
      recurrenceEnds: "never" as const,
      recurrenceUntilDate: "2033-03-01",
      recurrenceCount: 5,
    };
    expect(formToDraft(form).recurrenceRules).toEqual([
      { "@type": "RecurrenceRule", frequency: "daily" },
    ]);
  });

  it("patches recurrenceRules when switching ends mode", () => {
    const original = {
      ...timedEvent,
      recurrenceRules: [{ "@type": "RecurrenceRule" as const, frequency: "daily" as const }],
    };
    const form = {
      ...calendarEventToForm(original),
      recurrenceEnds: "count" as const,
      recurrenceCount: 12,
    };
    expect(formToPatch(form, original).recurrenceRules).toEqual([
      { "@type": "RecurrenceRule", frequency: "daily", count: 12 },
    ]);
  });
});

describe("formToPatch", () => {
  it("emits only changed fields", () => {
    const form = { ...calendarEventToForm(timedEvent), title: "Renamed" };
    expect(formToPatch(form, timedEvent)).toEqual({ title: "Renamed" });
  });

  it("emits freeBusyStatus and alerts when they change", () => {
    const form = {
      ...calendarEventToForm(timedEvent),
      freeBusyStatus: "free" as const,
      alerts: [{ id: "alert1", action: "display" as const, offset: "-PT30M" }],
    };
    expect(formToPatch(form, timedEvent)).toEqual({
      freeBusyStatus: "free",
      alerts: {
        alert1: {
          "@type": "Alert",
          action: "display",
          trigger: { "@type": "RelativeAlert", offset: "-PT30M" },
        },
      },
    });
  });

  it("clears alerts with null when the last alarm is removed", () => {
    const original = {
      ...timedEvent,
      alerts: {
        alert1: {
          "@type": "Alert" as const,
          action: "display" as const,
          trigger: { "@type": "RelativeAlert" as const, offset: "-PT15M" },
        },
      },
    };
    const form = { ...calendarEventToForm(original), alerts: [] };
    expect(formToPatch(form, original)).toEqual({ alerts: null });
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
        {
          "@type": "RecurrenceRule" as const,
          frequency: "weekly" as const,
          byDay: [
            { "@type": "NDay" as const, day: "mo" as const },
            { "@type": "NDay" as const, day: "we" as const },
          ],
        },
      ],
    };
    const form = calendarEventToForm(custom);
    expect(form.recurrencePreset).toBe("custom");
    expect(formToPatch({ ...form, title: "Still custom" }, custom)).toEqual({
      title: "Still custom",
    });
  });
});

describe("engineEventToForm", () => {
  it("derives duration from data.end after a resize (duration stripped)", () => {
    const form = engineEventToForm({
      eventId: "ev-1",
      calendarId: "work",
      data: {
        summary: "Standup",
        start: Temporal.PlainDateTime.from("2033-01-10T10:00:00"),
        end: Temporal.PlainDateTime.from("2033-01-10T12:00:00"),
      },
    });
    expect(formToDraft(form).duration).toBe("PT2H");
    expect(formToFullPatch(form).duration).toBe("PT2H");
  });
});
