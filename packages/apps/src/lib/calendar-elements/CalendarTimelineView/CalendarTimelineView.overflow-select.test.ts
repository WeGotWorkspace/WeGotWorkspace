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
});
