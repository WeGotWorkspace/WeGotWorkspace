import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WORKSPACE_PWA_THEME_COLORS } from "@/lib/theme-preference";

const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(here, "../../index.html"), "utf8");
const stylesCss = readFileSync(join(here, "../styles.css"), "utf8");
const schemeCss = readFileSync(join(here, "../foundations/scheme-colors.generated.css"), "utf8");
const themeBootJs = readFileSync(join(here, "../../public/assets/theme-boot.js"), "utf8");

describe("PWA document shell", () => {
  it("extends under the iOS status bar from the first HTML byte", () => {
    expect(indexHtml).toMatch(/viewport-fit=cover/);
    expect(indexHtml).toMatch(/apple-mobile-web-app-status-bar-style" content="black-translucent"/);
    expect(indexHtml).toMatch(/<style>[\s\S]*html,\s*body\s*\{[\s\S]*background-color:\s*#f6f7f9/);
  });

  it("marks an installed PWA from the same-origin boot script, not inline", () => {
    expect(indexHtml).not.toContain("pwa-standalone");
    expect(themeBootJs).toMatch(/window\.navigator\.standalone === true/);
    expect(themeBootJs).toMatch(/window\.matchMedia\("\(display-mode: standalone\)"\)\.matches/);
    expect(themeBootJs).toMatch(/documentElement\.classList\.add\("pwa-standalone"\)/);
  });

  it("has no inline script, because the CSP is script-src 'self' without hashes", () => {
    // Case-insensitive: HTML tag names are, so `<SCRIPT>` must not slip through.
    const openings = indexHtml.match(/<script\b/gi) ?? [];
    const scripts = indexHtml.match(/<script\b[^>]*>[\s\S]*?<\/script[^>]*>/gi) ?? [];
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts).toHaveLength(openings.length);
    for (const script of scripts) {
      expect(script).toMatch(/^<script\b[^>]*\bsrc="[^"]+"[^>]*><\/script[^>]*>$/i);
    }
  });

  it("samples the page surface for the status bar, not ink", () => {
    expect(stylesCss).toMatch(
      /html\.pwa-standalone,\s*html\.pwa-standalone body \{[\s\S]*background-color:\s*var\(--workspace-sidebar-surface\)/,
    );
    expect(stylesCss).toMatch(/html \{\s*background-color:\s*var\(--workspace-accent\);/);
    expect(stylesCss).toMatch(/body \{\s*background-color:\s*var\(--color-background\);/);
    expect(stylesCss).not.toMatch(/html \{[^}]*background-color:\s*var\(--color-ink\)/);
    expect(stylesCss).toMatch(/html\.pwa-standalone \.app-sidebar \{[\s\S]*height:\s*100lvh/);
  });

  it("keeps the first-paint theme-color in step with the scheme surfaces", () => {
    expect(indexHtml).toContain(
      `<meta name="theme-color" content="${WORKSPACE_PWA_THEME_COLORS.light}" />`,
    );
    expect(themeBootJs).toContain(
      `{ light: "${WORKSPACE_PWA_THEME_COLORS.light}", dark: "${WORKSPACE_PWA_THEME_COLORS.dark}" }`,
    );
    // The scheme CSS is generated from the same JSON (`scripts/sync-scheme-colors.test.mjs` guards that).
    expect(schemeCss).toContain(`/* ${WORKSPACE_PWA_THEME_COLORS.light} */`);
    expect(schemeCss).toContain(`/* ${WORKSPACE_PWA_THEME_COLORS.dark} */`);
  });

  it("stops the iOS focus zoom in the HTML viewport tag, the one place for the suite", () => {
    const viewport = indexHtml.match(/<meta\s+name="viewport"[^>]*>/)?.[0] ?? "";
    expect(viewport).toMatch(/maximum-scale=1\b/);
    expect(indexHtml.match(/name="viewport"/g)).toHaveLength(1);
    // The boot script only gives Android its pinch-zoom back; it never adds the stop.
    expect(themeBootJs).toMatch(/if \(!\/Android\/i\.test\(navigator\.userAgent\)\) return;/);
    expect(themeBootJs).not.toContain('+ ", maximum-scale');
  });

  it("resolves the theme from a same-origin script the runtime CSP allows", () => {
    expect(indexHtml).toContain('<script src="/assets/theme-boot.js"></script>');
    expect(indexHtml).not.toContain("wgw.theme");
    expect(themeBootJs).toContain('localStorage.getItem("wgw.theme")');
    expect(themeBootJs).toContain(
      'document.documentElement.dataset.theme = dark ? "dark" : "light"',
    );
  });
});
