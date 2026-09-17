import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "CalendarWeekdayHeader.css"), "utf8");

describe("CalendarWeekdayHeader alignment", () => {
  it("start-aligns auto narrow labels; centers only the forced [narrow] year variant", () => {
    const autoNarrow = css.match(/@container \(max-width:\s*64px\) \{[\s\S]*?\n\}/)?.[0];
    expect(autoNarrow).toBeDefined();
    expect(autoNarrow).toMatch(/\.weekday-label \{[\s\S]*justify-start/);
    expect(autoNarrow).toMatch(/\.weekday-label \{[\s\S]*text-start/);
    expect(autoNarrow).not.toMatch(/\.weekday-label \{[\s\S]*justify-center/);

    const forced = css.match(/:host\(\[narrow\]\) \.weekday-label \{[\s\S]*?\n\}/)?.[0];
    expect(forced).toBeDefined();
    expect(forced).toMatch(/justify-center/);
    expect(forced).toMatch(/text-center/);
  });
});
