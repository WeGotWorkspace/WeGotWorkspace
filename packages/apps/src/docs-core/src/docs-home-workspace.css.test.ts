import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "docs-home-workspace.css"), "utf8");
const homePane = readFileSync(join(here, "docs-home-pane.tsx"), "utf8");

describe("docs home selection bar scrollport", () => {
  it("scrolls list content on __scroll and mounts the bar as a sibling of that scrollport", () => {
    expect(homePane).toMatch(/docs-home-pane__scroll/);
    expect(homePane).toMatch(
      /docs-home-pane__scroll[\s\S]*\{selectionBar\}|\{selectionBar\}[\s\S]*docs-home-pane__scroll/,
    );
    // Bar must sit outside the scroll child (Drive main-pane pattern).
    expect(homePane).toMatch(/docs-home-pane__scroll[\s\S]*?<\/div>\s*\{selectionBar\}/);
  });

  it("reserves FAB padding on the scrollport end, not on the grid body itself", () => {
    expect(css).toMatch(/\.docs-home-pane__scroll \{[\s\S]*overflow-y-auto/);
    expect(css).toMatch(
      /\.docs-home-pane__body:has\(\.drive-selection-bar\)\s*\.docs-home-pane__scroll\s*\{[\s\S]*padding-bottom:\s*5\.5rem/,
    );
    expect(css).not.toMatch(
      /\.docs-home-pane__body:has\(\.drive-selection-bar\)\s*\{\s*padding-bottom/,
    );
  });
});
