import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "calendar-event-details-popover.css"),
  "utf8",
);

describe("calendar event details popover CSS", () => {
  it("anchors large-screen placement to the event card and tries flips around it", () => {
    expect(css).toContain("anchor-name: --calendar-event-details-anchor");
    expect(css).toContain("position-anchor: --calendar-event-details-anchor");
    expect(css).toContain("position-try-fallbacks");
    expect(css).toContain("flip-block");
    expect(css).toContain("flip-inline");
    expect(css).toContain("position-area: top left");
    expect(css).toContain("position-area: top right");
    expect(css).toContain("justify-self: center");
    expect(css).toContain("align-self: start");
  });

  it("docks the Radix wrapper on small viewports and compact-month --docked", () => {
    expect(css).toContain(
      "[data-radix-popper-content-wrapper]:has(.calendar-event-details-popover)",
    );
    expect(css).toContain(
      "[data-radix-popper-content-wrapper]:has(.calendar-event-details-popover--docked)",
    );
    expect(css).toMatch(/@media \(max-width: 40rem\)/);
    expect(css).toContain("calendar-event-details-popover--docked");
    expect(css).toContain("height: max-content");
    expect(css).toContain("position-anchor: none");
    expect(css).toContain("position-try-fallbacks: none");
  });
});
