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
      /\.text-editor-prose ul\[data-type="taskList"\] li > label span \{[\s\S]*--checkbox-size/,
    );
    expect(css).toMatch(
      /\.text-editor-prose ul\[data-type="taskList"\] li > label span \{[\s\S]*--checkbox-radius/,
    );
    expect(css).toMatch(
      /input:checked \+ span,[\s\S]*--checkbox-checked-bg/,
    );
    expect(css).toMatch(
      /input:focus-visible \+ span \{[\s\S]*--checkbox-ring-color/,
    );
    expect(css).not.toMatch(/border-radius:\s*0\.3rem/);
    expect(css).not.toMatch(/flex:\s*0 0 1\.125rem/);
  });
});
