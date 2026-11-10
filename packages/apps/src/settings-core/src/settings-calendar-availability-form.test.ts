import { describe, expect, it } from "vitest";
import { mockCalendarAvailabilitySettings } from "@/lib/api/mock/calendar-availability-settings";
import {
  calendarAvailabilityToForm,
  calendarAvailabilityUpdateFromForm,
} from "@/settings-core/src/settings-calendar-availability-form";

const loaded = mockCalendarAvailabilitySettings();

describe("calendarAvailabilityToForm", () => {
  it("keeps the switch and each calendar's include and detail, in server order", () => {
    expect(calendarAvailabilityToForm(loaded)).toEqual({
      enabled: false,
      calendars: [
        { calendarId: "default", include: true, detail: "busy" },
        { calendarId: "work", include: true, detail: "busy" },
        { calendarId: "group-editorial", include: true, detail: "busy" },
      ],
    });
  });
});

describe("calendarAvailabilityUpdateFromForm", () => {
  it("sends only the switch when no calendar changed", () => {
    const values = { ...calendarAvailabilityToForm(loaded), enabled: true };
    expect(calendarAvailabilityUpdateFromForm(loaded, values)).toEqual({ enabled: true });
  });

  it("sends only the changed fields of changed calendars", () => {
    const values = calendarAvailabilityToForm(loaded);
    values.calendars[0] = { ...values.calendars[0]!, detail: "details" };
    values.calendars[1] = { ...values.calendars[1]!, include: false };
    expect(calendarAvailabilityUpdateFromForm(loaded, values)).toEqual({
      enabled: false,
      calendars: [
        { calendarId: "default", detail: "details" },
        { calendarId: "work", include: false },
      ],
    });
  });

  it("never sends a detail for a Team calendar", () => {
    const values = calendarAvailabilityToForm(loaded);
    values.calendars[2] = { calendarId: "group-editorial", include: false, detail: "details" };
    expect(calendarAvailabilityUpdateFromForm(loaded, values)).toEqual({
      enabled: false,
      calendars: [{ calendarId: "group-editorial", include: false }],
    });
  });

  it("drops rows the loaded settings do not know", () => {
    const values = calendarAvailabilityToForm(loaded);
    values.calendars.push({ calendarId: "gone", include: false, detail: "busy" });
    expect(calendarAvailabilityUpdateFromForm(loaded, values)).toEqual({ enabled: false });
  });
});
