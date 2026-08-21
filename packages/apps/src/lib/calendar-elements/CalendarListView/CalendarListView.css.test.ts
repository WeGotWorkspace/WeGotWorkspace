import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "CalendarListView.css"), "utf8");

describe("CalendarListView heading CSS", () => {
  it("lets the workspace override sticky day-heading backgrounds", () => {
    expect(css).toMatch(
      /\.agenda-day-heading \{[\s\S]*background-color:\s*var\(\s*--_lc-list-heading-bg/,
    );
  });
});
