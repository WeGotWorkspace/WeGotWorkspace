import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "app-sidebar.css"), "utf8");
const tsx = readFileSync(join(here, "app-sidebar.tsx"), "utf8");

describe("app sidebar overlay close", () => {
  it("uses outline sm IconButton matching panel closes, not a raw button", () => {
    expect(tsx).toMatch(/from "@\/button\/src\/button"/);
    expect(tsx).toMatch(/<IconButton[\s\S]*label="Close menu"/);
    expect(tsx).toMatch(/variant="outline"/);
    expect(tsx).toMatch(/size="sm"/);
    expect(tsx).toMatch(/showTooltip=\{false\}/);
    expect(tsx).not.toMatch(/<button[\s\S]*aria-label="Close menu"/);
  });

  it("renders close only in overlay viewport (SIDEBAR_OVERLAY_MEDIA_QUERY)", () => {
    expect(tsx).toMatch(/SIDEBAR_OVERLAY_MEDIA_QUERY/);
    expect(tsx).toMatch(/isSidebarOverlayViewport/);
    expect(tsx).toMatch(/\{isOverlay \? \(/);
  });

  it("CSS-hides close at the same 72.5rem dock as sidebar: utilities (beats .button inline-flex)", () => {
    expect(css).toMatch(
      /@media\s*\(width\s*>=\s*72\.5rem\)\s*\{[\s\S]*\.app-sidebar\s+\.button\.app-sidebar__close\s*\{[\s\S]*display:\s*none\s*!important/,
    );
    expect(css).not.toMatch(/\.app-sidebar__close \{[^}]*@apply[^;]*\bsidebar:hidden\b/);
  });

  it("matches logout outline border via control-border ink wash, not a harsher override", () => {
    expect(css).toMatch(
      /\.app-sidebar__close \{[\s\S]*--color-ink:\s*var\(\s*--sidebar-logo-close-button-color/,
    );
    expect(css).not.toMatch(/--button-outline-border-color:\s*color-mix\([^)]*28%/);
  });
});

describe("app sidebar padding tokens", () => {
  it("derives item padding from the app-switch icon glyph inset", () => {
    expect(css).toMatch(/--app-sidebar-padding-x:\s*1rem/);
    expect(css).toMatch(/--app-switch-lockup-line:\s*calc\(1\.875rem \* 0\.85\)/);
    expect(css).toMatch(/--app-switch-icon-size:\s*calc\(2 \* var\(--app-switch-lockup-line\)\)/);
    expect(css).toMatch(
      /--app-switch-glyph-inset:\s*calc\(var\(--app-switch-icon-size\) \* 112 \/ 512\)/,
    );
    expect(css).toMatch(/--app-sidebar-item-padding-x:\s*var\(--app-switch-glyph-inset\)/);
  });
});

describe("app sidebar nav selection SST", () => {
  it("defaults to color-washed hover < selected, overridable via --app-sidebar-item-*", () => {
    expect(css).toMatch(
      /\.app-sidebar \{[\s\S]*--button-outline-hover-background:\s*var\(\s*--app-sidebar-item-hover-bg/,
    );
    expect(css).toMatch(
      /\.app-sidebar \{[\s\S]*--button-outline-active-background:\s*var\(\s*--app-sidebar-item-selected-bg/,
    );
    expect(css).toMatch(
      /\.app-sidebar \{[\s\S]*--button-outline-active-hover-background:\s*var\(\s*--app-sidebar-item-selected-hover-bg/,
    );
    expect(css).toMatch(
      /\.app-sidebar \{[\s\S]*--button-active-color:\s*var\(\s*--app-sidebar-item-selected-color/,
    );
    // Brighter cream washes (no ink step): hover 32%→cream < selected 55%→cream < selected-hover 65%→cream.
    expect(css).toMatch(
      /\.app-sidebar \{[\s\S]*--app-sidebar-item-hover-bg[\s\S]*32%[\s\S]*var\(--color-cream/,
    );
    expect(css).toMatch(
      /\.app-sidebar \{[\s\S]*--app-sidebar-item-selected-bg[\s\S]*55%[\s\S]*var\(--color-cream/,
    );
    expect(css).not.toMatch(
      /\.app-sidebar \{[\s\S]*--app-sidebar-item-selected-bg[\s\S]*var\(--color-ink\)\s*10%/,
    );
    expect(css).toMatch(
      /\.app-sidebar \{[\s\S]*--app-sidebar-item-selected-hover-bg[\s\S]*65%[\s\S]*var\(--color-cream/,
    );
    expect(css).not.toMatch(
      /\.app-sidebar \{[\s\S]*--app-sidebar-item-selected-hover-bg[\s\S]*var\(--color-ink\)\s*14%/,
    );
    // Contrast-aware on-color (cream-nudged); override token still wins.
    expect(css).toMatch(
      /@supports\s*\(color:\s*contrast-color\(red\)\)\s*\{[\s\S]*--app-sidebar-item-selected-color[\s\S]*contrast-color\(\s*var\(--button-outline-active-background\)/,
    );
    expect(css).toMatch(
      /@supports\s*\(color:\s*contrast-color\(red\)\)\s*\{[\s\S]*contrast-color\([\s\S]*92%[\s\S]*var\(--color-cream/,
    );
  });
});

describe("app sidebar header lockup alignment", () => {
  it("top-aligns the header row so the icon tile matches close controls", () => {
    expect(css).toMatch(/\.app-sidebar__header \{[^}]*@apply[^;]*\bitems-start\b/);
    expect(css).toMatch(/\.app-sidebar__header-main \{[^}]*@apply[^;]*\bitems-start\b/);
    expect(css).not.toMatch(/\.app-sidebar__header \{[^}]*@apply[^;]*\bitems-center\b/);
  });

  it("matches ViewHeader / main-header block padding on mobile and desktop", () => {
    // Same rhythm as `.workspace-app-layout__main-header` (`p-4 md:p-6`).
    expect(css).toMatch(/\.app-sidebar__header \{[^}]*@apply[^;]*\bpy-4 md:py-6\b/);
  });

  it("cancels app-switch trigger top padding so the icon tile tops with header IconButtons", () => {
    expect(css).toMatch(
      /\.app-sidebar__header \.app-switch-button__trigger \{[^}]*@apply[^;]*\bpt-0\b/,
    );
    expect(css).not.toMatch(/\.app-sidebar__close \{[^}]*@apply[^;]*\bmt-1\b/);
  });
});

describe("app sidebar overlay motion", () => {
  it("uses shared panel-overlay duration + ease tokens", () => {
    expect(css).toMatch(
      /\.app-sidebar \{[\s\S]*transition-duration:\s*var\(--panel-overlay-duration\)/,
    );
    expect(css).toMatch(
      /\.app-sidebar \{[\s\S]*transition-timing-function:\s*var\(--panel-overlay-ease\)/,
    );
    expect(css).toMatch(
      /\.app-sidebar__scrim \{[\s\S]*--tw-duration:\s*var\(--panel-overlay-duration\)/,
    );
    expect(css).toMatch(
      /\.app-sidebar__scrim \{[\s\S]*animation-duration:\s*var\(--panel-overlay-duration\)/,
    );
  });
});
