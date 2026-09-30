import { describe, expect, it } from "vitest";
import {
  calendarDisplayFormToPrefs,
  calendarDisplayPrefsToForm,
} from "@/settings-core/src/settings-calendar-form-schema";

describe("settings calendar visible hours form", () => {
  it("round-trips a zoom count and defaults unset prefs to 12 hours", () => {
    expect(calendarDisplayFormToPrefs(calendarDisplayPrefsToForm({ visibleHours: 8 }))).toEqual({
      visibleHours: 8,
    });
    expect(calendarDisplayFormToPrefs(calendarDisplayPrefsToForm({}))).toEqual({
      visibleHours: 12,
    });
    expect(calendarDisplayFormToPrefs(calendarDisplayPrefsToForm({ visibleHours: 24 }))).toEqual({
      visibleHours: 24,
    });
  });

  it("does not persist a start hour", () => {
    expect(
      calendarDisplayFormToPrefs(
        calendarDisplayPrefsToForm({ visibleHours: 12, visibleHoursStart: 8 }),
      ),
    ).toEqual({ visibleHours: 12 });
  });
});
