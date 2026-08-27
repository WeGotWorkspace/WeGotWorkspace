import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "task-project-dialog.css"), "utf8");
const tsx = readFileSync(join(here, "task-project-dialog.tsx"), "utf8");

describe("task project dialog name-color row", () => {
  it("uses the shared name-color row instead of a local 85% split", () => {
    expect(tsx).toMatch(/NameColorRow/);
    expect(tsx).toMatch(/NAME_COLOR_ROW_INPUT_CLASS/);
    expect(css).not.toMatch(/name-color-row/);
    expect(css).not.toMatch(/85%/);
  });
});
