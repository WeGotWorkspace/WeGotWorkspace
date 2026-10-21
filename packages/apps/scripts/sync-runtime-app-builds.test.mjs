import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readFirstPaintStyle, renderIndexHtml } from "./sync-runtime-app-builds.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(here, "../index.html"), "utf8");

describe("runtime index.html", () => {
  const firstPaintStyle = readFirstPaintStyle(indexHtml);
  const html = renderIndexHtml({
    title: "WeGotWorkspace Installer",
    scriptPath: "/install/assets/index-abc.js",
    cssPath: "/install/assets/index-abc.css",
    firstPaintStyle,
    assetBase: "/install",
  });

  it("carries the dark first-paint background from index.html", () => {
    expect(firstPaintStyle).toMatch(
      /html\[data-theme="dark"\] body \{\s*background-color: #141414;/,
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
    expect(html).not.toMatch(/<script>/);
  });

  it("fails the sync when the built index.html lost its first-paint style", () => {
    expect(() => readFirstPaintStyle("<html><head></head></html>")).toThrow(/first-paint/);
  });
});
