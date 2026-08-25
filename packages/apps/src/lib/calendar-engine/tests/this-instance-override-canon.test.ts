import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appsSrc = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const ENGINE_CALLERS = [
  "calendar-core/src/calendar-events-api.ts",
  "lib/calendar-elements/domain/events-api/resolveEventMapKey.ts",
];

describe("this-instance override detection", () => {
  it("engine callers use isThisInstanceOverride and do not parse occurrence keys inline", () => {
    for (const relative of ENGINE_CALLERS) {
      const source = readFileSync(path.join(appsSrc, relative), "utf8");
      expect(source, relative).toMatch(/isThisInstanceOverride/);
      expect(source, relative).not.toMatch(/includes\(["'`]::["'`]\)/);
      expect(source, relative).not.toMatch(/function isOccurrenceKey/);
    }
  });

  it("JSCalendar this-instance detection stays on occurrenceHasThisInstanceOverride", () => {
    const scope = readFileSync(
      path.join(appsSrc, "calendar-core/src/calendar-recurrence-scope.ts"),
      "utf8",
    );
    const controller = readFileSync(
      path.join(appsSrc, "calendar-core/src/use-calendar-controller.ts"),
      "utf8",
    );
    expect(scope).toMatch(/export function occurrenceHasThisInstanceOverride/);
    expect(controller).toMatch(/occurrenceHasThisInstanceOverride/);
    expect(controller).not.toMatch(/isThisInstanceOverride/);
    expect(controller).not.toMatch(/includes\(["'`]::["'`]\)/);
  });
});
