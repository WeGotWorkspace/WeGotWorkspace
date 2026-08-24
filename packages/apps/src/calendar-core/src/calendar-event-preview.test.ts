import { describe, expect, it } from "vitest";
import { calendarEventsToEngineMap } from "@/calendar-core/src/calendar-event-model";
import {
  detailsPopoverAnchorOrigin,
  detailsPopoverShouldDock,
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

  it("opens a preview for a timed event whose start is a UTC Instant (…Z)", () => {
    const dentist = bootstrap.data.events.find((entry) => entry.id === "dentist");
    expect(dentist).toBeDefined();
    const wire = { ...dentist!, start: "2033-01-13T11:00:00Z" };
    expect(() => resolveCalendarEventPreview("dentist", { events: [wire] })).not.toThrow();
    const preview = resolveCalendarEventPreview("dentist", { events: [wire] });
    expect(preview).not.toBeNull();
    expect(preview?.form.startDate).toBe("2033-01-13");
    expect(preview?.form.startTime).toBe("11:00");
    expect(preview?.form.allDay).toBe(false);
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

describe("detailsPopoverShouldDock", () => {
  it("docks a tall compact-month cell origin and leaves a card-sized origin undocked", () => {
    expect(detailsPopoverShouldDock({ left: 120, top: 80, width: 48, height: 140 })).toBe(true);
    expect(detailsPopoverShouldDock({ left: 48, top: 96, width: 180, height: 36 })).toBe(false);
  });

  it("leaves a tall week-view segment undocked so the popover stays compact", () => {
    expect(detailsPopoverShouldDock({ left: 420, top: 160, width: 168, height: 420 })).toBe(false);
    expect(detailsPopoverShouldDock({ left: 280, top: 48, width: 336, height: 520 })).toBe(false);
  });
});

describe("detailsPopoverAnchorOrigin", () => {
  it("keeps a short card origin and clamps a tall segment to a compact head", () => {
    const short = { left: 48, top: 96, width: 180, height: 36 };
    expect(detailsPopoverAnchorOrigin(short)).toEqual(short);
    expect(detailsPopoverAnchorOrigin({ left: 420, top: 160, width: 168, height: 420 })).toEqual({
      left: 420,
      top: 160,
      width: 168,
      height: 40,
    });
  });
});
