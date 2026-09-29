import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_DISPLAY_PREFS_STORAGE_KEY,
  calendarWeekdayLabel,
  parseCalendarDisplayPrefs,
  readCalendarDisplayPrefs,
  resolveCalendarWeekStart,
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
  weekStart: 7,
  inviteCalendarId: "work",
};

describe("parseCalendarDisplayPrefs", () => {
  it("returns valid fields and drops unknown or invalid values", () => {
    expect(parseCalendarDisplayPrefs(JSON.stringify(validPrefs))).toEqual(validPrefs);
    expect(
      parseCalendarDisplayPrefs(
        JSON.stringify({
          timeZone: "  UTC  ",
          locale: "xx-XX",
          weekStart: 8,
          inviteCalendarId: "  ",
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

describe("resolveCalendarWeekStart", () => {
  it("uses a stored weekday and otherwise the locale first day", () => {
    expect(resolveCalendarWeekStart({ weekStart: 7 }, "nl-NL")).toBe(7);
    expect(resolveCalendarWeekStart({}, "en-US")).toBe(getLocaleFirstDay("en-US"));
  });
});

describe("calendarWeekdayLabel", () => {
  it("names ISO weekdays in the display locale", () => {
    expect(calendarWeekdayLabel(1, "en-US")).toMatch(/monday/i);
    expect(calendarWeekdayLabel(7, "en-US")).toMatch(/sunday/i);
  });
});

function getLocaleFirstDay(locale: string): number {
  const localeInfo = new Intl.Locale(locale) as Intl.Locale & {
    getWeekInfo?: () => { firstDay?: number };
    weekInfo?: { firstDay?: number };
  };
  return localeInfo.getWeekInfo?.()?.firstDay ?? localeInfo.weekInfo?.firstDay ?? 1;
}
