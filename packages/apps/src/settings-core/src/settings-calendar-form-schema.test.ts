import { describe, expect, it } from "vitest";
import {
  calendarDisplayFormToPrefs,
  calendarDisplayPrefsToForm,
  calendarVisibleHoursStartOptions,
  calendarVisibleHoursStartVisible,
} from "@/settings-core/src/settings-calendar-form-schema";

describe("settings calendar visible hours form", () => {
  it("round-trips a zoom window and omits it for Default", () => {
    expect(
      calendarDisplayFormToPrefs(
        calendarDisplayPrefsToForm({ visibleHours: 12, visibleHoursStart: 8 }),
      ),
    ).toEqual({ visibleHours: 12, visibleHoursStart: 8 });
    expect(calendarDisplayFormToPrefs(calendarDisplayPrefsToForm({}))).toEqual({});
    expect(
      calendarDisplayFormToPrefs(
        calendarDisplayPrefsToForm({ visibleHours: 24, visibleHoursStart: 8 }),
      ),
    ).toEqual({ visibleHours: 24 });
  });

  it("clamps Starts at so the window stays inside the day", () => {
    const values = calendarDisplayPrefsToForm({ visibleHours: 16, visibleHoursStart: 20 });
    expect(calendarDisplayFormToPrefs(values)).toEqual({
      visibleHours: 16,
      visibleHoursStart: 8,
    });
  });

  it("hides Starts at for Default and 24 hours", () => {
    expect(calendarVisibleHoursStartVisible("default")).toBe(false);
    expect(calendarVisibleHoursStartVisible("24")).toBe(false);
    expect(calendarVisibleHoursStartVisible("12")).toBe(true);
  });

  it("limits Starts at options to the remaining hours in the day", () => {
    expect(calendarVisibleHoursStartOptions("12", "8")).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(calendarVisibleHoursStartOptions("12", "20")).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 20,
    ]);
  });
});
