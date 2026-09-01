import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "list-item.css"), "utf8");

describe("ListItem skip-paint CSS", () => {
  it("skips layout for off-screen rows with an overridable intrinsic size", () => {
    expect(css).toMatch(
      /\.list-item__button\s*\{[\s\S]*?content-visibility:\s*auto;[\s\S]*?contain-intrinsic-block-size:\s*auto var\(--list-item-intrinsic-block-size/,
    );
  });
});
