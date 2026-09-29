import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "calendar-event-calendar-picker.css"), "utf8");

describe("calendar event calendar picker menu", () => {
  it("matches the labeled trigger width in settings", () => {
    expect(css).toMatch(
      /\.calendar-event-dialog__calendar-menu--match-trigger \{[\s\S]*width:\s*var\(--radix-dropdown-menu-trigger-width\)/,
    );
    expect(css).toMatch(
      /\.calendar-event-dialog__calendar-menu--match-trigger \{[\s\S]*min-width:\s*var\(--radix-dropdown-menu-trigger-width\)/,
    );
  });
});
