import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "name-color-row.css"), "utf8");

describe("name-color-row CSS", () => {
  it("lets the title flex and keeps the swatch intrinsic", () => {
    expect(css).toMatch(/\.name-color-row \{[\s\S]*flex/);
    expect(css).toMatch(/\.name-color-row__input \{[\s\S]*flex-1/);
    expect(css).not.toMatch(/1_1_85%/);
    expect(css).not.toMatch(/85%/);
  });
});
