import { describe, expect, it } from "vitest";
import { sortCalendarsForSidebar } from "@/calendar-core/src/calendar-sidebar-order";

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
