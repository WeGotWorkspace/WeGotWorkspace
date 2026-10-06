import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COLOR_CORE_TOKENS } from "./token-catalog";

const here = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(here, "..");
const styles = readFileSync(join(srcRoot, "styles.css"), "utf8");

/** Chrome sheets that must mix the core pairs, never brand primitives. */
const CHROME_SHEETS = [
  "workspace-shell/src/workspace-derive.css",
  "workspace-shell/src/workspace-color.css",
  "workspace-shell/src/workspace-app-layout.css",
  "ui/overlay-paper.css",
  "ui/workspace-menu-item-sst.css",
  "app-sidebar/src/app-sidebar.css",
] as const;

const PRIMITIVE_REF = /var\(\s*--color-we-got-[a-z]+/g;

function walkCss(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      walkCss(full, acc);
    } else if (entry.endsWith(".css")) {
      acc.push(full);
    }
  }
  return acc;
}

/** WCAG 2.1 relative luminance for an sRGB hex (`#rrggbb`). */
export function relativeLuminance(hex: string): number {
  const n = hex.replace("#", "");
  const r = parseInt(n.slice(0, 2), 16) / 255;
  const g = parseInt(n.slice(2, 4), 16) / 255;
  const b = parseInt(n.slice(4, 6), 16) / 255;
  const lin = [r, g, b].map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0]! + 0.7152 * lin[1]! + 0.0722 * lin[2]!;
}

export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

