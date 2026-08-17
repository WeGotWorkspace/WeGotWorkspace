import { describe, expect, it } from "vitest";
import {
  personalCalendarsForSidebar,
  sortCalendarsForSidebar,
  teamCalendarsForSidebar,
} from "@/calendar-core/src/calendar-sidebar-order";
import type { CalendarInfo } from "@/calendar-core/src/calendar-types";

describe("sortCalendarsForSidebar", () => {
  it("orders by sortOrder ascending, then name", () => {
    const sorted = sortCalendarsForSidebar([
      { id: "c", name: "Charlie", sortOrder: 2 },
      { id: "a", name: "Alpha", sortOrder: 0 },
      { id: "b2", name: "Bravo", sortOrder: 1 },
      { id: "b1", name: "Able", sortOrder: 1 },
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["a", "b1", "b2", "c"]);
  });

  it("treats missing sortOrder as 0", () => {
    const sorted = sortCalendarsForSidebar([
      { id: "z", name: "Zulu" },
      { id: "a", name: "Alpha", sortOrder: 1 },
      { id: "m", name: "Mike" },
    ]);

    expect(sorted.map((entry) => entry.id)).toEqual(["m", "z", "a"]);
  });
});

describe("calendar sidebar sections", () => {
  const calendars: CalendarInfo[] = [
    { id: "default", name: "Personal", color: "#6366f1", sortOrder: 0 },
    { id: "work", name: "Work", color: "#0ea5e9", sortOrder: 1, scope: "personal" },
    {
      id: "group-eng",
      name: "Engineering",
      color: "#22c55e",
      scope: "group",
      groupSlug: "eng",
      sortOrder: 0,
    },
    {
      id: "sprint",
      name: "Sprint",
      color: "#f59e0b",
      scope: "group",
      groupSlug: "eng",
      sortOrder: 1,
    },
    {
      id: "group-design",
      name: "Design",
      color: "#ec4899",
      scope: "group",
      groupSlug: "design",
    },
  ];

  it("keeps personal calendars out of team sections", () => {
    expect(personalCalendarsForSidebar(calendars).map((entry) => entry.id)).toEqual([
      "default",
      "work",
    ]);
  });

  it("lists team calendars in one flat list without group headings", () => {
    expect(teamCalendarsForSidebar(calendars).map((entry) => entry.id)).toEqual([
      "group-design",
      "group-eng",
      "sprint",
    ]);
  });
});
