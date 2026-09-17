import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "text-editor.css"), "utf8");

describe("text editor task-list checkboxes", () => {
  it("reuses shared Checkbox tokens instead of a one-off mark", () => {
    expect(css).toMatch(/@import\s+"\.\.\/\.\.\/ui\/checkbox\.css"/);
    expect(css).toMatch(
      /\.text-editor-prose ul\[data-type="taskList"\] \{[\s\S]*--checkbox-size:\s*1\.5rem/,
    );
    expect(css).toMatch(
      /\.text-editor-prose ul\[data-type="taskList"\] li > label span \{[\s\S]*--checkbox-size, 1\.5rem/,
    );
    expect(css).toMatch(
      /\.text-editor-prose ul\[data-type="taskList"\] li > label span \{[\s\S]*--checkbox-radius, var\(--radius-sm\)/,
    );
    expect(css).toMatch(/input:checked \+ span,[\s\S]*--checkbox-checked-bg/);
    expect(css).toMatch(/input:focus-visible \+ span \{[\s\S]*--checkbox-ring-color/);
    expect(css).not.toMatch(/border-radius:\s*0\.3rem/);
    expect(css).not.toMatch(/flex:\s*0 0 1\.125rem/);
  });

  it("keeps a 24px box and an inset, lighter checkmark", () => {
    expect(css).toMatch(
      /\.text-editor-prose ul\[data-type="taskList"\] \{[\s\S]*--checkbox-size:\s*1\.5rem/,
    );
    expect(css).toMatch(
      /\.text-editor-prose ul\[data-type="taskList"\] \{[\s\S]*--checkbox-check-size:\s*1rem/,
    );
    expect(css).toMatch(
      /input:checked \+ span::after,[\s\S]*width:\s*var\(--checkbox-check-size, 1rem\)/,
    );
    expect(css).toMatch(
      /input:checked \+ span::after,[\s\S]*height:\s*var\(--checkbox-check-size, 1rem\)/,
    );
    expect(css).toMatch(/--checkbox-check-mask:[\s\S]*stroke-width='2'/);
    expect(css).not.toMatch(/--checkbox-check-mask:[\s\S]*stroke-width='2\.5'/);
  });

  it("matches Tasks marker stroke (2px) and drops the Tailwind shadow", () => {
    const span = css.match(
      /\.text-editor-prose ul\[data-type="taskList"\] li > label span \{[\s\S]*?\n\}/,
    )?.[0];
    expect(span).toMatch(/border-2/);
    expect(span).toMatch(/shadow-none/);
    expect(span).not.toMatch(/@apply[^;]*\bshadow\s/);
    expect(span).not.toMatch(/@apply[^;]*\bshadow;/);
  });
});
