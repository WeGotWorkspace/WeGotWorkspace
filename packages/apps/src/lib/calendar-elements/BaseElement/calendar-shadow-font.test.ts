import { readdirSync, readFileSync, existsSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripLayerBlocks } from "./strip-layer-blocks";

const here = dirname(fileURLToPath(import.meta.url));
const calendarElementsRoot = join(here, "..");
const hostFontCssPath = join(calendarElementsRoot, "styles/host-font.css");

const TAILWIND_IMPORT = /@import\s+["']tailwindcss["']/;
/** Bare `:host {` (not `:host(.x)` / `:host .child`). */
const BARE_HOST_RULE = /:host\s*\{/;
const HARDCODED_SYSTEM_SANS = /font-family\s*:[^;{]*(?:ui-sans-serif|system-ui)(?![^;]*\))/;
const HOST_FONT_IMPORT = /@import\s+["'][^"']*host-font\.css["']/;
const Z_INDEX_IMPORT = /@import\s+["'][^"']*z-index\.css["']/;

/** Unlayered :host restores brand token (Tailwind theme otherwise sets ui-sans-serif on :host). */
const HOST_FONT_SANS_TOKEN =
  /:host\s*\{[^}]*--font-sans:\s*(?:var\(--font-we-got-sans\)|"Plus Jakarta Sans")/;
const HOST_FONT_FAMILY_PRODUCT =
  /:host\s*\{[^}]*(?:font-family:\s*var\(--font-sans\)|font-family:\s*"Plus Jakarta Sans")/;

function walkCssFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkCssFiles(full, out);
      continue;
    }
    if (entry.name.endsWith(".css")) out.push(full);
  }
  return out;
}

/**
 * Product sans pin: unlayered :host must override `--font-sans` (not only set
 * `font-family: var(--font-sans)`, which would resolve to Tailwind's local
 * ui-sans-serif token on :host).
 */
function hasUnlayeredHostProductSans(css: string): boolean {
  const unlayered = stripLayerBlocks(css);
  return HOST_FONT_SANS_TOKEN.test(unlayered) && HOST_FONT_FAMILY_PRODUCT.test(unlayered);
}

/** Sheet pins product sans via local rule or shared host-font / z-index import. */
function pinsProductSans(css: string): boolean {
  if (hasUnlayeredHostProductSans(css)) return true;
  if (HOST_FONT_IMPORT.test(css)) return true;
  // z-index.css re-exports host-font.css for every importer.
  if (Z_INDEX_IMPORT.test(css)) return true;
  return false;
}

/**
 * Exception: component CSS may omit a local font pin when the element
 * adopts BaseElement.styles (which restores `--font-sans` + font-family on :host).
 */
function adoptsBaseElementStyles(cssPath: string): boolean {
  const dir = dirname(cssPath);
  const name = basename(cssPath, ".css");
  // BaseElement/styles.css is the pin itself — not an exception.
  if (name === "styles" && basename(dir) === "BaseElement") return false;
  // Shared style modules (e.g. styles/z-index.css) have no element class.
  if (basename(dir) === "styles") return false;

  const tsPath = join(dir, `${name}.ts`);
  if (!existsSync(tsPath)) return false;
  const ts = readFileSync(tsPath, "utf8");
  return (
    /\bextends\s+BaseElement\b/.test(ts) ||
    /\bBaseElement\.styles\b/.test(ts) ||
    /\bCalendarViewBase\.styles\b/.test(ts) ||
    /\bEventBase\.styles\b/.test(ts)
  );
}

function rel(path: string): string {
  return relative(calendarElementsRoot, path);
}

describe("calendar shadow product sans (SST)", () => {
  const cssFiles = walkCssFiles(calendarElementsRoot);

  it("styles/host-font.css is the unlayered --font-sans + font-family pin", () => {
    const css = readFileSync(hostFontCssPath, "utf8");
    expect(hasUnlayeredHostProductSans(css)).toBe(true);
    expect(css).not.toMatch(/@layer\b/);
  });

  it("BaseElement/styles.css imports host-font.css (source of the pin)", () => {
    const css = readFileSync(join(here, "styles.css"), "utf8");
    expect(HOST_FONT_IMPORT.test(css)).toBe(true);
    expect(pinsProductSans(css)).toBe(true);
  });

  it("font-family: var(--font-sans) alone is insufficient (token override required)", () => {
    const buggy = `
@import "tailwindcss";
:host {
  font-family: var(--font-sans);
}
`;
    expect(hasUnlayeredHostProductSans(buggy)).toBe(false);
    expect(pinsProductSans(buggy)).toBe(false);
  });

  it("TimeLine.css and SwipeContainer.css import host-font.css (no BaseElement.styles)", () => {
    for (const name of ["TimeLine/TimeLine.css", "SwipeContainer/SwipeContainer.css"]) {
      const css = readFileSync(join(calendarElementsRoot, name), "utf8");
      expect(HOST_FONT_IMPORT.test(css), `${name} must @import host-font.css`).toBe(true);
      expect(pinsProductSans(css), `${name} must pin product sans`).toBe(true);
    }
  });

  it("styles/z-index.css imports host-font.css (re-export for importers)", () => {
    const css = readFileSync(join(calendarElementsRoot, "styles/z-index.css"), "utf8");
    expect(HOST_FONT_IMPORT.test(css)).toBe(true);
    expect(pinsProductSans(css)).toBe(true);
    // Pin lives in host-font.css, not duplicated here.
    expect(hasUnlayeredHostProductSans(css)).toBe(false);
  });

  it("wgw-calendar-surface.ts restores --font-sans and font-family on :host", () => {
    const ts = readFileSync(join(calendarElementsRoot, "wgw/wgw-calendar-surface.ts"), "utf8");
    expect(ts).toMatch(/:host\s*\{[\s\S]*?--font-sans:\s*var\(--font-we-got-sans\)/);
    expect(ts).toMatch(/:host\s*\{[\s\S]*?font-family:\s*var\(--font-sans\)/);
  });

  it("every tailwind+:host calendar CSS restores product sans or adopts BaseElement.styles", () => {
    const failures: string[] = [];

    for (const cssPath of cssFiles) {
      const css = readFileSync(cssPath, "utf8");
      if (!TAILWIND_IMPORT.test(css) || !BARE_HOST_RULE.test(css)) continue;
      if (pinsProductSans(css)) continue;
      if (adoptsBaseElementStyles(cssPath)) continue;
      failures.push(rel(cssPath));
    }

    expect(
      failures,
      `shadow stylesheets missing unlayered --font-sans + font-family product pin ` +
        `(and not adopting BaseElement.styles):\n${failures.join("\n")}`,
    ).toEqual([]);
  });

  it("forbids hardcoded ui-sans-serif / system-ui font-family in calendar-elements CSS", () => {
    const hits: string[] = [];

    for (const cssPath of cssFiles) {
      const css = readFileSync(cssPath, "utf8");
      // Allow only as fallback inside var(--font-sans, …) if ever used.
      const withoutTokenFallback = css.replace(
        /var\(\s*--font-sans\s*,[^)]*\)/g,
        "var(--font-sans)",
      );
      if (HARDCODED_SYSTEM_SANS.test(withoutTokenFallback)) {
        hits.push(rel(cssPath));
      }
    }

    expect(hits, `hardcoded system sans stacks in calendar CSS:\n${hits.join("\n")}`).toEqual([]);
  });
});
