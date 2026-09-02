import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "field-label-row.css"), "utf8");

describe("field-label-row CSS", () => {
  it("reserves the caption band without collapsing or using column flex-basis", () => {
    expect(css).toMatch(/\.field-label-row__label--reserved \{[\s\S]*@apply invisible/);
    expect(css).not.toMatch(/\.field-label-row__label--reserved \{[\s\S]*display:\s*none/);
    expect(css).not.toMatch(/flex-basis:\s*(?!auto\b)\S+/);
  });
});
