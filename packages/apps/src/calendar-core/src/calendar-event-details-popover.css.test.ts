import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "calendar-event-details-popover.css"),
  "utf8",
);

describe("calendar event details popover CSS", () => {
  it("anchors to the event card and tries placements around it", () => {
    expect(css).toContain("anchor-name: --calendar-event-details-anchor");
    expect(css).toContain("position-anchor: --calendar-event-details-anchor");
    expect(css).toContain("position-try-fallbacks");
    expect(css).toContain("flip-block");
  });

  it("keeps a fixed center-bottom placement on small viewports", () => {
    expect(css).toMatch(
      /@media \(max-width: 40rem\) \{[\s\S]*bottom:\s*1rem;[\s\S]*translate:\s*-50%\s*0;/,
    );
    expect(css).toMatch(/@media \(max-width: 40rem\) \{[\s\S]*position-try-fallbacks:\s*none;/);
  });
});
