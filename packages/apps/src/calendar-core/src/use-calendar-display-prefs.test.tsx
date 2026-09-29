import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import { writeCalendarDisplayPrefs } from "@/lib/calendar-display-prefs";
import { notifySettingsSliceSaved } from "@/settings-core/src/settings-slice-saved";
import { useCalendarDisplayPrefs } from "@/calendar-core/src/use-calendar-display-prefs";

describe("useCalendarDisplayPrefs", () => {
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("resolves stored locale, timezone, and working hours", () => {
    writeCalendarDisplayPrefs({
      timeZone: "America/New_York",
      locale: "en-US",
      workdayStartHour: 9,
      workdayEndHour: 17,
    });
    const { result } = renderHook(() => useCalendarDisplayPrefs());
    expect(result.current.locale).toBe("en-US");
    expect(result.current.timeZone).toBe("America/New_York");
    expect(result.current.timezone).toBe("America/New_York");
    expect(result.current.visibleHours).toBe(8);
    expect(result.current.visibleHoursStart).toBe(9);
  });

  it("uses the device zone when timezone is unset", () => {
    vi.spyOn(Temporal.Now, "timeZoneId").mockReturnValue("Europe/Berlin");
    const { result } = renderHook(() => useCalendarDisplayPrefs());
    expect(result.current.timeZone).toBe("Europe/Berlin");
    expect(result.current.timezone).toBeUndefined();
    expect(result.current.visibleHours).toBeUndefined();
  });

  it("refreshes after notifySettingsSliceSaved for calendar", () => {
    const { result } = renderHook(() => useCalendarDisplayPrefs());
    expect(result.current.timezone).toBeUndefined();

    writeCalendarDisplayPrefs({ timeZone: "Asia/Tokyo", locale: "ja-JP" });
    act(() => {
      notifySettingsSliceSaved({ panelId: "mail", sliceId: "mail-accounts" });
    });
    expect(result.current.timezone).toBeUndefined();

    act(() => {
      notifySettingsSliceSaved({ panelId: "calendar", sliceId: "calendar-display" });
    });
    expect(result.current.timezone).toBe("Asia/Tokyo");
    expect(result.current.locale).toBe("ja-JP");
  });
});
