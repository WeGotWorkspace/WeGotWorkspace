import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const iconCss = readFileSync(join(here, "workspace-app-icon.css"), "utf8");
const homeCss = readFileSync(join(here, "../apps-home-screen/src/apps-home-screen.css"), "utf8");
const homeTsx = readFileSync(join(here, "../apps-home-screen/src/apps-home-screen.tsx"), "utf8");

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

describe("apps home screen shell", () => {
  it("uses cream background and a max 4-column centered grid", () => {
    expect(homeCss).toMatch(
      /\.apps-home-screen \{[\s\S]*background-color:\s*var\(--color-cream,\s*#fff5e9\)/,
    );
    expect(homeCss).toMatch(/--app-switch-label-color:\s*var\(--color-ink/);
    expect(homeTsx).toMatch(/sm:grid-cols-4/);
    expect(homeTsx).not.toMatch(/grid-cols-3/);
    expect(homeTsx).toMatch(/flex flex-1 items-center justify-center/);
  });
});
