import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "CalendarTimelineView.css"),
  "utf8",
);

const COMPACT_QUERY = "@container lc-timeline-month (max-width: 504px)";

function extractBalancedBlock(source: string, prelude: string): string {
  const start = source.indexOf(prelude);
  expect(start, `missing ${prelude}`).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  expect(open, `missing block for ${prelude}`).toBeGreaterThan(-1);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`unbalanced block for ${prelude}`);
}

function extractForceCompactCss(source: string): string {
  const start = source.indexOf(":host([force-compact])");
  expect(start, "missing :host([force-compact]) rules").toBeGreaterThan(-1);
  return source.slice(start);
}

function tokenPx(block: string, name: string): number {
  const match = block.match(new RegExp(`${name}:\\s*(\\d+(?:\\.\\d+)?)px`));
  expect(match, `${name} px token`).toBeTruthy();
  return Number(match?.[1]);
}

function expectSlimLaneTokens(block: string) {
  for (const name of ["--event-height", "--_lc-event-height", "--time-line-event-min-size"]) {
    const value = tokenPx(block, name);
    expect(value, name).toBeGreaterThanOrEqual(18);
    expect(value, name).toBeLessThanOrEqual(22);
  }
  expect(block).toMatch(/--_lc-event-card-heading-padding-block:\s*1px/);
  expect(block).toMatch(/--_lc-event-card-heading-align-items:\s*center/);
  expect(block).toMatch(/--_lc-event-card-heading-line-height:\s*1/);
  expect(block).toMatch(/--_lc-time-label-font-size:\s*0\.625rem/);
  expect(block).toMatch(/--_lc-event-card-pointer-events:\s*none/);
  expect(block).toMatch(/--_lc-event-card-recurring-icon-display:\s*none/);
  expect(block).toMatch(/--_lc-event-card-accent-bar-display:\s*none/);
  const headingInlineStart = tokenPx(block, "--_lc-event-card-heading-padding-inline-start");
  expect(headingInlineStart).toBeGreaterThanOrEqual(2);
  expect(headingInlineStart).toBeLessThan(13);
  expect(block).toMatch(/--_lc-event-card-heading-overflow:\s*clip/);
  expect(block).toMatch(
    /--_lc-event-card-heading-mask:\s*linear-gradient\(\s*to inline-end,\s*#000 80%,\s*transparent\s*\)/,
  );
}

function expectViewOnlyHits(block: string) {
  expect(block).toMatch(
    /::part\(cell-main\)[^{]*\{[^}]*(?:pointer-events:\s*none|@apply[^{}]*pointer-events-none)/,
  );
  expect(block).toMatch(
    /::part\(event\)[^{]*\{[^}]*(?:pointer-events:\s*none|@apply[^{}]*pointer-events-none)/,
  );
  expect(block).toMatch(
    /::part\(event-card\)[^{]*\{[^}]*(?:pointer-events:\s*none|@apply[^{}]*pointer-events-none)/,
  );
}

function expectCompactMonthLayout(block: string) {
  expect(block).not.toMatch(/::part\(cell-main\)[^{]*\{[^}]*display:\s*none/);
  expect(block).not.toMatch(/::part\(cell-footer\)[^{]*\{[^}]*display:\s*none/);
  expect(block).not.toMatch(/::part\(day-dots\)[^{]*\{[^}]*display:\s*inline-flex/);
  expect(block).not.toMatch(/::part\(cell-header\)[^{]*\{[^}]*flex:\s*1\s+1\s+auto/);
  expect(block).not.toMatch(/::part\(day-header\)[^{]*\{[^}]*flex:\s*1\s+1\s+auto/);
  expect(block).toMatch(
    /::part\(day-header\)[^{]*\{[^}]*(?:justify-content:\s*center|@apply[^{}]*justify-center)/,
  );
  expect(block).toMatch(/::part\(cell\)[^{]*\{[^}]*outline:\s*none/);
  expect(block).toMatch(
    /::part\(cell\)[^{]*\{[^}]*border-block-end:\s*var\(\s*--_lc-grid-line-width,\s*1px\s*\)\s+solid\s+var\(\s*--_lc-grid-line-color\s*\)/,
  );
  expect(block).not.toMatch(/::part\(cell\)[^{]*\{[^}]*border(?:-inline|-right|-left)\s*:/);
  expectSlimLaneTokens(block);
  expectViewOnlyHits(block);
}

describe("CalendarTimelineView year-grid CSS", () => {
  it("styles the cheap year cards with Tailwind @apply, not raw layout properties", () => {
    expect(css).toContain('@import "tailwindcss"');
    expect(css).toMatch(/\.year-days\s*\{[\s\S]*?@apply grid min-h-0 aspect-square grid-cols-7;/);
    expect(css).toMatch(
      /\.year-day\s*\{[\s\S]*?@apply appearance-none border-0 m-0 p-0 min-w-0 min-h-0 flex items-center justify-center cursor-pointer bg-transparent;/,
    );
    expect(css).toMatch(
      /\.year-day:hover\s*\{[\s\S]*?@apply rounded;[\s\S]*?background-color:\s*var\(\s*--_lc-grid-ghost-color/,
    );
    expect(css).toMatch(
      /\.year-day:focus-visible\s*\{[\s\S]*?@apply rounded outline-2 outline-solid -outline-offset-2;/,
    );
    expect(css).toMatch(
      /\.year-day-number\s*\{[\s\S]*?@apply relative inline-flex items-center justify-center min-w-5 h-5 px-\[5px\] rounded-full text-\[12px\] font-medium leading-tight;/,
    );
    expect(css).toMatch(
      /\.year-day-dots\s*\{[\s\S]*?@apply absolute top-full left-1\/2 inline-flex items-center gap-\[3px\] mt-px -translate-x-1\/2 pointer-events-none;/,
    );
    expect(css).toMatch(
      /\.year-day-dot\s*\{[\s\S]*?@apply size-1 rounded-full opacity-90 shrink-0;/,
    );
  });
});

describe("CalendarTimelineView compact-month CSS", () => {
  it("keeps the container query and force-compact blocks in sync as slim view-only bars", () => {
    const queryBlock = extractBalancedBlock(css, COMPACT_QUERY);
    const forceCompactBlock = extractForceCompactCss(css);
    expectCompactMonthLayout(queryBlock);
    expectCompactMonthLayout(forceCompactBlock);
  });
});
