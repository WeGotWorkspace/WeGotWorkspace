import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "calendar-event-details-popover.css"),
  "utf8",
);

describe("calendar event details popover CSS", () => {
  it("anchors to the event card and tries placements around it, including corners", () => {
    expect(css).toContain("anchor-name: --calendar-event-details-anchor");
    expect(css).toContain("position-anchor: --calendar-event-details-anchor");
    expect(css).toContain("position-try-fallbacks");
    expect(css).toContain("flip-block");
    expect(css).toContain("flip-inline");
    expect(css).toContain("flip-block flip-inline");
    expect(css).toContain("position-area: top left");
    expect(css).toContain("position-area: top right");
    expect(css).toMatch(/margin:\s*0\.75rem/);
  });

  it("keeps a safe center-bottom placement on small viewports", () => {
    expect(css).toContain(
      "[data-radix-popper-content-wrapper]:has(.calendar-event-details-popover)",
    );
    expect(css).toMatch(
      /@media \(max-width: 40rem\) \{[\s\S]*inset:\s*auto 0\.75rem[\s\S]*safe-area-inset-bottom/,
    );
    expect(css).toMatch(
      /@media \(max-width: 40rem\) \{[\s\S]*max-height:\s*min\(32rem,\s*calc\(100dvh - 6rem\)\)/,
    );
    expect(css).toMatch(/@media \(max-width: 40rem\) \{[\s\S]*position-anchor:\s*none;/);
    expect(css).toMatch(/@media \(max-width: 40rem\) \{[\s\S]*position-area:\s*none;/);
    expect(css).toMatch(/@media \(max-width: 40rem\) \{[\s\S]*position-try-fallbacks:\s*none;/);
    expect(css).toMatch(/@media \(max-width: 40rem\) \{[\s\S]*height:\s*max-content\s*!important;/);
    expect(css).toMatch(/@media \(max-width: 40rem\) \{[\s\S]*transform:\s*none\s*!important;/);
  });

  it("does not stretch-to-anchor and can dock compact-month origins on a wider window", () => {
    expect(css).toContain("height: max-content");
    expect(css).toContain("justify-self: center");
    expect(css).toContain("align-self: start");
    expect(css).toContain("calendar-event-details-popover--docked");
    expect(css).toContain("position-anchor: none");
    expect(css).toContain(
      "[data-radix-popper-content-wrapper]:has(.calendar-event-details-popover--docked)",
    );
  });
});
