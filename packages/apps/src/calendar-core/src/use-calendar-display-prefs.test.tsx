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

  it("resolves stored timezone and week start, and ignores a leftover locale", () => {
    writeCalendarDisplayPrefs({
      timeZone: "America/New_York",
      weekStart: 7,
      inviteCalendarId: "work",
    });
    window.localStorage.setItem(
      "wgw.ui.calendar.displayPrefs",
      JSON.stringify({
        timeZone: "America/New_York",
        locale: "ja-JP",
        weekStart: 7,
        inviteCalendarId: "work",
      }),
    );
    const { result } = renderHook(() => useCalendarDisplayPrefs());
    expect(result.current.locale).not.toBe("ja-JP");
    expect(result.current.timeZone).toBe("America/New_York");
    expect(result.current.weekStart).toBe(7);
    expect(result.current.inviteCalendarId).toBe("work");
    expect(result.current.visibleHours).toBeUndefined();
    expect(result.current.visibleHoursStart).toBeUndefined();
  });

  it("resolves stored visibleHours zoom and start", () => {
    writeCalendarDisplayPrefs({
      visibleHours: 10,
      visibleHoursStart: 7,
    });
    const { result } = renderHook(() => useCalendarDisplayPrefs());
    expect(result.current.visibleHours).toBe(10);
    expect(result.current.visibleHoursStart).toBe(7);
  });

  it("uses the device zone and locale week start when prefs are unset", () => {
    vi.spyOn(Temporal.Now, "timeZoneId").mockReturnValue("Europe/Berlin");
    const { result } = renderHook(() => useCalendarDisplayPrefs());
    expect(result.current.timeZone).toBe("Europe/Berlin");
    expect(result.current.weekStart).toBeGreaterThanOrEqual(1);
    expect(result.current.weekStart).toBeLessThanOrEqual(7);
  });

  it("refreshes after notifySettingsSliceSaved for calendar", () => {
    vi.spyOn(Temporal.Now, "timeZoneId").mockReturnValue("Europe/Berlin");
    const { result } = renderHook(() => useCalendarDisplayPrefs());
    expect(result.current.timeZone).toBe("Europe/Berlin");

    writeCalendarDisplayPrefs({
      timeZone: "Asia/Tokyo",
      weekStart: 1,
      visibleHours: 12,
      visibleHoursStart: 8,
    });
    act(() => {
      notifySettingsSliceSaved({ panelId: "mail", sliceId: "mail-accounts" });
    });
    expect(result.current.timeZone).toBe("Europe/Berlin");

    act(() => {
      notifySettingsSliceSaved({ panelId: "calendar", sliceId: "calendar-display" });
    });
    expect(result.current.timeZone).toBe("Asia/Tokyo");
    expect(result.current.weekStart).toBe(1);
    expect(result.current.visibleHours).toBe(12);
    expect(result.current.visibleHoursStart).toBe(8);
  });

  it("refreshes after a storage event for the calendar prefs key", () => {
    vi.spyOn(Temporal.Now, "timeZoneId").mockReturnValue("Europe/Berlin");
    const { result } = renderHook(() => useCalendarDisplayPrefs());
    expect(result.current.timeZone).toBe("Europe/Berlin");

    window.localStorage.setItem(
      "wgw.ui.calendar.displayPrefs",
      JSON.stringify({ timeZone: "America/Los_Angeles" }),
    );
    act(() => {
      const storageEvent = new Event("storage");
      Object.defineProperty(storageEvent, "key", { value: "wgw.ui.calendar.displayPrefs" });
      window.dispatchEvent(storageEvent);
    });
    expect(result.current.timeZone).toBe("America/Los_Angeles");
  });
});
