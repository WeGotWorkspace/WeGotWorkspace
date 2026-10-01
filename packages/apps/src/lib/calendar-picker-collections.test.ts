import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initialCalendarPickerCollections,
  loadCalendarPickerCollections,
  MOCK_CALENDAR_PICKER_COLLECTIONS,
} from "@/lib/calendar-picker-collections";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("loadCalendarPickerCollections", () => {
  it("returns the mock writable calendars when the live API is off", async () => {
    vi.resetModules();
    expect(await loadCalendarPickerCollections()).toEqual(MOCK_CALENDAR_PICKER_COLLECTIONS);
    expect(MOCK_CALENDAR_PICKER_COLLECTIONS.map((calendar) => calendar.id)).toEqual([
      "default",
      "work",
    ]);
    expect(MOCK_CALENDAR_PICKER_COLLECTIONS[0]?.isDefault).toBe(true);
  });

  it("seeds the provisioned personal calendar before Calendar/get returns", () => {
    vi.stubEnv("VITE_WGW_USE_LIVE_API", "1");
    expect(initialCalendarPickerCollections()).toEqual([
      { id: "default", name: "Calendar", color: "#6366f1", isDefault: true },
    ]);
  });
});
