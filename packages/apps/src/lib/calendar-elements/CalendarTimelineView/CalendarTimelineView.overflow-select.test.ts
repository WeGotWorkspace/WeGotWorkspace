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

describe("CalendarTimelineView year grid", () => {
  it("renders cheap month-dot cards instead of nested month timelines", () => {
    expect(source).toContain("#renderYearDay");
    expect(source).toContain("#yearEventsByDay");
    expect(source).toContain('class="year-days"');
    expect(source).not.toContain("Inner-month events must be re-forwarded");
  });

  it("emits composed day-selection from the year view itself", () => {
    expect(source).toContain('new CustomEvent("day-selection"');
    expect(source).toContain("composed: true");
  });
});
