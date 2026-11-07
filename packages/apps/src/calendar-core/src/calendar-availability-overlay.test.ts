import { describe, expect, it } from "vitest";
import {
  availabilityCalendarId,
  availabilityPeriodEvent,
  buildAvailabilityOverlayEvents,
  isAvailabilityCalendarId,
  parseAvailabilityOverlayKey,
} from "@/calendar-core/src/calendar-availability-overlay";
import { isRenderOnlyOverlayKey } from "@/calendar-core/src/calendar-render-overlay";

describe("availability overlay", () => {
  it("names a teammate's virtual calendar availability:{username}", () => {
    expect(availabilityCalendarId("alice")).toBe("availability:alice");
    expect(isAvailabilityCalendarId("availability:alice")).toBe(true);
    expect(isAvailabilityCalendarId("work")).toBe(false);
    expect(parseAvailabilityOverlayKey("availability:alice#3")).toEqual({
      username: "alice",
      index: 3,
    });
    expect(isRenderOnlyOverlayKey("availability:alice#3")).toBe(true);
    expect(isRenderOnlyOverlayKey("task:milk")).toBe(true);
    expect(isRenderOnlyOverlayKey("standup")).toBe(false);
  });

  it("keeps a zoned period in its own zone and pins a Z start to UTC", () => {
    const zoned = availabilityPeriodEvent(
      "alice",
      0,
      {
        start: "2026-11-12T09:00:00",
        timeZone: "Europe/Amsterdam",
        duration: "PT1H",
        showWithoutTime: false,
        title: "Roadmap",
        location: "Room 2",
      },
      "Busy",
    )!;
    expect(zoned).toMatchObject({
      overlayKind: "availability",
      calendarId: "availability:alice",
      eventId: "availability:alice#0",
    });
    expect(zoned.data.timeZone).toBe("Europe/Amsterdam");
    expect(zoned.data.summary).toBe("Roadmap");
    expect(zoned.data.location).toBe("Room 2");

    const utc = availabilityPeriodEvent(
      "alice",
      1,
      {
        start: "2026-11-12T08:00:00Z",
        timeZone: null,
        duration: "PT30M",
        showWithoutTime: false,
      },
      "Busy",
    )!;
    expect(utc.data.timeZone).toBe("Etc/UTC");
    expect(utc.data.summary).toBe("Busy");
    expect(utc.data.start.toString()).toBe("2026-11-12T08:00:00");
  });

  it("keeps all-day periods on their dates without a zone", () => {
    const allDay = availabilityPeriodEvent(
      "bob",
      0,
      {
        start: "2026-11-12",
        timeZone: null,
        duration: "P2D",
        showWithoutTime: true,
      },
      "Busy",
    )!;
    expect(allDay.data.allDay).toBe(true);
    expect(allDay.data.timeZone).toBeUndefined();
    expect(allDay.data.start.toString()).toBe("2026-11-12T00:00:00");
  });

  it("builds one keyed event per period and skips unreadable ones", () => {
    const events = buildAvailabilityOverlayEvents(
      new Map([
        [
          "alice",
          [
            {
              start: "2026-11-12T09:00:00",
              timeZone: null,
              duration: "PT1H",
              showWithoutTime: false,
            },
            { start: "not a date", timeZone: null, duration: "PT1H", showWithoutTime: false },
          ],
        ],
      ]),
      "Busy",
    );
    expect([...events.keys()]).toEqual(["availability:alice#0"]);
  });
});
