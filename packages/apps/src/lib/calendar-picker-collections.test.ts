import { describe, expect, it, vi } from "vitest";
import {
  loadCalendarPickerCollections,
  MOCK_CALENDAR_PICKER_COLLECTIONS,
} from "@/lib/calendar-picker-collections";

describe("loadCalendarPickerCollections", () => {
  it("returns the mock writable calendars when the live API is off", async () => {
    vi.resetModules();
    expect(await loadCalendarPickerCollections()).toEqual(MOCK_CALENDAR_PICKER_COLLECTIONS);
    expect(MOCK_CALENDAR_PICKER_COLLECTIONS.map((calendar) => calendar.id)).toEqual([
      "default",
      "work",
    ]);
  });
});
