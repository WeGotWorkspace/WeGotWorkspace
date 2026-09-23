import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "action-bar.css"), "utf8");

describe("action-bar CSS", () => {
  it("does not force pill radius on the shared back outline control", () => {
    const backBlock = css.slice(css.indexOf(".action-bar__back {"));
    const end = backBlock.indexOf("\n}");
    const block = backBlock.slice(0, end);
    expect(block).not.toMatch(/rounded-full/);
    expect(block).not.toMatch(/border-radius:\s*(9999px|999px|var\(--control-radius-pill\))/);
  });
});
