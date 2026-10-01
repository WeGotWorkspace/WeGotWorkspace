import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initialCalendarPickerCollections,
  loadCalendarPickerCollections,
  MOCK_CALENDAR_PICKER_COLLECTIONS,
} from "@/lib/calendar-picker-collections";

const calendarGet = vi.hoisted(() => ({
  current: Promise.resolve({ list: [] as Array<Record<string, unknown>> }),
}));

vi.mock("@/lib/api/wgw/calendar", () => ({
  calendarJmapClient: () => ({
    isConnected: true,
    connect: () => Promise.resolve(),
    primaryAccountId: () => "acct",
  }),
}));

vi.mock("@/lib/jmap-client", () => ({
  JmapCalendarsClient: class {
    getCalendars() {
      return calendarGet.current;
    }
  },
}));

afterEach(() => {
  calendarGet.current = Promise.resolve({ list: [] });
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

  it("keeps a server isDefault false for a calendar whose id is default", async () => {
    vi.stubEnv("VITE_WGW_USE_LIVE_API", "1");
    calendarGet.current = Promise.resolve({
      list: [
        { id: "default", name: "Group calendar", isDefault: false },
        { id: "personal", name: "Calendar", isDefault: true },
      ],
    });
    const loaded = await loadCalendarPickerCollections();
    expect(loaded.find((calendar) => calendar.id === "default")?.isDefault).toBe(false);
    expect(loaded.find((calendar) => calendar.id === "personal")?.isDefault).toBe(true);
  });
});
