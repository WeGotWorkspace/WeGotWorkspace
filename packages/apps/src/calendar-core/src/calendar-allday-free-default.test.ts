import { describe, expect, it } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import { newEventFreeBusyStatus } from "@/calendar-core/src/calendar-alerts";
import {
  calendarEventToForm,
  createIntentToForm,
  emptyCalendarEventForm,
  formToDraft,
  formToPatch,
  patchCalendarEventForm,
} from "@/calendar-core/src/calendar-editor-model";

/** #1927: new all-day events start Free; timed events keep Busy. */

const storedAllDayBusy = {
  "@type": "Event",
  id: "ev-vacation",
  uid: "urn:uuid:ev-vacation",
  calendarIds: { default: true },
  title: "Vacation",
  start: "2033-01-17T00:00:00",
  duration: "P1D",
  showWithoutTime: true,
  freeBusyStatus: "busy",
} as JmapCalendarEvent;

const storedTimedFree = {
  "@type": "Event",
  id: "ev-focus",
  uid: "urn:uuid:ev-focus",
  calendarIds: { default: true },
  title: "Focus",
  start: "2033-01-12T14:00:00",
  duration: "PT1H",
  timeZone: "Etc/UTC",
  freeBusyStatus: "free",
} as JmapCalendarEvent;

function allDayIntentForm() {
  return createIntentToForm("default", {
    start: Temporal.PlainDateTime.from("2033-01-17T00:00:00"),
    end: Temporal.PlainDateTime.from("2033-01-18T00:00:00"),
    allDay: true,
  });
}

describe("newEventFreeBusyStatus", () => {
  it("is free for all-day and busy for timed", () => {
    expect(newEventFreeBusyStatus(true)).toBe("free");
    expect(newEventFreeBusyStatus(false)).toBe("busy");
  });
});

describe("new event Show as default", () => {
  it("starts a new all-day event as Free and writes it on create", () => {
    const form = allDayIntentForm();
    expect(form.freeBusyStatus).toBe("free");
    expect(formToDraft({ ...form, title: "Deadline" }).freeBusyStatus).toBe("free");
  });

  it("keeps Busy for a new timed event", () => {
    const fromMenu = emptyCalendarEventForm("default", "2033-01-12");
    const fromDrag = createIntentToForm("default", {
      start: Temporal.PlainDateTime.from("2033-01-12T14:00:00"),
      end: Temporal.PlainDateTime.from("2033-01-12T15:00:00"),
      allDay: false,
    });
    expect(fromMenu.freeBusyStatus).toBe("busy");
    expect(fromDrag.freeBusyStatus).toBe("busy");
  });

  it("moves the default along when all-day is toggled in the create dialog", () => {
    const timed = emptyCalendarEventForm("default", "2033-01-12");
    const allDay = patchCalendarEventForm(timed, { allDay: true });
    expect(allDay.freeBusyStatus).toBe("free");
    const backToTimed = patchCalendarEventForm(allDay, { allDay: false });
    expect(backToTimed.freeBusyStatus).toBe("busy");
    expect(patchCalendarEventForm(allDayIntentForm(), { allDay: false }).freeBusyStatus).toBe(
      "busy",
    );
  });

  it("keeps the author's choice once they touched Show as", () => {
    const allDay = allDayIntentForm();
    const chosenBusy = patchCalendarEventForm(allDay, { freeBusyStatus: "busy" });
    expect(patchCalendarEventForm(chosenBusy, { allDay: false }).freeBusyStatus).toBe("busy");
    const timedBackToAllDay = patchCalendarEventForm(
      patchCalendarEventForm(chosenBusy, { allDay: false }),
      { allDay: true },
    );
    expect(timedBackToAllDay.freeBusyStatus).toBe("busy");

    const timed = emptyCalendarEventForm("default", "2033-01-12");
    const chosenFree = patchCalendarEventForm(timed, { freeBusyStatus: "free" });
    expect(patchCalendarEventForm(chosenFree, { allDay: true }).freeBusyStatus).toBe("free");
    // Re-picking the value the default would have chosen still counts as a choice.
    const repicked = patchCalendarEventForm(timed, { freeBusyStatus: "busy" });
    expect(patchCalendarEventForm(repicked, { allDay: true }).freeBusyStatus).toBe("busy");
  });

  it("other edits do not stop the default from following all-day", () => {
    const timed = emptyCalendarEventForm("default", "2033-01-12");
    const titled = patchCalendarEventForm(timed, { title: "Release" });
    expect(patchCalendarEventForm(titled, { allDay: true }).freeBusyStatus).toBe("free");
  });
});

describe("existing events keep their stored Show as", () => {
  it("does not change a stored all-day Busy event when it is opened or toggled", () => {
    const form = calendarEventToForm(storedAllDayBusy);
    expect(form.freeBusyStatus).toBe("busy");
    expect(form.freeBusyStatusFollowsAllDay).toBeUndefined();
    const timed = patchCalendarEventForm(form, { allDay: false });
    expect(timed.freeBusyStatus).toBe("busy");
    expect(patchCalendarEventForm(timed, { allDay: true }).freeBusyStatus).toBe("busy");
    expect(formToPatch({ ...form, title: "Vacation (Rome)" }, storedAllDayBusy)).not.toHaveProperty(
      "freeBusyStatus",
    );
  });

  it("does not change a stored timed Free event when it becomes all-day", () => {
    const form = calendarEventToForm(storedTimedFree);
    const allDay = patchCalendarEventForm(form, { allDay: true });
    expect(allDay.freeBusyStatus).toBe("free");
    const patch = formToPatch(allDay, storedTimedFree);
    expect(patch).not.toHaveProperty("freeBusyStatus");
    expect(patch.allDay).toBe(true);
  });
});
