import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "CalendarListView.css"), "utf8");
const ts = readFileSync(join(here, "CalendarListView.ts"), "utf8");

describe("CalendarListView heading CSS", () => {
  it("lets the workspace override sticky day-heading backgrounds", () => {
    expect(css).toMatch(
      /\.agenda-day-heading\.list-sticky-header \{[\s\S]*background-color:\s*var\(\s*--_lc-list-heading-bg/,
    );
  });

  it("reuses list-sticky-header split-label weights instead of agenda-only type", () => {
    expect(ts).toMatch(/list-sticky-header\/src\/list-sticky-header\.css\?inline/);
    expect(ts).toMatch(/class="list-sticky-header agenda-day-heading"/);
    expect(ts).toMatch(/list-sticky-header__emphasis/);
    expect(ts).toMatch(/list-sticky-header__rest/);
    expect(css).toMatch(/\.agenda-day-heading\.list-sticky-header/);
    expect(css).not.toMatch(/agenda-day-weekday/);
    expect(css).not.toMatch(/agenda-day-date/);
    expect(css).not.toMatch(/font-\[650\]/);
    expect(css).not.toMatch(/font-\[450\]/);
    expect(css).not.toMatch(/font-semibold/);
    expect(css).not.toMatch(/--list-sticky-header-emphasis-font-size/);
  });

  it("lets the workspace reserve scroll-end room under a floating field", () => {
    expect(css).toMatch(/\.agenda-shell \{[\s\S]*padding-bottom:\s*var\(--_lc-list-end-pad/);
  });

  it("caps the agenda column so details popover can use the end gutter", () => {
    expect(css).toMatch(
      /\.agenda-shell \{[\s\S]*max-inline-size:\s*min\(100%,\s*var\(--_lc-list-max-inline-size,\s*36rem\)\)/,
    );
    expect(css).toMatch(
      /@container \(min-width:\s*56rem\)\s*\{[\s\S]*\.agenda-shell \{[\s\S]*calc\(100%\s*-\s*var\(--_lc-list-details-gutter,\s*26rem\)\)/,
    );
  });

  it("keeps the host as the agenda scrollport", () => {
    expect(css).toMatch(/:host \{[\s\S]*?@apply[^;]*overflow-y-auto/);
  });

  it("lets an embedded host defer the scrollport to its parent", () => {
    expect(css).toMatch(/:host\(\[embedded\]\) \{[\s\S]*?overflow-visible/);
  });

  it("skips layout for off-screen event lists without changing scroll metrics", () => {
    expect(css).toMatch(
      /\.agenda-event-list\s*\{[\s\S]*?content-visibility:\s*auto;[\s\S]*?contain-intrinsic-block-size:\s*auto 130px;/,
    );
  });

  it("keeps rest/selected wash-free and adds a subtle accent mix on hover", () => {
    expect(css).toMatch(
      /\.agenda-event-item event-card\s*\{[\s\S]*--_lc-event-card-bg-default:\s*transparent/,
    );
    expect(css).toMatch(
      /\.agenda-event-item event-card\s*\{[\s\S]*--_lc-event-card-bg-active:\s*transparent/,
    );
    expect(css).toMatch(
      /\.agenda-event-item event-card:hover\s*\{[\s\S]*--_lc-event-card-bg-active:\s*color-mix\(\s*in srgb,\s*var\(--_lc-event-accent-color(?:,\s*CanvasText)?\)\s*10%,\s*var\(--_lc-surface-bg/,
    );
    expect(css).toMatch(
      /\.agenda-event-item event-card\[data-selected\]\s*\{[\s\S]*--_lc-event-card-bg-active:\s*transparent/,
    );
    expect(css).toMatch(
      /\.agenda-event-item event-card\s*\{[\s\S]*--_lc-event-card-accent-color:\s*var\(--_lc-event-accent-color\)/,
    );
    expect(css).not.toMatch(/--_lc-event-card-bg-default:\s*var\(--_lc-event-bg\)/);
    expect(css).not.toMatch(/--_lc-event-card-bg-active:\s*var\(--_lc-event-bg-active/);
    expect(css).not.toMatch(/--_lc-event-card-bg-active:\s*var\(--_lc-event-bg-hover/);
  });
});
