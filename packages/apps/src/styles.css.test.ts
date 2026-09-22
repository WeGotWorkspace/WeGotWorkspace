import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "styles.css"), "utf8");

describe("We Got color primitives and status semantics", () => {
  const primitiveHex: Record<string, string> = {
    soft: "#fff5e9",
    dark: "#003311",
    blue: "#0045ff",
    red: "#de4b0e",
    prince: "#962fa8",
    brat: "#8ace00",
    sky: "#a3c4e8",
    pink: "#ffbdc2",
    yellow: "#ffc800",
    sand: "#ba9689",
  };

  it("declares each We Got primitive as brand hex then oklch(from hex)", () => {
    for (const [name, hex] of Object.entries(primitiveHex)) {
      const token = `--color-we-got-${name}`;
      expect(css).toMatch(
        new RegExp(`${token}:\\s*${hex};\\s*${token}:\\s*oklch\\(from ${hex} l c h\\);`),
      );
    }
  });

  it("aliases cream to Soft and ink to Dark", () => {
    expect(css).toMatch(/--color-ink:\s*var\(--color-we-got-dark\)/);
    expect(css).toMatch(/--color-cream:\s*var\(--color-we-got-soft\)/);
    expect(css).not.toMatch(/--color-cream:\s*#f7f4ef/);
    expect(css).not.toMatch(/--color-cream:\s*#fff5e9/);
  });

  it("declares status tokens as hex then oklch(from) and aliases destructive to error", () => {
    const statusHex = {
      error: "#b14242",
      warning: "#c98a1f",
      success: "#3a8f5a",
      info: "#a3c4e8",
    } as const;
    for (const [name, hex] of Object.entries(statusHex)) {
      const token = `--color-${name}`;
      expect(css).toMatch(
        new RegExp(`${token}:\\s*${hex};\\s*${token}:\\s*oklch\\(from ${hex} l c h\\);`),
      );
    }
    expect(css).toMatch(/--destructive:\s*var\(--color-error\)/);
    expect(css).toMatch(/--color-destructive:\s*var\(--destructive\)/);
  });
});

describe("shared control radius tokens", () => {
  it("publishes soft --control-radius globally and aliases button-pill", () => {
    expect(css).toMatch(/--control-radius:\s*0\.375rem/);
    expect(css).toMatch(/--control-radius-button-pill:\s*var\(--control-radius\)/);
    expect(css).toMatch(/--control-radius-pill:\s*9999px/);
    expect(css).not.toMatch(/--control-radius:\s*0\.1875rem/);
  });
});

describe("shared paper sheet tokens", () => {
  it("defines --paper-sheet-bg and --sheet-shadow for Docs and Notes", () => {
    expect(css).toMatch(/--paper-sheet-bg:\s*oklch\(1 0 0\)/);
    expect(css).toMatch(/--sheet-shadow:\s*0 1px 2px #0000000a,\s*0 10px 30px -10px #0f172a1f/);
  });
});

describe("shared panel overlay motion tokens", () => {
  it("defines duration + ease for AppSidebar and SideDrawer", () => {
    expect(css).toMatch(/--panel-overlay-duration:\s*300ms/);
    expect(css).toMatch(/--panel-overlay-ease:\s*cubic-bezier\(0\.32,\s*0\.72,\s*0,\s*1\)/);
  });
});

describe("product UI font tokens", () => {
  it("aliases semantic families through We Got / system primitives", () => {
    expect(css).toMatch(/--font-sans:\s*var\(--font-system-sans\)/);
    expect(css).toMatch(/--font-system-sans:\s*ui-sans-serif,\s*system-ui,\s*sans-serif/);
    expect(css).not.toMatch(/--font-sans:\s*"General Sans"/);
    expect(css).not.toMatch(/font-family:\s*"General Sans"/);
    expect(css).not.toMatch(/--font-display\b/);
    expect(css).not.toMatch(/--font-app\b/);
    expect(css).not.toMatch(/--text-2xs\b/);
  });

  it("keeps serif display and mark stacks distinct from product sans", () => {
    expect(css).toMatch(/--font-serif:\s*var\(--font-we-got-serif\)/);
    expect(css).toMatch(/--font-we-got-serif:\s*"Libre Caslon Condensed",\s*serif/);
    expect(css).toMatch(/--font-mark:\s*var\(--font-we-got-mark\)/);
    expect(css).toMatch(/--font-we-got-mark:\s*"Bebas Neue"/);
  });

  it("applies the shared sans token on body", () => {
    expect(css).toMatch(/body \{[\s\S]*font-family:\s*var\(--font-sans\)/);
  });

  it("uses sans for all-caps label utility (.uppercase)", () => {
    expect(css).toMatch(/\.uppercase \{[\s\S]*font-family:\s*var\(--font-sans\)/);
    expect(css).not.toMatch(/\.uppercase \{[\s\S]*font-family:\s*var\(--font-mono\)/);
  });

  it("does not override text-xs line-height globally", () => {
    expect(css).not.toMatch(/--text-xs--line-height/);
  });

  it("opts shared Input/Textarea classes out of the iOS 1rem floor", () => {
    expect(css).toMatch(/:not\(\.input\):not\(\.input__field\)/);
    expect(css).toMatch(/textarea:not\(\.note-detail-view__title\):not\(\.textarea\)/);
    expect(css).toMatch(/font-size:\s*max\(1rem,\s*100%\)\s*!important/);
  });

  it("raises shared form-control type to 1rem below 768px so iOS does not zoom", () => {
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*--input-font-size-xs:\s*1rem[\s\S]*--input-font-size-sm:\s*1rem[\s\S]*--input-font-size-md:\s*1rem/,
    );
    expect(css).toMatch(
      /@media \(max-width: 767px\)[\s\S]*\.select-trigger[\s\S]*font-size:\s*1rem\s*!important/,
    );
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*--text-editor-prose-font-size:\s*1rem/);
  });
});
