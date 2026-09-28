import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CONTACTS_LIST_CARD_ROW_PX,
  CONTACTS_LIST_CARD_ROW_REM,
  CONTACTS_LIST_HEADER_ROW_PX,
  CONTACTS_LIST_HEADER_ROW_REM,
} from "./contacts-list-window";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "contacts-list-panel.tsx"), "utf8");
const css = readFileSync(join(here, "contacts-workspace.css"), "utf8");

describe("contacts list section headers", () => {
  it("reuses ListStickyHeader instead of a contacts-only sticky row", () => {
    expect(tsx).toMatch(
      /import \{ ListStickyHeader \} from "@\/list-sticky-header\/src\/list-sticky-header"/,
    );
    expect(tsx).toMatch(
      /<ListStickyHeader\s+id=\{`contacts-section-\$\{letter\}`\}\s+emphasis=\{letter\}\s*\/>/,
    );
    expect(css).not.toMatch(/contacts-list-panel__section-header/);
  });
});

describe("contacts list fixed row sizes", () => {
  it("keeps CSS rem sizes aligned with the window math", () => {
    expect(css).toContain(`--contacts-list-card-row-size: ${CONTACTS_LIST_CARD_ROW_REM}rem`);
    expect(css).toContain(`--contacts-list-header-row-size: ${CONTACTS_LIST_HEADER_ROW_REM}rem`);
    expect(css).toMatch(
      /\.contacts-list-panel__list\s+\.list-item__button\s*\{[\s\S]*block-size:\s*var\(--contacts-list-card-row-size\)/,
    );
    expect(css).toMatch(
      /\.contacts-list-panel__list\s+\.list-sticky-header\s*\{[\s\S]*block-size:\s*var\(--contacts-list-header-row-size\)/,
    );
    expect(css).toMatch(/padding-block:\s*0\.75rem/);
    expect(CONTACTS_LIST_CARD_ROW_PX).toBe(CONTACTS_LIST_CARD_ROW_REM * 16);
    expect(CONTACTS_LIST_HEADER_ROW_PX).toBe(CONTACTS_LIST_HEADER_ROW_REM * 16);
  });

  it("always reserves the subtitle line so empty rows keep the same height", () => {
    expect(tsx).toMatch(/subtitle=\{contactListSubtitle\(card\) \|\| "\\u00a0"\}/);
    expect(css).toMatch(/\.list-item__subtitle--below[\s\S]*min-h-\[1\.25rem\]/);
  });
});
