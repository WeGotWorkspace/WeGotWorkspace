import { describe, expect, it } from "vitest";
import {
  ownedAndTeamCalendarsForSidebar,
  sharedWithMeCalendarsForSidebar,
  sortCalendarsForSidebar,
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
    {
      id: "family",
      name: "Family",
      color: "#f59e0b",
      mayShare: false,
      mayWrite: false,
    },
    {
      id: "holidays",
      name: "US Holidays",
      color: "#8b5cf6",
      subscriptionId: "sub-holidays",
      mayWrite: false,
    },
    {
      id: "group-holidays",
      name: "Team Holidays",
      color: "#a855f7",
      scope: "group",
      groupSlug: "eng",
      subscriptionId: "sub-team-holidays",
      mayWrite: false,
    },
  ];

  it("unifies owned, team, and subscription calendars A–Z and keeps ACL sharees out", () => {
    expect(ownedAndTeamCalendarsForSidebar(calendars).map((entry) => entry.id)).toEqual([
      "group-design",
      "group-eng",
      "default",
      "sprint",
      "group-holidays",
      "holidays",
      "work",
    ]);
    expect(sharedWithMeCalendarsForSidebar(calendars).map((entry) => entry.id)).toEqual(["family"]);
  });

  it("keeps a group member who cannot share in My calendars, and prefers isSharee", () => {
    const groupMember: CalendarInfo = {
      id: "group-member",
      name: "Ops",
      color: "#14b8a6",
      scope: "group",
      groupSlug: "ops",
      mayShare: false,
    };
    const inboundInbox: CalendarInfo = {
      id: "shared-inbox",
      name: "Inbox",
      color: "#f97316",
      isSharee: true,
      mayShare: false,
    };
    expect(ownedAndTeamCalendarsForSidebar([groupMember]).map((entry) => entry.id)).toEqual([
      "group-member",
    ]);
    expect(sharedWithMeCalendarsForSidebar([inboundInbox]).map((entry) => entry.id)).toEqual([
      "shared-inbox",
    ]);
  });
});
