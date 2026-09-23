import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(here, "../../index.html"), "utf8");
const stylesCss = readFileSync(join(here, "../styles.css"), "utf8");

describe("PWA document shell", () => {
  it("extends under the iOS status bar from the first HTML byte", () => {
    expect(indexHtml).toMatch(/viewport-fit=cover/);
    expect(indexHtml).toMatch(/apple-mobile-web-app-status-bar-style" content="black-translucent"/);
    expect(indexHtml).toMatch(/<style>[\s\S]*html,\s*body\s*\{[\s\S]*background-color:\s*#fff5e9/);
    expect(indexHtml).toMatch(/documentElement\.classList\.add\("pwa-standalone"\)/);
  });

  it("samples the page surface for the status bar, not ink", () => {
    expect(stylesCss).toMatch(
      /html\.pwa-standalone,\s*html\.pwa-standalone body \{[\s\S]*background-color:\s*var\(--color-we-got-soft,\s*#fff5e9\)/,
    );
    expect(stylesCss).toMatch(/html \{\s*background-color:\s*var\(--color-we-got-dark\);/);
    expect(stylesCss).toMatch(/body \{\s*background-color:\s*var\(--color-background\);/);
    expect(stylesCss).not.toMatch(/html \{[^}]*background-color:\s*var\(--color-ink\)/);
    expect(stylesCss).toMatch(/html\.pwa-standalone \.app-sidebar \{[\s\S]*height:\s*100lvh/);
  });
});
