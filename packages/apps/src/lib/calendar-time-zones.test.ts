import { describe, expect, it } from "vitest";
import {
  COMMON_EVENT_TIME_ZONES,
  commonTimeZoneOptions,
  formatTimeZoneLabel,
} from "@/lib/calendar-time-zones";

describe("commonTimeZoneOptions", () => {
  it("lists curated zones and appends an uncommon current value", () => {
    const options = commonTimeZoneOptions("en-US", "Pacific/Honolulu");
    expect(options.some((option) => option.value === "UTC")).toBe(true);
    expect(COMMON_EVENT_TIME_ZONES.includes("Pacific/Honolulu" as never)).toBe(false);
    expect(options.at(-1)?.value).toBe("Pacific/Honolulu");
    expect(formatTimeZoneLabel("UTC", "en-US")).toBe("UTC");
  });
});
