import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "CalendarTimelineView.ts"),
  "utf8",
);

describe("CalendarTimelineView overflow chip select", () => {
  it("emits event-selected from an overflow chip and dismisses the day-overflow card", () => {
    expect(source).toContain("#handleOverflowPopoverSelect");
    expect(source).toContain("this.#selectTimelineEvent(key, card)");
    expect(source).toContain("this.#hideOpenPopover(event.currentTarget)");
  });

  it("stamps data-event-id from the map key so dragend can resolve the card", () => {
    expect(source).toContain("data-event-id=${timelineEvent.key}");
    expect(source).toContain(".eventId=${timelineEvent.key}");
  });
});

describe("CalendarTimelineView year inner-month forwarding", () => {
  it("re-forwards day-selection as composed so React can navigate", () => {
    expect(source).toContain("@day-selection=${this.forwardComposedCalendarEvent}");
    expect(source).not.toContain("@day-selection=${this.forwardCalendarEvent}");
  });
});
