import { describe, expect, it } from "vitest";
import { calendarEventsToEngineMap } from "@/calendar-core/src/calendar-event-model";
import {
  eventPreviewInviteeNames,
  eventPreviewNotesExcerpt,
  eventPreviewOccurrenceKey,
  formatEventPreviewWhen,
  resolveCalendarEventPreview,
  selectionOriginFromEvent,
} from "@/calendar-core/src/calendar-event-preview";
import { defaultCalendarLabels } from "@/calendar-core/src/calendar-labels";
import { createCalendarAppBootstrap } from "@/lib/api/mock/calendar-bootstrap";

const bootstrap = createCalendarAppBootstrap();

describe("resolveCalendarEventPreview", () => {
  it("builds a form from a wire master", () => {
    const preview = resolveCalendarEventPreview("dentist", { events: bootstrap.data.events });
    expect(preview?.eventId).toBe("dentist");
    expect(preview?.recurrenceId).toBeUndefined();
    expect(preview?.form.title).toMatch(/dentist/i);
  });

  it("anchors a recurring occurrence to that instance", () => {
    const surfaceEvents = calendarEventsToEngineMap(bootstrap.data.events);
    const preview = resolveCalendarEventPreview("standup::2033-01-12T09:30:00", {
      events: bootstrap.data.events,
      surfaceEvents,
    });
    expect(preview?.eventId).toBe("standup");
    expect(preview?.recurrenceId).toBe("2033-01-12T09:30:00");
    expect(preview?.form.startDate).toBe("2033-01-12");
    expect(eventPreviewOccurrenceKey(preview!)).toBe("standup::2033-01-12T09:30:00");
  });

  it("ignores a pending-deleted master", () => {
    expect(
      resolveCalendarEventPreview("dentist", {
        events: bootstrap.data.events,
        pendingDeletedEventIds: new Set(["dentist"]),
      }),
    ).toBeNull();
  });
});

describe("event preview formatters", () => {
  it("formats a same-day timed range", () => {
    const preview = resolveCalendarEventPreview("dentist", { events: bootstrap.data.events });
    expect(preview).not.toBeNull();
    expect(formatEventPreviewWhen(preview!.form, "en-US")).toMatch(/Jan/);
  });

  it("truncates long notes and lists invitees", () => {
    expect(eventPreviewNotesExcerpt("")).toBeNull();
    expect(eventPreviewNotesExcerpt("Bring slides")).toBe("Bring slides");
    expect(eventPreviewNotesExcerpt("x".repeat(200))?.endsWith("…")).toBe(true);
    expect(
      eventPreviewInviteeNames(
        [
          {
            email: "bob@example.test",
            name: "Bob",
            participationStatus: "accepted",
            isOrganizer: true,
          },
          {
            email: "carol@example.test",
            name: "Carol",
            participationStatus: "accepted",
          },
        ],
        defaultCalendarLabels,
      ),
    ).toBe("Carol");
  });
});

describe("selectionOriginFromEvent", () => {
  it("prefers the event-card rect from event-selected detail", () => {
    const origin = selectionOriginFromEvent(
      new CustomEvent("event-selected", {
        detail: { key: "dentist", origin: { left: 40, top: 80, width: 160, height: 32 } },
      }),
    );
    expect(origin).toEqual({ left: 40, top: 80, width: 160, height: 32 });
  });

  it("returns nothing when event-selected has no card origin", () => {
    expect(
      selectionOriginFromEvent(new CustomEvent("event-selected", { detail: { key: "dentist" } })),
    ).toBeUndefined();
  });
});
