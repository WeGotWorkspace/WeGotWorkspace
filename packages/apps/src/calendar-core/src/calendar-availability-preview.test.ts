import { describe, expect, it } from "vitest";
import {
  formatAvailabilityPeriodWhen,
  resolveAvailabilityPreview,
} from "@/calendar-core/src/calendar-availability-preview";
import { resolveCalendarOverlayPreview } from "@/calendar-core/src/calendar-overlay-preview";
import type { JmapBusyPeriod } from "@/lib/jmap-client/availability/types";

const roadmap: JmapBusyPeriod = {
  start: "2033-01-12T10:00:00",
  timeZone: "Europe/Amsterdam",
  duration: "PT1H",
  showWithoutTime: false,
  title: "Roadmap review",
  location: "Room Babbage",
};
const periodsByUser = new Map([["ada", [roadmap]]]);
const members = [{ id: "ada", name: "Ada Lovelace", isSelf: false, version: "v1" }];

describe("resolveAvailabilityPreview", () => {
  it("finds the period and the teammate's name for a block key", () => {
    expect(resolveAvailabilityPreview("availability:ada#0", periodsByUser, members)).toEqual({
      key: "availability:ada#0",
      username: "ada",
      name: "Ada Lovelace",
      period: roadmap,
    });
  });

  it("falls back to the username when the teammate is no longer listed", () => {
    expect(resolveAvailabilityPreview("availability:ada#0", periodsByUser, [])?.name).toBe("ada");
  });

  it("returns null for a period that is gone or a key that is not a block", () => {
    expect(resolveAvailabilityPreview("availability:ada#4", periodsByUser, members)).toBeNull();
    expect(resolveAvailabilityPreview("standup", periodsByUser, members)).toBeNull();
  });
});

describe("resolveCalendarOverlayPreview", () => {
  const sources = { taskDueMarkers: [], availability: { periodsByUser, members } };

  it("opens the busy popover for a block, and nothing for a real event", () => {
    expect(resolveCalendarOverlayPreview("availability:ada#0", undefined, sources)).toMatchObject({
      kind: "availability",
      key: "availability:ada#0",
    });
    expect(resolveCalendarOverlayPreview("standup", undefined, sources)).toBeUndefined();
  });

  it("returns null for a block whose teammate was unticked meanwhile", () => {
    expect(resolveCalendarOverlayPreview("availability:grace#0", undefined, sources)).toBeNull();
  });
});

describe("formatAvailabilityPeriodWhen", () => {
  it("converts a zoned period to the viewer's zone", () => {
    expect(formatAvailabilityPeriodWhen(roadmap, "en-GB", "Europe/London")).toMatch(
      /^Wed 12 Jan, 09:00\s*–\s*10:00$/,
    );
  });

  it("reads a Z start as UTC", () => {
    const utc: JmapBusyPeriod = {
      start: "2033-01-12T10:00:00Z",
      timeZone: null,
      duration: "PT30M",
      showWithoutTime: false,
    };
    expect(formatAvailabilityPeriodWhen(utc, "en-GB", "Europe/Amsterdam")).toMatch(
      /^Wed 12 Jan, 11:00\s*–\s*11:30$/,
    );
  });

  it("keeps a floating period's wall clock", () => {
    const floating: JmapBusyPeriod = {
      start: "2033-01-12T10:00:00",
      timeZone: null,
      duration: "PT1H",
      showWithoutTime: false,
    };
    expect(formatAvailabilityPeriodWhen(floating, "en-GB", "America/New_York")).toMatch(
      /^Wed 12 Jan, 10:00\s*–\s*11:00$/,
    );
  });

  it("lists the dates of an all-day period", () => {
    const oneDay: JmapBusyPeriod = {
      start: "2033-01-14",
      timeZone: null,
      duration: "P1D",
      showWithoutTime: true,
    };
    expect(formatAvailabilityPeriodWhen(oneDay, "en-GB", "Pacific/Auckland")).toBe("Fri 14 Jan");
    expect(
      formatAvailabilityPeriodWhen({ ...oneDay, duration: "P3D" }, "en-GB", "Pacific/Auckland"),
    ).toMatch(/^Fri 14( Jan)?\s*–\s*Sun 16 Jan$/);
  });

  it("keeps the wall clock of a zone it doesn't know, like the grid", () => {
    const outlook: JmapBusyPeriod = {
      start: "2033-01-12T10:00:00",
      timeZone: "W. Europe Standard Time",
      duration: "PT1H",
      showWithoutTime: false,
    };
    expect(formatAvailabilityPeriodWhen(outlook, "en-GB", "America/New_York")).toMatch(
      /^Wed 12 Jan, 10:00\s*–\s*11:00$/,
    );
  });

  it("reads an all-day period with a time duration without throwing", () => {
    const allDay: JmapBusyPeriod = {
      start: "2033-01-14",
      timeZone: null,
      duration: "PT24H",
      showWithoutTime: true,
    };
    expect(formatAvailabilityPeriodWhen(allDay, "en-GB", "Europe/Amsterdam")).toBe("Fri 14 Jan");
    expect(
      formatAvailabilityPeriodWhen({ ...allDay, duration: "PT36H" }, "en-GB", "Europe/Amsterdam"),
    ).toMatch(/^Fri 14( Jan)?\s*–\s*Sat 15 Jan$/);
  });

  it("returns an empty string for a period that doesn't parse", () => {
    expect(
      formatAvailabilityPeriodWhen({ ...roadmap, duration: "soon" }, "en-GB", "Europe/London"),
    ).toBe("");
  });

  it("ends at the same wall clock as the block across a daylight-saving change", () => {
    const springForward: JmapBusyPeriod = {
      start: "2026-03-08T01:30:00",
      timeZone: "America/New_York",
      duration: "PT2H",
      showWithoutTime: false,
    };
    expect(formatAvailabilityPeriodWhen(springForward, "en-GB", "America/New_York")).toMatch(
      /^Sun 8 Mar, 01:30\s*–\s*03:30$/,
    );
    const dayAcross: JmapBusyPeriod = {
      start: "2026-03-28T10:00:00",
      timeZone: "Europe/Amsterdam",
      duration: "P1D",
      showWithoutTime: false,
    };
    expect(formatAvailabilityPeriodWhen(dayAcross, "en-GB", "America/New_York")).toMatch(
      /^Sat 28 Mar, 05:00\s*–\s*Sun 29 Mar, 04:00$/,
    );
  });
});
