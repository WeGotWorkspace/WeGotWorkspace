import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_DISPLAY_PREFS_STORAGE_KEY,
  parseCalendarDisplayPrefs,
  readCalendarDisplayPrefs,
  resolveCalendarVisibleHours,
  writeCalendarDisplayPrefs,
  type CalendarDisplayPrefs,
} from "@/lib/calendar-display-prefs";

function clearStorage(): void {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  }
}

const validPrefs: CalendarDisplayPrefs = {
  timeZone: "Europe/Amsterdam",
  locale: "nl-NL",
  workdayStartHour: 9,
  workdayEndHour: 17,
};

describe("parseCalendarDisplayPrefs", () => {
  it("returns valid fields and drops unknown or invalid values", () => {
    expect(parseCalendarDisplayPrefs(JSON.stringify(validPrefs))).toEqual(validPrefs);
    expect(
      parseCalendarDisplayPrefs(
        JSON.stringify({
          timeZone: "  UTC  ",
          locale: "xx-XX",
          workdayStartHour: 24,
          workdayEndHour: 0,
          extra: true,
        }),
      ),
    ).toEqual({ timeZone: "UTC" });
  });

  it("returns {} for missing, corrupt, or empty payloads", () => {
    expect(parseCalendarDisplayPrefs(null)).toEqual({});
    expect(parseCalendarDisplayPrefs("")).toEqual({});
    expect(parseCalendarDisplayPrefs("{")).toEqual({});
    expect(parseCalendarDisplayPrefs("[]")).toEqual({});
  });
});

describe("readCalendarDisplayPrefs / writeCalendarDisplayPrefs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearStorage();
  });

  it("round-trips stored prefs", () => {
    writeCalendarDisplayPrefs(validPrefs);
    expect(window.localStorage.getItem(CALENDAR_DISPLAY_PREFS_STORAGE_KEY)).toBe(
      JSON.stringify(validPrefs),
    );
    expect(readCalendarDisplayPrefs()).toEqual(validPrefs);
  });

  it("swallows storage failures and no-ops without window", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(readCalendarDisplayPrefs()).toEqual({});

    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => writeCalendarDisplayPrefs(validPrefs)).not.toThrow();

    vi.stubGlobal("window", undefined);
    expect(readCalendarDisplayPrefs()).toEqual({});
    expect(() => writeCalendarDisplayPrefs(validPrefs)).not.toThrow();
  });
});

describe("resolveCalendarVisibleHours", () => {
  it("maps a workday window onto visibleHours / start", () => {
    expect(resolveCalendarVisibleHours(validPrefs)).toEqual({
      visibleHours: 8,
      visibleHoursStart: 9,
    });
  });

  it("keeps a 24-hour grid when hours are unset, partial, or inverted", () => {
    expect(resolveCalendarVisibleHours({})).toEqual({});
    expect(resolveCalendarVisibleHours({ workdayStartHour: 9 })).toEqual({});
    expect(resolveCalendarVisibleHours({ workdayStartHour: 17, workdayEndHour: 9 })).toEqual({});
    expect(resolveCalendarVisibleHours({ workdayStartHour: 9, workdayEndHour: 9 })).toEqual({});
  });
});
