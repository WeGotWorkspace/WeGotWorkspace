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
      result.current.form.setValue("weekStart", "7", { shouldDirty: true });
      result.current.form.setValue("inviteCalendarId", "work", { shouldDirty: true });
      await result.current.saveDisplay();
    });

    expect(
      JSON.parse(window.localStorage.getItem(CALENDAR_DISPLAY_PREFS_STORAGE_KEY) ?? "{}"),
    ).toEqual({
      timeZone: "Europe/Amsterdam",
      weekStart: 7,
      inviteCalendarId: "work",
    });
    expect(readCalendarDisplayPrefs()).toEqual({
      timeZone: "Europe/Amsterdam",
      weekStart: 7,
      inviteCalendarId: "work",
    });
    expect(notifySettingsSliceSaved).toHaveBeenCalledWith({
      panelId: "calendar",
      sliceId: "calendar-display",
    });
  });

  it("throws and does not notify when localStorage.setItem fails", async () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const { result } = renderHook(() => useSettingsCalendarForm());

    await expect(
      act(async () => {
        result.current.form.setValue("timeZone", "Europe/Amsterdam", { shouldDirty: true });
        await result.current.saveDisplay();
      }),
    ).rejects.toThrow("Could not save Calendar settings");
    expect(notifySettingsSliceSaved).not.toHaveBeenCalled();
  });
});
