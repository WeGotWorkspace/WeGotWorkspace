import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WORKSPACE_PWA_THEME_COLORS } from "@/lib/theme-preference";

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
    expect(indexHtml).toContain(
      `dark ? "${WORKSPACE_PWA_THEME_COLORS.dark}" : "${WORKSPACE_PWA_THEME_COLORS.light}"`,
    );
    expect(stylesCss).toContain(`--color-we-got-soft: ${WORKSPACE_PWA_THEME_COLORS.light};`);
    expect(stylesCss).toContain(`--scheme-sidebar-surface: ${WORKSPACE_PWA_THEME_COLORS.dark};`);
  });
});
