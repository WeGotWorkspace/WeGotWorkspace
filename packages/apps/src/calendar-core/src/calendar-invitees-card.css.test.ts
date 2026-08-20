import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "calendar-invitees-card.css"), "utf8");

describe("calendar invitees card CSS", () => {
  it("wraps invitee identity so status chips cannot hide the name", () => {
    expect(css).toMatch(/\.calendar-invitees-card \{[\s\S]*container:\s*calendar-invitees/);
    expect(css).toMatch(/\.calendar-invitees-card \.card__row \{[\s\S]*flex-wrap/);
    expect(css).toMatch(
      /\.calendar-invitees-card \.card__row-main \{[\s\S]*min-width:\s*min\(10rem,\s*100%\)/,
    );
    expect(css).toMatch(/\.calendar-invitees-card \.card__row-title-line \{[\s\S]*flex-wrap/);
    expect(css).toMatch(
      /\.calendar-invitees-card \.card__row-title-group \{[\s\S]*min-width:\s*min\(8rem,\s*100%\)/,
    );
    expect(css).toMatch(/\.calendar-invitees-card \.card__row-title-line \.tag \{[\s\S]*shrink-0/);
  });

  it("hides full-text status chips on narrow widths instead of adding icon-only chips", () => {
    expect(css).toMatch(/@container calendar-invitees \(max-width: 22rem\)/);
    expect(css).toMatch(/@supports not \(container-type: inline-size\)/);
    expect(css).toMatch(/\.calendar-invitees-card \.card__row-title \{[\s\S]*whitespace-normal/);
    expect(css).toMatch(/\.calendar-invitees-status-tag \{[\s\S]*hidden/);
    expect(css).not.toMatch(/tag--icon-only/);
  });
});
