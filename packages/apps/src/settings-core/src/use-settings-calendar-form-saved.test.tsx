import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_DISPLAY_PREFS_STORAGE_KEY,
  readCalendarDisplayPrefs,
} from "@/lib/calendar-display-prefs";
import { notifySettingsSliceSaved } from "@/settings-core/src/settings-slice-saved";
import { useSettingsCalendarForm } from "@/settings-core/src/use-settings-calendar-form";

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => work(),
}));

vi.mock("@/settings-core/src/settings-slice-saved", async () => {
  const actual = await vi.importActual<typeof import("@/settings-core/src/settings-slice-saved")>(
    "@/settings-core/src/settings-slice-saved",
  );
  return {
    ...actual,
    notifySettingsSliceSaved: vi.fn(actual.notifySettingsSliceSaved),
  };
});

describe("useSettingsCalendarForm onSaved", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(notifySettingsSliceSaved).mockClear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("persists display prefs and emits notifySettingsSliceSaved", async () => {
    const { result } = renderHook(() => useSettingsCalendarForm());

    await act(async () => {
      result.current.form.setValue("timeZone", "Europe/Amsterdam", { shouldDirty: true });
      result.current.form.setValue("locale", "nl-NL", { shouldDirty: true });
      result.current.form.setValue("workdayStartHour", "9", { shouldDirty: true });
      result.current.form.setValue("workdayEndHour", "17", { shouldDirty: true });
      await result.current.saveDisplay();
    });

    expect(
      JSON.parse(window.localStorage.getItem(CALENDAR_DISPLAY_PREFS_STORAGE_KEY) ?? "{}"),
    ).toEqual({
      timeZone: "Europe/Amsterdam",
      locale: "nl-NL",
      workdayStartHour: 9,
      workdayEndHour: 17,
    });
    expect(readCalendarDisplayPrefs()).toEqual({
      timeZone: "Europe/Amsterdam",
      locale: "nl-NL",
      workdayStartHour: 9,
      workdayEndHour: 17,
    });
    expect(notifySettingsSliceSaved).toHaveBeenCalledWith({
      panelId: "calendar",
      sliceId: "calendar-display",
    });
  });
});
