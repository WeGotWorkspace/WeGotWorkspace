import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CALENDAR_VIEW_PREFS_STORAGE_KEY,
  parseCalendarViewPrefs,
  patchCalendarViewPrefs,
  persistCalendarRoutePrefs,
  persistHiddenCalendarIds,
  readCalendarViewPrefs,
  resolveHiddenCalendarIds,
  writeCalendarViewPrefs,
  type CalendarViewPrefs,
} from "@/calendar-core/src/calendar-view-prefs";

function clearStorage(): void {
  if (typeof window !== "undefined" && window.localStorage) {
    window.localStorage.clear();
  }
}

const validPrefs: CalendarViewPrefs = {
  view: "week",
  presentation: "list",
  hiddenCalendarIds: ["work", "family"],
  knownCalendarIds: ["default", "work", "family"],
};

describe("parseCalendarViewPrefs", () => {
  it("returns valid fields and drops unknown or invalid values", () => {
    expect(parseCalendarViewPrefs(JSON.stringify(validPrefs))).toEqual(validPrefs);
    expect(
      parseCalendarViewPrefs(
        JSON.stringify({
          view: "agenda",
          presentation: "cards",
          hiddenCalendarIds: ["work", 2, "", "family"],
          knownCalendarIds: ["default", "", 3, "work"],
        }),
      ),
    ).toEqual({ hiddenCalendarIds: ["work", "family"], knownCalendarIds: ["default", "work"] });
  });

  it("returns null for missing, corrupt, or empty payloads", () => {
    expect(parseCalendarViewPrefs(null)).toBeNull();
    expect(parseCalendarViewPrefs("")).toBeNull();
    expect(parseCalendarViewPrefs("{")).toBeNull();
    expect(parseCalendarViewPrefs("[]")).toBeNull();
    expect(parseCalendarViewPrefs(JSON.stringify({ view: "MONTH" }))).toBeNull();
  });
});

describe("readCalendarViewPrefs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearStorage();
  });

  it("reads stored prefs when valid", () => {
    window.localStorage.setItem(CALENDAR_VIEW_PREFS_STORAGE_KEY, JSON.stringify(validPrefs));
    expect(readCalendarViewPrefs()).toEqual(validPrefs);
  });

  it("falls back when localStorage throws or window is missing", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(readCalendarViewPrefs()).toBeNull();

    vi.stubGlobal("window", undefined);
    expect(readCalendarViewPrefs()).toBeNull();
  });
});

describe("writeCalendarViewPrefs / patchCalendarViewPrefs", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    clearStorage();
  });

  it("persists a full prefs object", () => {
    writeCalendarViewPrefs(validPrefs);
    expect(window.localStorage.getItem(CALENDAR_VIEW_PREFS_STORAGE_KEY)).toBe(
      JSON.stringify(validPrefs),
    );
  });

  it("merges a patch without dropping other stored fields", () => {
    writeCalendarViewPrefs(validPrefs);
    patchCalendarViewPrefs({ hiddenCalendarIds: ["holidays"], knownCalendarIds: ["holidays"] });
    expect(readCalendarViewPrefs()).toEqual({
      ...validPrefs,
      hiddenCalendarIds: ["holidays"],
      knownCalendarIds: ["holidays"],
    });

    patchCalendarViewPrefs({ view: "day", presentation: "grid" });
    expect(readCalendarViewPrefs()).toEqual({
      view: "day",
      presentation: "grid",
      hiddenCalendarIds: ["holidays"],
      knownCalendarIds: ["holidays"],
    });

    patchCalendarViewPrefs({ hiddenCalendarIds: [] });
    expect(readCalendarViewPrefs()).toEqual({
      view: "day",
      presentation: "grid",
      hiddenCalendarIds: [],
      knownCalendarIds: ["holidays"],
    });
  });

  it("swallows storage write failures and no-ops without window", () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    expect(() => writeCalendarViewPrefs(validPrefs)).not.toThrow();
    expect(() => patchCalendarViewPrefs({ view: "year" })).not.toThrow();

    vi.stubGlobal("window", undefined);
    expect(() => writeCalendarViewPrefs(validPrefs)).not.toThrow();
  });
});

describe("resolveHiddenCalendarIds", () => {
  const calendars = [{ id: "default" }, { id: "work" }, { id: "holidays", isVisible: false }];

  it("uses server visibility when nothing is persisted", () => {
    expect(resolveHiddenCalendarIds(calendars, undefined)).toEqual(["holidays"]);
    expect(resolveHiddenCalendarIds(calendars, {})).toEqual(["holidays"]);
  });

  it("keeps persisted hides that still exist and drops unknown ids", () => {
    expect(
      resolveHiddenCalendarIds(calendars, {
        hiddenCalendarIds: ["work", "gone"],
        knownCalendarIds: ["default", "work", "holidays"],
      }),
    ).toEqual(["work"]);
  });

  it("does not re-hide a server-default-hidden calendar the user already showed", () => {
    expect(
      resolveHiddenCalendarIds(calendars, {
        hiddenCalendarIds: [],
        knownCalendarIds: ["default", "work", "holidays"],
      }),
    ).toEqual([]);
    expect(
      resolveHiddenCalendarIds(calendars, {
        hiddenCalendarIds: ["work"],
      }),
    ).toEqual(["work"]);
  });

  it("hides a new server-default-hidden calendar the device has never seen", () => {
    expect(
      resolveHiddenCalendarIds(calendars, {
        hiddenCalendarIds: ["work"],
        knownCalendarIds: ["default", "work"],
      }),
    ).toEqual(["work", "holidays"]);
  });
});

describe("persist helpers", () => {
  afterEach(() => {
    clearStorage();
  });

  it("writes route and hidden patches independently", () => {
    persistCalendarRoutePrefs("year", "list");
    persistHiddenCalendarIds(new Set(["work"]), ["default", "work", "holidays"]);
    expect(readCalendarViewPrefs()).toEqual({
      view: "year",
      presentation: "list",
      hiddenCalendarIds: ["work"],
      knownCalendarIds: ["default", "work", "holidays"],
    });
  });
});
