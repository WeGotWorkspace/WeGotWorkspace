import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "notification-inbox-tray.css"), "utf8");
const tsx = readFileSync(join(here, "notification-inbox-tray.tsx"), "utf8");

describe("notification inbox tray placement", () => {
  it("does not pin the tray as a viewport overlay (sidebar owns the bell)", () => {
    expect(css).not.toMatch(/notification-inbox-host/);
    expect(css).not.toMatch(/fixed right-16 top-3/);
  });

  it("aligns header and list row horizontal padding", () => {
    expect(css).toMatch(/\.notification-inbox-tray__header \{[\s\S]*@apply border-b px-3/);
    expect(css).toMatch(/\.notification-inbox-tray__row \{[\s\S]*@apply[\s\S]*px-3/);
    expect(css).toMatch(/\.notification-inbox-tray__empty \{[\s\S]*@apply px-3/);
  });
});

describe("notification inbox tray bell chrome", () => {
  it("uses md IconButton so the bell matches WorkspaceSidebarToggle", () => {
    const trigger = tsx.match(
      /<IconButton[\s\S]*?className="notification-inbox-tray__trigger"[\s\S]*?\/>/,
    )?.[0];
    expect(trigger).toBeDefined();
    expect(trigger!).toMatch(/size="md"/);
    expect(trigger!).not.toMatch(/size="sm"/);
  });

  it("uses the primary button fill and on-color for the unread badge, not icon chrome or the button stroke", () => {
    expect(css).toMatch(
      /\.notification-inbox-tray__trigger::after \{[\s\S]*background-color:\s*var\(\s*--notification-inbox-badge-bg,\s*var\(\s*--button-primary-bg/,
    );
    expect(css).toMatch(
      /\.notification-inbox-tray__trigger::after \{[\s\S]*color:\s*var\(\s*--notification-inbox-badge-fg,\s*var\(\s*--button-primary-fg/,
    );
    expect(css).not.toMatch(/--notification-inbox-chrome/);
    expect(css).not.toMatch(
      /\.notification-inbox-tray__trigger \{[\s\S]*--button-outline-border-color:/,
    );
  });

  it("does not derive badge numeral from fill luminance", () => {
    expect(css).not.toMatch(/oklch\(\s*from var\(--notification-inbox-badge-bg/);
    expect(css).not.toMatch(/contrast-color\(\s*var\(--notification-inbox-badge-bg/);
  });

  it("pulses the unread badge once on new arrival and honors prefers-reduced-motion", () => {
    expect(css).toMatch(/@keyframes notification-inbox-badge-pulse/);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion:\s*no-preference\) \{[\s\S]*\.notification-inbox-tray__trigger\[data-pulse\]::after \{[\s\S]*animation:\s*notification-inbox-badge-pulse/,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\) \{[\s\S]*\.notification-inbox-tray__trigger\[data-pulse\]::after \{[\s\S]*animation:\s*none/,
    );
  });
});

describe("notification inbox tray row focus", () => {
  it("uses an ink background wash for hover and focus, not an emerald outline ring", () => {
    expect(css).toMatch(
      /\.notification-inbox-tray__row:hover,\s*\.notification-inbox-tray__row:focus-visible \{[\s\S]*background-color:\s*color-mix\(in oklab,\s*var\(--color-we-got-dark\)\s*4%,\s*transparent\)/,
    );
    expect(css).not.toMatch(/box-shadow:\s*inset 0 0 0 2px var\(--color-emerald/);
  });
});

describe("notification inbox tray row typography", () => {
  it("keeps domain as a readable label, not muddy small-caps", () => {
    expect(css).toMatch(
      /\.notification-inbox-tray__domain \{[\s\S]*@apply text-xs font-semibold tracking-normal/,
    );
    expect(css).not.toMatch(
      /\.notification-inbox-tray__domain \{[\s\S]*uppercase tracking-\[0\.16em\]/,
    );
  });

  it("keeps title hierarchy: actor bold, remainder regular; plain titles stay bold", () => {
    expect(css).toMatch(
      /\.notification-inbox-tray__row-title \{[\s\S]*@apply block text-sm font-normal/,
    );
    expect(css).toMatch(/\.notification-inbox-tray__title-actor \{[\s\S]*@apply font-bold/);
    expect(css).toMatch(/\.notification-inbox-tray__title-rest \{[\s\S]*@apply font-normal/);
    expect(css).toMatch(/\.notification-inbox-tray__row-title--plain \{[\s\S]*@apply font-bold/);
    expect(css).toMatch(
      /\.notification-inbox-tray__row-body \{[\s\S]*text-sm[\s\S]*text-muted-foreground/,
    );
  });

  it("matches sidebar app-icon corner radius and does not paint unread dots", () => {
    expect(css).toMatch(/\.notification-inbox-tray__app-icon \{[\s\S]*rounded-\[6px\]/);
    expect(css).not.toMatch(/rounded-\[10px\]/);
    expect(css).not.toMatch(/notification-inbox-tray__unread-dot/);
  });
});
