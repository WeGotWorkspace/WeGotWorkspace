import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "workspace-menu-item-sst.css"), "utf8");

describe("workspace menu-item SST", () => {
  it("publishes accent 14/18/24 washes for product shells and dialog surfaces", () => {
    expect(css).toMatch(/\.calendar-workspace/);
    expect(css).toMatch(/\.calendar-dialog-surface/);
    expect(css).toMatch(/\.share-dialog/);
    expect(css).toMatch(/\.view-header/);
    expect(css).toMatch(
      /--menu-item-hover-background:\s*color-mix\(\s*in oklab,\s*var\(--workspace-accent/,
    );
    expect(css).toMatch(/--menu-item-hover-background:[\s\S]*14%/);
    expect(css).toMatch(/--menu-item-selected-background:[\s\S]*18%/);
    expect(css).toMatch(/--menu-item-selected-hover-background:[\s\S]*24%/);
  });

  it("publishes soft outline button washes on chrome + dialog surfaces (not workspace roots)", () => {
    expect(css).toMatch(/\.floating-action-bar/);
    expect(css).toMatch(/\.meet-channel-dialog/);
    expect(css).toMatch(/\.docs-collab-sidebar-panel-drawer/);
    expect(css).toMatch(
      /--button-outline-hover-background:\s*color-mix\(\s*in oklab,\s*var\(--workspace-accent/,
    );
    expect(css).toMatch(/--button-outline-hover-background:[\s\S]*14%/);
    expect(css).toMatch(/--button-outline-active-background:[\s\S]*18%/);
    expect(css).toMatch(/--button-outline-active-hover-background:[\s\S]*24%/);
    expect(css).toMatch(/--button-outline-hover-color:\s*var\(\s*--button-active-color/);
    // Soft outline SST must not blanket product workspace roots (heavier 40/55 there).
    expect(css).toMatch(/Scoped to header, floating action bar, and dialog \/ overlay surfaces/);
    expect(css).toMatch(
      /:is\(\s*\.view-header,\s*\.floating-action-bar,\s*\.calendar-dialog-surface/,
    );
  });
});
