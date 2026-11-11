import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  readFirstPaintStyle,
  readViewportMeta,
  renderIndexHtml,
} from "./sync-runtime-app-builds.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(here, "../index.html"), "utf8");

describe("runtime index.html", () => {
  const firstPaintStyle = readFirstPaintStyle(indexHtml);
  const viewportMeta = readViewportMeta(indexHtml);
  const html = renderIndexHtml({
    title: "WeGotWorkspace Installer",
    scriptPath: "/install/assets/index-abc.js",
    cssPath: "/install/assets/index-abc.css",
    viewportMeta,
    firstPaintStyle,
    assetBase: "/install",
  });

  it("carries the dark first-paint background from index.html", () => {
    expect(firstPaintStyle).toMatch(
      /html\[data-theme="dark"\] body \{\s*background-color: #0e1216;/,
    );
    expect(html).toContain(firstPaintStyle);
  });

  it("resolves the theme before the stylesheet and the app bundle", () => {
    const boot = html.indexOf('<script src="/install/assets/theme-boot.js"></script>');
    expect(boot).toBeGreaterThan(-1);
    expect(boot).toBeLessThan(html.indexOf('<script type="module"'));
    expect(boot).toBeLessThan(html.indexOf('<link rel="stylesheet"'));
  });

  it("ships no inline script, which the runtime CSP would block", () => {
    const scriptAttributes = html
      .split("<script")
      .slice(1)
      .map((rest) => rest.slice(0, rest.indexOf(">")));
    expect(scriptAttributes).toHaveLength(2);
    for (const attributes of scriptAttributes) {
      expect(attributes).toContain(' src="');
    }
  });

  it("copies the one viewport tag, with the iOS focus-zoom stop, from index.html", () => {
    expect(html.match(/name="viewport"/g)).toHaveLength(1);
    expect(html).toContain(viewportMeta);
    expect(viewportMeta).toContain("maximum-scale=1");
    expect(viewportMeta).toContain("viewport-fit=cover");
  });

  it("fails the sync when the built index.html lost the focus-zoom stop", () => {
    expect(() =>
      readViewportMeta('<meta name="viewport" content="width=device-width, initial-scale=1" />'),
    ).toThrow(/maximum-scale/);
  });

  it("fails the sync when the built index.html lost its first-paint style", () => {
    expect(() => readFirstPaintStyle("<html><head></head></html>")).toThrow(/first-paint/);
  });
});
