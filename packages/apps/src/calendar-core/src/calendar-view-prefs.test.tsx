import { afterEach, describe, expect, it } from "vitest";
import {
  CALENDAR_VIEW_PREFS_STORAGE_KEY,
  calendarHiddenCalendars,
  calendarViewPrefs,
  type CalendarViewPrefs,
} from "@/calendar-core/src/calendar-view-prefs";

/** Every field the pre-#1636 store wrote, in its key order. */
const oldPrefs: Required<CalendarViewPrefs> = {
  view: "week",
  presentation: "list",
  hiddenCalendarIds: ["work", "family"],
  knownCalendarIds: ["default", "work", "family"],
  hiddenOverlayTaskListIds: ["sprint"],
  shownAvailabilityIds: ["alice"],
  availabilityCollapsed: true,
  remindersCollapsed: false,
  myCalendarsCollapsed: true,
};

describe("calendarViewPrefs binding", () => {
  afterEach(() => {
    window.localStorage.removeItem(CALENDAR_VIEW_PREFS_STORAGE_KEY);
  });

  it("reads every field written by the old store", () => {
    window.localStorage.setItem("wgw.ui.calendar.viewPrefs", JSON.stringify(oldPrefs));
    expect(calendarViewPrefs.read()).toEqual(oldPrefs);
    expect(calendarHiddenCalendars.read()).toEqual({
      hiddenIds: ["work", "family"],
      knownIds: ["default", "work", "family"],
    });
  });

  it("drops views and presentations the calendar does not know", () => {
    expect(
      calendarViewPrefs.parse(JSON.stringify({ view: "agenda", presentation: "cards" })),
    ).toBeNull();
    expect(calendarViewPrefs.parse(JSON.stringify({ view: "MONTH" }))).toBeNull();
  });

  it("patches route, hidden calendars and overlay ids into the old JSON shape", () => {
    calendarViewPrefs.patch({ view: "year", presentation: "list" });
    calendarHiddenCalendars.write(new Set(["work"]), ["default", "work"]);
    calendarViewPrefs.patch({ hiddenOverlayTaskListIds: ["sprint"] });
    expect(window.localStorage.getItem("wgw.ui.calendar.viewPrefs")).toBe(
      '{"view":"year","presentation":"list","hiddenCalendarIds":["work"],' +
        '"knownCalendarIds":["default","work"],"hiddenOverlayTaskListIds":["sprint"]}',
    );
  });
});
