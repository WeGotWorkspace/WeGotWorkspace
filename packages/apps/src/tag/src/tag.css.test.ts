import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "tag.css"), "utf8");
const styles = readFileSync(join(here, "../../styles.css"), "utf8");

describe("tag add control type scale", () => {
  it("keeps the add-tag button and add-tag input on the same type tokens", () => {
    expect(css).toMatch(
      /\.tag-group__add-button,\s*\.tag-group__input \{[\s\S]*font-family:\s*var\(--font-mono\)/,
    );
    expect(css).toMatch(
      /\.tag-group__add-button,\s*\.tag-group__input \{[\s\S]*font-size:\s*var\(--tag-font-size/,
    );
    expect(css).toMatch(/\.tag-group__add-button,\s*\.tag-group__input \{[\s\S]*line-height:\s*1/);
    expect(css).toMatch(/\.tag-group__add-button,\s*\.tag-group__input \{[\s\S]*font-medium/);
    expect(css).toMatch(/\.tag-group__add-button,\s*\.tag-group__input \{[\s\S]*tracking-normal/);
  });

  it("opts the add-tag input out of the iOS 1rem input floor", () => {
    expect(styles).toMatch(/:not\(\.tag-group__input\)/);
  });
});

describe("tag remove control contrast", () => {
  it("paints the X with the chip foreground token, not UA button ink", () => {
    expect(css).toMatch(
      /\.tag__remove \{[\s\S]*color:\s*var\(--tag-remove-fg,\s*var\(--tag-fg,\s*inherit\)\)/,
    );
    expect(css).toMatch(/\.tag__remove:focus-visible \{/);
  });
});
