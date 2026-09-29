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

  it("resolves stored locale, timezone, and week start", () => {
    writeCalendarDisplayPrefs({
      timeZone: "America/New_York",
      locale: "en-US",
      weekStart: 7,
    });
    const { result } = renderHook(() => useCalendarDisplayPrefs());
    expect(result.current.locale).toBe("en-US");
    expect(result.current.timeZone).toBe("America/New_York");
    expect(result.current.timezone).toBe("America/New_York");
    expect(result.current.weekStart).toBe(7);
  });

  it("uses the device zone and locale week start when prefs are unset", () => {
    vi.spyOn(Temporal.Now, "timeZoneId").mockReturnValue("Europe/Berlin");
    const { result } = renderHook(() => useCalendarDisplayPrefs());
    expect(result.current.timeZone).toBe("Europe/Berlin");
    expect(result.current.timezone).toBe("Europe/Berlin");
    expect(result.current.weekStart).toBeGreaterThanOrEqual(1);
    expect(result.current.weekStart).toBeLessThanOrEqual(7);
  });

  it("refreshes after notifySettingsSliceSaved for calendar", () => {
    vi.spyOn(Temporal.Now, "timeZoneId").mockReturnValue("Europe/Berlin");
    const { result } = renderHook(() => useCalendarDisplayPrefs());
    expect(result.current.timezone).toBe("Europe/Berlin");

    writeCalendarDisplayPrefs({ timeZone: "Asia/Tokyo", locale: "ja-JP", weekStart: 1 });
    act(() => {
      notifySettingsSliceSaved({ panelId: "mail", sliceId: "mail-accounts" });
    });
    expect(result.current.timezone).toBe("Europe/Berlin");

    act(() => {
      notifySettingsSliceSaved({ panelId: "calendar", sliceId: "calendar-display" });
    });
    expect(result.current.timezone).toBe("Asia/Tokyo");
    expect(result.current.locale).toBe("ja-JP");
    expect(result.current.weekStart).toBe(1);
  });
});
