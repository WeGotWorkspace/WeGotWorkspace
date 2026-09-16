import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "styles.css"), "utf8");

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
  it("uses ui-sans-serif as the shared sans stack for all apps", () => {
    expect(css).toMatch(/--font-sans:\s*ui-sans-serif,\s*system-ui,\s*sans-serif\s*;/);
    expect(css).toMatch(/--font-display:\s*ui-sans-serif,\s*system-ui,\s*sans-serif\s*;/);
    expect(css).not.toMatch(/--font-sans:\s*"General Sans"/);
    expect(css).not.toMatch(/font-family:\s*"General Sans"/);
  });

  it("keeps serif display and app-mark stacks distinct from product sans", () => {
    expect(css).toMatch(/--font-serif:\s*"Libre Caslon Condensed",\s*serif\s*;/);
    expect(css).toMatch(
      /--font-app:\s*"Bebas Neue",\s*ui-sans-serif,\s*system-ui,\s*sans-serif\s*;/,
    );
  });

  it("applies the shared sans token on body", () => {
    expect(css).toMatch(/body \{[\s\S]*font-family:\s*var\(--font-sans\)/);
  });

  it("uses sans for all-caps label utility (.uppercase)", () => {
    expect(css).toMatch(/\.uppercase \{[\s\S]*font-family:\s*var\(--font-sans\)/);
    expect(css).not.toMatch(/\.uppercase \{[\s\S]*font-family:\s*var\(--font-mono\)/);
  });

  it("publishes text-2xs for dense uppercase captions", () => {
    expect(css).toMatch(/--text-2xs:\s*0\.75rem/);
    expect(css).toMatch(/--text-2xs--line-height:\s*1rem/);
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
