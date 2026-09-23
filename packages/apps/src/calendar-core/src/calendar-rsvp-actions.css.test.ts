import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "calendar-rsvp-actions.css"), "utf8");

describe("calendar-rsvp-actions chrome", () => {
  it("scopes accent SegmentedControl tokens so portaled popovers match invitation cards", () => {
    expect(css).toMatch(
      /\.calendar-rsvp-actions \{[\s\S]*--segmented-control-active-bg:\s*var\(\s*--button-outline-active-background/,
    );
    expect(css).toMatch(
      /\.calendar-rsvp-actions \{[\s\S]*--segmented-control-active-bg:[\s\S]*var\(--workspace-accent/,
    );
    expect(css).toMatch(
      /\.calendar-rsvp-actions \{[\s\S]*--segmented-control-active-fg:\s*var\(\s*--button-active-color/,
    );
    expect(css).not.toMatch(
      /\.calendar-rsvp-actions \{[\s\S]*--segmented-control-active-bg:\s*color-mix\(in oklch,\s*var\(--color-we-got-dark\)\s*8%/,
    );
  });

  it("hugs icon-only content and keeps slim height on fine pointers", () => {
    expect(css).toMatch(/\.calendar-rsvp-actions \{[\s\S]*@apply w-auto shrink-0/);
    expect(css).not.toMatch(/\.calendar-rsvp-actions \{[\s\S]*@apply w-full/);
    expect(css).not.toMatch(/\.calendar-rsvp-actions \.segmented-control \{[\s\S]*w-full/);
    expect(css).not.toMatch(/\.calendar-rsvp-actions \.segmented-control__button--text/);
    expect(css).toMatch(
      /@media \(hover:\s*hover\) and \(pointer:\s*fine\) \{[\s\S]*\.calendar-rsvp-actions--sm \{[\s\S]*--segmented-control-height:/,
    );
  });
});
