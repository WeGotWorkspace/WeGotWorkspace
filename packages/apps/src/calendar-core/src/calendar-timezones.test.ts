import { afterEach, describe, expect, it, vi } from "vitest";
import { Temporal } from "@js-temporal/polyfill";
import {
  COMMON_EVENT_TIME_ZONES,
  FLOATING_TIME_ZONE_VALUE,
  defaultTimedEventTimeZone,
  eventTimeZoneFromSelectValue,
  eventTimeZoneOptions,
  eventTimeZoneSelectValue,
  normalizeEventTimeZone,
} from "@/calendar-core/src/calendar-timezones";

describe("normalizeEventTimeZone", () => {
  it("maps empty and UTC aliases to stable wire values", () => {
    expect(normalizeEventTimeZone(null)).toBeNull();
    expect(normalizeEventTimeZone("")).toBeNull();
    expect(normalizeEventTimeZone("Etc/UTC")).toBe("UTC");
    expect(normalizeEventTimeZone("Europe/Amsterdam")).toBe("Europe/Amsterdam");
  });
});

describe("defaultTimedEventTimeZone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the device IANA timezone from Temporal.Now.timeZoneId", () => {
    vi.spyOn(Temporal.Now, "timeZoneId").mockReturnValue("Europe/Amsterdam");
    expect(defaultTimedEventTimeZone()).toBe("Europe/Amsterdam");
  });

  it("normalizes device Etc/UTC to UTC", () => {
    vi.spyOn(Temporal.Now, "timeZoneId").mockReturnValue("Etc/UTC");
    expect(defaultTimedEventTimeZone()).toBe("UTC");
  });
});

describe("eventTimeZone select mapping", () => {
  it("round-trips floating through the select sentinel", () => {
    expect(eventTimeZoneSelectValue(null)).toBe(FLOATING_TIME_ZONE_VALUE);
    expect(eventTimeZoneFromSelectValue(FLOATING_TIME_ZONE_VALUE)).toBeNull();
    expect(eventTimeZoneFromSelectValue("UTC")).toBe("UTC");
  });

  it("lists floating first and appends uncommon current zones", () => {
    const options = eventTimeZoneOptions("en-US", "Local (floating)", "Pacific/Honolulu");
    expect(options[0]).toEqual({
      value: FLOATING_TIME_ZONE_VALUE,
      label: "Local (floating)",
    });
    expect(options.some((option) => option.value === "UTC")).toBe(true);
    expect(COMMON_EVENT_TIME_ZONES.includes("Pacific/Honolulu" as never)).toBe(false);
    expect(options.at(-1)?.value).toBe("Pacific/Honolulu");
  });
});
