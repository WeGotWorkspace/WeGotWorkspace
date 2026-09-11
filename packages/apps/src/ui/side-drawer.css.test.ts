import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "side-drawer.css"), "utf8");
const tsx = readFileSync(join(here, "side-drawer.tsx"), "utf8");
const sheet = readFileSync(join(here, "sheet.tsx"), "utf8");

describe("SideDrawer overlay motion", () => {
  it("matches AppSidebar panel-overlay duration + ease tokens", () => {
    expect(css).toMatch(/\.side-drawer \{[\s\S]*--tw-duration:\s*var\(--panel-overlay-duration\)/);
    expect(css).toMatch(/\.side-drawer \{[\s\S]*--tw-ease:\s*var\(--panel-overlay-ease\)/);
    expect(css).toMatch(
      /\.side-drawer \{[\s\S]*animation-duration:\s*var\(--panel-overlay-duration\)/,
    );
    expect(css).toMatch(
      /\.side-drawer \{[\s\S]*animation-timing-function:\s*var\(--panel-overlay-ease\)/,
    );
  });

  it("paints the Sheet scrim like AppSidebar (black/30 + shared duration)", () => {
    expect(tsx).toMatch(/overlayClassName="side-drawer__overlay"/);
    expect(css).toMatch(/\.side-drawer__overlay \{[\s\S]*@apply[^;]*\bbg-black\/30\b/);
    expect(css).toMatch(
      /\.side-drawer__overlay \{[\s\S]*--tw-duration:\s*var\(--panel-overlay-duration\)/,
    );
  });

  it("keeps Sheet panel enter/exit on shared overlay tokens (not open:500ms)", () => {
    expect(sheet).toMatch(/duration-\[var\(--panel-overlay-duration\)\]/);
    expect(sheet).toMatch(/ease-\[var\(--panel-overlay-ease\)\]/);
    expect(sheet).not.toMatch(/data-\[state=open\]:duration-500/);
    expect(sheet).toMatch(/overlayClassName\?:/);
  });
});
