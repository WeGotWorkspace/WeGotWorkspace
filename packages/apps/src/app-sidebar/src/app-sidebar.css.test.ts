import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "app-sidebar.css"), "utf8");
const tsx = readFileSync(join(here, "app-sidebar.tsx"), "utf8");

describe("app sidebar header notifications", () => {
  it("puts the suite notification tray in the header slot, not a close button", () => {
    expect(tsx).toMatch(/from "@\/notifications-core\/src\/notification-inbox-tray"/);
    expect(tsx).toMatch(/useNotificationsInbox/);
    expect(tsx).toMatch(/className="app-sidebar__notifications"/);
    expect(tsx).toMatch(/<NotificationInboxTray/);
    expect(tsx).not.toMatch(/label="Close menu"/);
    expect(tsx).not.toMatch(/app-sidebar__close/);
    expect(tsx).not.toMatch(/SIDEBAR_OVERLAY_MEDIA_QUERY/);
  });

  it("remaps ink to sidebar icon chrome so the bell glyph matches lockup color", () => {
    expect(css).toMatch(
      /\.app-sidebar__notifications \{[\s\S]*--color-we-got-dark:\s*var\(\s*--sidebar-logo-close-button-color/,
    );
    expect(css).toMatch(
      /\.app-sidebar__notifications \{[\s\S]*--button-outline-color:\s*var\(\s*--color-we-got-dark/,
    );
    // Badge fill lives on the tray trigger, not accent/sidebar-bg.
    expect(css).not.toMatch(
      /\.app-sidebar__notifications \{[\s\S]*--notification-inbox-badge-bg:\s*var\(\s*--workspace-accent/,
    );
    expect(css).not.toMatch(
      /\.app-sidebar__notifications \{[\s\S]*--notification-inbox-badge-fg:\s*var\(\s*--app-sidebar-bg/,
    );
  });

  it("pulls notification tray CSS into the sidebar graph so runtime index CSS owns the badge", () => {
    expect(css).toMatch(/@import\s+["'].*notification-inbox-tray\.css["']/);
  });

  it("uses the sidebar right hairline for the bell IconButton stroke", () => {
    expect(css).toMatch(
      /\.app-sidebar \{[\s\S]*border-color:\s*var\(\s*--app-sidebar-border-color/,
    );
    expect(css).toMatch(
      /\.app-sidebar__notifications \{[\s\S]*--button-outline-border-color:\s*var\(\s*--app-sidebar-border-color/,
    );
    expect(css).toMatch(
      /\.app-sidebar__notifications \{[\s\S]*--button-outline-hover-background:\s*var\(\s*--app-sidebar-item-hover-bg\s*\)/,
    );
  });
});

describe("app sidebar padding tokens", () => {
  it("derives item padding from the app-switch icon glyph inset", () => {
    expect(css).toMatch(/--app-sidebar-padding-x:\s*1rem/);
    expect(css).toMatch(/--app-switch-lockup-leading:\s*0\.85/);
    expect(css).toMatch(
      /--app-switch-lockup-line:\s*calc\(1\.875rem \* var\(--app-switch-lockup-leading\)\)/,
    );
    expect(css).toMatch(/--app-switch-icon-size:\s*calc\(2 \* var\(--app-switch-lockup-line\)\)/);
    expect(css).toMatch(
      /--app-switch-glyph-inset:\s*calc\(var\(--app-switch-icon-size\) \* 112 \/ 512\)/,
    );
    expect(css).toMatch(/--app-sidebar-item-padding-x:\s*var\(--app-switch-glyph-inset\)/);
  });
});

describe("app sidebar nav item height SST", () => {
  it("publishes --app-sidebar-item-height from the md control token", () => {
    expect(css).toMatch(
      /\.app-sidebar \{[\s\S]*--app-sidebar-item-height:\s*var\(--control-height-md,\s*2\.25rem\)/,
    );
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
      /\.app-sidebar \{[\s\S]*--app-sidebar-item-hover-bg[\s\S]*32%[\s\S]*var\(--color-we-got-soft/,
    );
    expect(css).toMatch(
      /\.app-sidebar \{[\s\S]*--app-sidebar-item-selected-bg[\s\S]*55%[\s\S]*var\(--color-we-got-soft/,
    );
    expect(css).not.toMatch(
      /\.app-sidebar \{[\s\S]*--app-sidebar-item-selected-bg[\s\S]*var\(--color-we-got-dark\)\s*10%/,
    );
    expect(css).toMatch(
      /\.app-sidebar \{[\s\S]*--app-sidebar-item-selected-hover-bg[\s\S]*65%[\s\S]*var\(--color-we-got-soft/,
    );
    expect(css).not.toMatch(
      /\.app-sidebar \{[\s\S]*--app-sidebar-item-selected-hover-bg[\s\S]*var\(--color-we-got-dark\)\s*14%/,
    );
    // Contrast-aware on-color (cream-nudged); override token still wins.
    expect(css).toMatch(
      /@supports\s*\(color:\s*contrast-color\(red\)\)\s*\{[\s\S]*--app-sidebar-item-selected-color[\s\S]*contrast-color\(\s*var\(--button-outline-active-background\)/,
    );
    expect(css).toMatch(
      /@supports\s*\(color:\s*contrast-color\(red\)\)\s*\{[\s\S]*contrast-color\([\s\S]*92%[\s\S]*var\(--color-we-got-soft/,
    );
  });
});

describe("app sidebar header lockup alignment", () => {
  it("top-aligns the header row so the icon tile matches the notifications control", () => {
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
    expect(css).not.toMatch(/\.app-sidebar__notifications \{[^}]*@apply[^;]*\bmt-1\b/);
  });
});

describe("app sidebar overlay motion", () => {
  it("keeps sidebar fill under the status bar and home indicator", () => {
    expect(css).toMatch(/\.app-sidebar \{[\s\S]*padding-top:\s*env\(safe-area-inset-top,\s*0px\)/);
    expect(css).toMatch(
      /\.app-sidebar \{[\s\S]*padding-bottom:\s*env\(safe-area-inset-bottom,\s*0px\)/,
    );
  });

  it("dims the overlay on a pseudo element so the fixed scrim does not tint the status bar", () => {
    expect(css).toMatch(/\.app-sidebar__scrim \{[\s\S]*\bbg-transparent\b/);
    expect(css).not.toMatch(/\.app-sidebar__scrim \{[^}]*bg-black\/30/);
    expect(css).toMatch(
      /\.app-sidebar__scrim::before \{[\s\S]*background-color:\s*rgb\(0 0 0 \/ 30%\)/,
    );
  });

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
