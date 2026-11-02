import { describe, expect, it } from "vitest";
import type { JmapCalendarEvent } from "@/lib/jmap-client";
import {
  editPatchRevert,
  occurrenceOverridesRevert,
} from "@/calendar-core/src/calendar-undo-writes";

const original = {
  "@type": "Event",
  id: "ev-1",
  uid: "urn:uuid:ev-1",
  calendarIds: { default: true },
  title: "Dentist",
  start: "2033-01-10T10:00:00",
  duration: "PT30M",
  timeZone: "Etc/UTC",
  recurrenceOverrides: { "2033-01-17T10:00:00": { title: "Moved" } },
} as JmapCalendarEvent;

describe("editPatchRevert", () => {
  it("patches back only the edited fields", () => {
    expect(editPatchRevert({ title: "Renamed", duration: "PT1H" }, original)).toEqual({
      title: "Dentist",
      duration: "PT30M",
    });
  });

  it("clears a field the original did not have", () => {
    expect(editPatchRevert({ location: "Room 1", attendees: [] }, original)).toEqual({
      location: "",
      attendees: [],
    });
  });

  it("leaves the organizer the edit set alongside the attendees", () => {
    const revert = editPatchRevert(
      { organizer: { email: "me@example.test" }, title: "Renamed" },
      original,
    );
    expect(revert).toEqual({ title: "Dentist" });
  });
});

describe("occurrenceOverridesRevert", () => {
  it("restores the old overrides and drops the new instance with an explicit null", () => {
    const edited = {
      "2033-01-17T10:00:00": { title: "Moved" },
      "2033-01-24T10:00:00": { title: "Edited" },
    };
    expect(occurrenceOverridesRevert(original, edited)).toEqual({
      recurrenceOverrides: {
        "2033-01-17T10:00:00": { title: "Moved" },
        "2033-01-24T10:00:00": null,
      },
    });
  });
});
