import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "text-editor.css"), "utf8");

describe("text editor prose typography tokens", () => {
  it("scales body prose with a modest clamp (not a fixed 16px)", () => {
    expect(css).toMatch(
      /:root \{[\s\S]*--text-editor-prose-font-size:\s*clamp\(15px,\s*0\.875rem \+ 0\.35vw,\s*16px\)/,
    );
    expect(css).not.toMatch(/:root \{[\s\S]*--text-editor-prose-font-size:\s*16px;/);
  });

  it("keeps heading sizes as multipliers of the shared prose font-size token", () => {
    expect(css).toMatch(/--text-editor-prose-heading-h1-size:\s*2\.1;/);
    expect(css).toMatch(/--text-editor-prose-heading-h2-size:\s*1\.6;/);
    expect(css).toMatch(/--text-editor-prose-heading-h3-size:\s*1\.25;/);
    expect(css).toMatch(
      /\.text-editor-prose h1 \{[\s\S]*font-size:\s*calc\(\s*var\(--text-editor-prose-heading-h1-size\)\s*\*\s*var\(--text-editor-print-prose-font-size,\s*var\(--text-editor-prose-font-size\)\)/,
    );
    expect(css).toMatch(
      /\.text-editor-prose \{[\s\S]*font-size:\s*var\(--text-editor-prose-font-size\)/,
    );
  });

  it("keeps inserted images within the prose column", () => {
    expect(css).toMatch(/\.text-editor-prose img \{[\s\S]*@apply max-w-full/);
  });

  it("uses the same opaque cream chip for hover and selected, not a transparent wash", () => {
    expect(css).toMatch(
      /\.text-editor-image:hover \.text-editor-image__delete-host,[\s\S]*\.ProseMirror-selectednode \.text-editor-image__delete-host/,
    );
    expect(css).toMatch(/--text-editor-image-delete-surface:\s*var\(--color-cream,\s*#ffffff\)/);
    const chipRule = css.match(
      /\.text-editor-image \.text-editor-image__delete,[\s\S]*?background-color:\s*var\(--text-editor-image-delete-surface\);/,
    )?.[0];
    expect(chipRule).toBeTruthy();
    expect(chipRule).toMatch(/:hover/);
    expect(chipRule).toMatch(/--color-destructive/);
    expect(chipRule).not.toMatch(/transparent/);
    expect(chipRule).not.toMatch(/--docs-accent/);
  });

  it("uses modest equal sheet padding on small viewports (Docs + Mail share the token)", () => {
    expect(css).toMatch(
      /@media \(max-width: 768px\) \{[\s\S]*\.text-editor \{[\s\S]*--text-editor-sheet-padding:\s*1\.25rem/,
    );
    expect(css).toMatch(/:root \{[\s\S]*--text-editor-sheet-padding:\s*0\.75in/);
  });
});
