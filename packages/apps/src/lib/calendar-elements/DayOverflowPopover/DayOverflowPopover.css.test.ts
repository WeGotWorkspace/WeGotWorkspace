import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "DayOverflowPopover.css"),
  "utf8",
);

const hostBlock = css.match(/:host\s*\{[\s\S]*?\n\}/)?.[0] ?? "";

describe("DayOverflowPopover EventCard chrome", () => {
  it("resets compact-month density tokens so popover cards stay the regular EventCard", () => {
    expect(hostBlock).toBeTruthy();
    expect(hostBlock).toMatch(/--_lc-event-height:\s*var\(--_lc-default-event-height,\s*32px\)/);
    expect(hostBlock).toMatch(/--event-height:\s*var\(--_lc-default-event-height,\s*32px\)/);
    expect(hostBlock).toMatch(
      /--time-line-event-min-size:\s*var\(--_lc-default-event-height,\s*32px\)/,
    );
    for (const name of [
      "--_lc-event-card-heading-padding-block",
      "--_lc-event-card-heading-align-items",
      "--_lc-event-card-heading-line-height",
      "--_lc-event-card-heading-padding-inline-start",
      "--_lc-time-label-font-size",
      "--_lc-event-card-pointer-events",
      "--_lc-event-card-recurring-icon-display",
      "--_lc-event-card-accent-bar-display",
      "--_lc-event-card-heading-overflow",
      "--_lc-event-card-heading-mask",
    ]) {
      expect(hostBlock, name).toMatch(new RegExp(`${name}:\\s*initial`));
    }
  });
});
