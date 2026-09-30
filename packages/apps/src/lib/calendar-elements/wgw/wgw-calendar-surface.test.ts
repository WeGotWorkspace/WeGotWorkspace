/* eslint-disable no-restricted-imports -- legacy text-matching test, to be refactored */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "wgw-calendar-surface.ts"),
  "utf8",
);

describe("WgwCalendarSurface timezone wiring", () => {
  it("property-binds timezone onto calendar-view-group", () => {
    expect(source).toContain(".timezone=${this.timezone}");
    expect(source).not.toContain('timezone=${this.timezone ?? ""}');
  });
});
