import { describe, expect, it } from "vitest";
import type { Calendar, CalendarsMap } from "@/lib/calendar-engine";
import {
  calendarEntriesByAccount,
  calendarIdsInSidebarOrder,
} from "./calendarIdsInSidebarOrder.js";

function calendar(accountId: string, displayName: string, sortOrder?: number): Calendar {
  return {
    accountId,
    url: `https://dav.example/${accountId}/${displayName}`,
    displayName,
    color: "#336699",
    ...(sortOrder === undefined ? {} : { sortOrder }),
  };
}

describe("calendarEntriesByAccount", () => {
  it("returns no groups for an empty map", () => {
    expect(calendarEntriesByAccount(new Map() as CalendarsMap)).toEqual([]);
  });

  it("groups calendars per account and orders accounts case-insensitively", () => {
    const map: CalendarsMap = new Map([
      ["b1", calendar("Beta", "Work")],
      ["a1", calendar("alpha", "Home")],
      ["b2", calendar("Beta", "Travel")],
    ]);

    expect(calendarEntriesByAccount(map).map((group) => group.accountId)).toEqual([
      "alpha",
      "Beta",
    ]);
    expect(calendarEntriesByAccount(map)[1].entries.map(([id]) => id)).toEqual(["b2", "b1"]);
  });

  it("sorts by sortOrder before display name", () => {
    const map: CalendarsMap = new Map([
      ["late", calendar("acc", "Aaa", 5)],
      ["early", calendar("acc", "Zzz", 1)],
    ]);

    expect(calendarEntriesByAccount(map)[0].entries.map(([id]) => id)).toEqual(["early", "late"]);
  });

  it("treats a missing sortOrder as zero", () => {
    const map: CalendarsMap = new Map([
      ["ordered", calendar("acc", "Aaa", 2)],
      ["unordered", calendar("acc", "Zzz")],
    ]);

    expect(calendarEntriesByAccount(map)[0].entries.map(([id]) => id)).toEqual([
      "unordered",
      "ordered",
    ]);
  });

  it("falls back to a case-insensitive display name when sortOrder ties", () => {
    const map: CalendarsMap = new Map([
      ["second", calendar("acc", "beta", 1)],
      ["first", calendar("acc", "Alpha", 1)],
    ]);

    expect(calendarEntriesByAccount(map)[0].entries.map(([id]) => id)).toEqual(["first", "second"]);
  });
});

describe("calendarIdsInSidebarOrder", () => {
  it("flattens the account groups into one display order", () => {
    const map: CalendarsMap = new Map([
      ["b1", calendar("Beta", "Work", 2)],
      ["a1", calendar("alpha", "Home")],
      ["b2", calendar("Beta", "Travel", 1)],
    ]);

    expect(calendarIdsInSidebarOrder(map)).toEqual(["a1", "b2", "b1"]);
  });

  it("returns an empty list for an empty map", () => {
    expect(calendarIdsInSidebarOrder(new Map() as CalendarsMap)).toEqual([]);
  });
});
