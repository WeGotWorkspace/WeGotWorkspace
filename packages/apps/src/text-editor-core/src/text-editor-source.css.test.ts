import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "text-editor.css"), "utf8");

describe("text editor source gutter typography", () => {
  it("shares one font-size token across the gutter, textarea, and wrap mirror", () => {
    for (const selector of [
      ".text-editor-source__gutter",
      ".text-editor-source__input",
      ".text-editor-source__mirror",
    ]) {
      expect(css).toMatch(
        new RegExp(
          `${selector.replace(".", "\\.")} \\{[\\s\\S]*font-size:\\s*var\\(--text-editor-source-font-size`,
        ),
      );
    }
  });

  it("raises the source font to 1rem on narrow viewports so iOS does not zoom", () => {
    expect(css).toMatch(
      /@media \(max-width: 767px\) \{[\s\S]*\.text-editor-source \{[\s\S]*--text-editor-source-font-size:\s*1rem;/,
    );
  });
});
