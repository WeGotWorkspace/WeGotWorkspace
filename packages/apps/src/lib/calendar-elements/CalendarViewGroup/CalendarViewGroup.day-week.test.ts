import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "CalendarViewGroup.ts"),
  "utf8",
);

describe("CalendarViewGroup day ↔ week remount", () => {
  it("keys each time-range view so day → week remounts instead of reusing the day timeline", () => {
    expect(source).toContain('import { keyed } from "lit/directives/keyed.js"');
    expect(source).toContain("keyed(`${this.presentation}:${this.view}`");
    expect(source).not.toContain('import { cache } from "lit/directives/cache.js"');
  });

  it("requestUpdates startDate so week swipe dates reach React without a setter no-op loop", () => {
    expect(source).toContain("if (this.#startDate === nextValue) return");
    expect(source).toContain('this.requestUpdate("startDate", previous)');
  });
});
