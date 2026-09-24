import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "calendar-invitees-card.css"), "utf8");
const tsx = readFileSync(join(here, "calendar-invitees-card.tsx"), "utf8");

describe("calendar invitees card CSS", () => {
  it("lays out participants as inline UserChip rows with RSVP wash classes", () => {
    expect(css).toMatch(/\.calendar-invitees-card \{[\s\S]*container:\s*calendar-invitees/);
    expect(css).toMatch(/\.calendar-invitees-card__chips/);
    expect(css).toMatch(/flex-wrap/);
    expect(css).not.toMatch(/\.card__row/);
    expect(css).not.toMatch(/calendar-invitees-status-tag/);
    expect(css).not.toMatch(/tag--icon-only/);
  });

  it("renders UserChip instead of Tag or ShareAccessRow", () => {
    expect(tsx).toMatch(/from "@\/user-avatar\/src\/user-chip"/);
    expect(tsx).toMatch(/UserChip/);
    expect(tsx).toMatch(/calendar-invitees-card__chips/);
    expect(tsx).not.toMatch(/ShareAccessRow/);
    expect(tsx).not.toMatch(/from "@\/tag\/src\/tag"/);
  });
});
