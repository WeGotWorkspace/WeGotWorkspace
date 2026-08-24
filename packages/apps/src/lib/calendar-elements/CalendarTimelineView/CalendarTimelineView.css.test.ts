import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "CalendarTimelineView.css"),
  "utf8",
);

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