describe("workspace token core", () => {
  it("declares the eight tier-2 pairs on :root in styles.css", () => {
    for (const token of COLOR_CORE_TOKENS) {
      expect(styles).toContain(`${token}:`);
    }
  });

  it("keeps brand primitives out of chrome sheets", () => {
    const leaks: string[] = [];
    for (const rel of CHROME_SHEETS) {
      const css = readFileSync(join(srcRoot, rel), "utf8");
      const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
      const matches = stripped.match(PRIMITIVE_REF) ?? [];
      for (const match of matches) {
        leaks.push(`${rel}: ${match})`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("keeps brand primitives out of component paint (tier-2 and brand assignments only)", () => {
    const CORE_ASSIGN =
      /^\s*--workspace-(?:surface|foreground|accent(?:-foreground)?|sidebar-surface|sidebar-foreground|icon-surface|icon-foreground)\s*:/;
    const STATUS_ASSIGN = /^\s*--meet-mark\s*:/;
    const SKIP = new Set(["styles.css", "user-avatar/src/user-avatar.css"]);
    const leaks: string[] = [];
    for (const file of walkCss(srcRoot)) {
      const rel = relative(srcRoot, file);
      if (SKIP.has(rel) || rel.endsWith(".stories.css")) continue;
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const [index, line] of css.split("\n").entries()) {
        if (CORE_ASSIGN.test(line) || STATUS_ASSIGN.test(line)) continue;
        const match = line.match(PRIMITIVE_REF);
        if (match) leaks.push(`${rel}:${index + 1} ${match[0]})`);
      }
    }
    expect(leaks).toEqual([]);
  });

  it("redeclares muted ink on the derive scopes so remapped pairs recompute", () => {
    const derive = readFileSync(join(srcRoot, "workspace-shell/src/workspace-derive.css"), "utf8");
    expect(derive).toContain("--muted-foreground:");
    expect(derive).toContain("--color-muted-foreground:");
    expect(derive).toContain("body,");
  });

  it("paints month-view in-month day numbers from workspace foreground", () => {
    const css = readFileSync(
      join(srcRoot, "lib/calendar-elements/CalendarTimelineView/CalendarTimelineView.css"),
      "utf8",
    );
    expect(css).toContain("--_lc-in-month-day-color: var(--workspace-foreground)");
    expect(css).toContain("--_lc-outside-month-day-color: color-mix");
    expect(css).not.toMatch(/--_lc-in-month-day-color:\s*color-mix\([\s\S]*--lc-grid-base-color/);
    expect(css).toMatch(/::part\(day-number\)[\s\S]*color:\s*inherit/);
    expect(css).toMatch(
      /::part\(day-number-outside-month\)[\s\S]*color:\s*var\(--_lc-outside-month-day-color\)/,
    );
    expect(css).toMatch(/::part\(day-header-button\)[\s\S]*color:\s*inherit/);
    expect(css).toContain(
      "--_lc-today-day-color: var(--lc-today-on-color, var(--workspace-accent-foreground))",
    );
    expect(css).toMatch(/::part\(day-number-today\)[\s\S]*color:\s*var\(--_lc-today-day-color\)/);
    expect(css).not.toMatch(/::part\(day-number-today\)[\s\S]*color:\s*#fff/);
  });

  it("paints today pill ink from the accent pair, not hardcoded white", () => {
    const weekday = readFileSync(
      join(srcRoot, "lib/calendar-elements/CalendarWeekdayHeader/CalendarWeekdayHeader.css"),
      "utf8",
    );
    const sidebar = readFileSync(
      join(srcRoot, "lib/calendar-elements/CalendarTimeSidebar/CalendarTimeSidebar.css"),
      "utf8",
    );
    const workspace = readFileSync(
      join(srcRoot, "calendar-core/src/calendar-workspace.css"),
      "utf8",
    );
    expect(workspace).toContain("--lc-today-on-color: var(--workspace-accent-foreground)");
    expect(weekday).toContain(
      "color: var(--lc-today-on-color, var(--workspace-accent-foreground, #fff))",
    );
    expect(weekday).not.toMatch(/\.weekday-day-number\.is-today[\s\S]*color:\s*#fff/);
    expect(sidebar).toContain(
      "color: var(--lc-today-on-color, var(--workspace-accent-foreground, #fff))",
    );
  });

  it("paints sticky list day headers from workspace foreground, not light-dark slate", () => {
    const css = readFileSync(
      join(srcRoot, "list-sticky-header/src/list-sticky-header.css"),
      "utf8",
    );
    const sst = readFileSync(join(srcRoot, "ui/list-sticky-header-sst.css"), "utf8");
    expect(css).toContain("color: var(--list-sticky-header-color, var(--workspace-foreground))");
    expect(css).not.toMatch(/light-dark\(/);
    expect(sst).toContain("--list-sticky-header-color: var(--workspace-foreground)");
  });

  it("paints the switch on-state from the accent pair", () => {
    const css = readFileSync(join(srcRoot, "ui/switch.css"), "utf8");
    const derive = readFileSync(join(srcRoot, "workspace-shell/src/workspace-derive.css"), "utf8");
    expect(css).toContain("appearance: none");
    expect(css).toContain(
      "background-color: var(--switch-on-thumb-bg, var(--workspace-accent-foreground))",
    );
    expect(derive).toContain("--switch-on-thumb-bg: var(--workspace-accent-foreground)");
  });

  it("lets month day-number buttons inherit header ink (UA ButtonText is dark)", () => {
    const css = readFileSync(join(srcRoot, "lib/calendar-elements/TimeLine/TimeLine.css"), "utf8");
    expect(css).toMatch(/\.timeline-day-header-button\s*\{[\s\S]*?color:\s*inherit/);
  });

  it("paints tooltips from the workspace pair, not primary/accent", () => {
    const tooltip = readFileSync(join(srcRoot, "ui/tooltip.css"), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    expect(tooltip).toContain("background-color: var(--workspace-foreground)");
    expect(tooltip).toContain("color: var(--workspace-surface)");
    expect(tooltip).not.toMatch(/--primary|--workspace-accent|--color-we-got-dark/);
  });

  it("does not grow a second outline-ladder recipe in product workspace sheets", () => {
    const offenders: string[] = [];
    for (const file of walkCss(srcRoot)) {
      const rel = relative(srcRoot, file);
      if (!rel.endsWith("-workspace.css") && !rel.endsWith("overlay-paper.css")) continue;
      const css = readFileSync(file, "utf8");
      if (
        css.includes("--button-outline-hover-background: color-mix") ||
        css.includes("--button-outline-active-background: color-mix")
      ) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("workspace token contrast (AA floors)", () => {
  /**
   * Conservative sRGB stand-ins for the default :root pairs.
   * Paper is Soft mixed toward white (lighter than Soft); sidebar is Soft.
   * Measuring Dark-on-Soft and white-on-Dark is the floor.
   */
  it.each([
    ["surface-foreground on Soft (paper floor)", "#003311", "#fff5e9", 4.5],
    ["accent-foreground on accent", "#ffffff", "#003311", 4.5],
    ["sidebar-foreground on white (rail floor)", "#003311", "#ffffff", 4.5],
    ["brand-foreground on default brand", "#ffffff", "#003311", 4.5],
  ] as const)("%s is at least %s:1", (_label, fg, bg, min) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(min);
  });
});
