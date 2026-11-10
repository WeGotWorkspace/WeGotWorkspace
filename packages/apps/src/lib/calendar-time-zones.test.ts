import { describe, expect, it } from "vitest";
import { allTimeZoneIds, formatTimeZoneLabel, timeZoneOptions } from "@/lib/calendar-time-zones";

describe("timeZoneOptions", () => {
  it("lists every runtime zone plus UTC, sorted by label", () => {
    const options = timeZoneOptions("en-US");
    const values = options.map((option) => option.value);
    expect(values).toContain("UTC");
    expect(values).toContain("Pacific/Honolulu");
    expect(values).toContain("Europe/Amsterdam");
    expect(options.length).toBe(allTimeZoneIds().length);
    const labels = options.map((option) => option.label);
    expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, "en-US")));
    expect(formatTimeZoneLabel("UTC", "en-US")).toBe("UTC");
  });

  it("keeps a current value the runtime does not list", () => {
    const options = timeZoneOptions("en-US", "Legacy/Zone");
    expect(options.some((option) => option.value === "Legacy/Zone")).toBe(true);
  });
});
