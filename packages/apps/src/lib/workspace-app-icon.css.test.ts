import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const iconCss = readFileSync(join(here, "workspace-app-icon.css"), "utf8");
const homeCss = readFileSync(join(here, "../apps-home-screen/src/apps-home-screen.css"), "utf8");

describe("workspace app icon radius", () => {
  it("clips full-color tiles at 16px in CSS, not in SVG source", () => {
    expect(iconCss).toMatch(/--workspace-app-icon-radius:\s*16px/);
    expect(iconCss).toMatch(
      /\.workspace-app-icon--tile \{[\s\S]*border-radius:\s*var\(--workspace-app-icon-radius/,
    );
    expect(homeCss).toMatch(
      /\.apps-home-screen__tile-icon \{[\s\S]*border-radius:\s*var\(--workspace-app-icon-radius/,
    );
    expect(homeCss).toMatch(
      /\.apps-home-screen__tile-icon--accent \{[\s\S]*border-radius:\s*var\(--workspace-app-icon-radius/,
    );
    expect(homeCss).not.toMatch(/rounded-\[6px\]/);
  });
});
