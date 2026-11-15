import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_DISPLAY_PREFS_STORAGE_KEY,
  readCalendarDisplayPrefs,
} from "@/lib/calendar-display-prefs";
import {
  editSettingsField,
  waitForSettingsAutosave,
} from "@/settings-core/src/test-utils/settings-autosave";
import { notifySettingsSliceSaved } from "@/lib/settings-slice-saved";
import { useSettingsCalendarForm } from "@/settings-core/src/use-settings-calendar-form";

vi.mock("@/hooks/use-run-with-app-toast", () => ({
  useRunWithAppToast: () => async (work: () => Promise<unknown>) => {
    try {
      return await work();
    } catch {
      return undefined;
    }
  },
}));

vi.mock("@/lib/settings-slice-saved", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings-slice-saved")>(
    "@/lib/settings-slice-saved",
  );
  return {
    ...actual,
    notifySettingsSliceSaved: vi.fn(actual.notifySettingsSliceSaved),
  };
});

describe("useSettingsCalendarForm onSaved", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    vi.mocked(notifySettingsSliceSaved).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("autosaves display prefs after a change and emits notifySettingsSliceSaved", async () => {
    const { result } = renderHook(() => useSettingsCalendarForm());

    await editSettingsField(result.current.form, "timeZone", "Europe/Amsterdam");
    await editSettingsField(result.current.form, "weekStart", "7");
    await editSettingsField(result.current.form, "inviteCalendarId", "work");
    await editSettingsField(result.current.form, "visibleHours", "16");
    await waitForSettingsAutosave();

    expect(
      JSON.parse(window.localStorage.getItem(CALENDAR_DISPLAY_PREFS_STORAGE_KEY) ?? "{}"),
    ).toEqual({
      timeZone: "Europe/Amsterdam",
      weekStart: 7,
      inviteCalendarId: "work",
      visibleHours: 16,
    });
    expect(readCalendarDisplayPrefs()).toEqual({
      timeZone: "Europe/Amsterdam",
      weekStart: 7,
      inviteCalendarId: "work",
      visibleHours: 16,
    });
    expect(notifySettingsSliceSaved).toHaveBeenCalledWith({
      panelId: "calendar",
      sliceId: "calendar-display",
    });
  });

  it("does not emit notifySettingsSliceSaved when localStorage.setItem fails", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const { result } = renderHook(() => useSettingsCalendarForm());

    await editSettingsField(result.current.form, "timeZone", "Europe/Amsterdam");
    await waitForSettingsAutosave();
    expect(notifySettingsSliceSaved).not.toHaveBeenCalled();
  });
});
