import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "drive-workspace.css"), "utf8");

describe("drive workspace outline-active tokens", () => {
  it("publishes outline-active wash tokens so selected chrome inherits Drive green", () => {
    expect(css).toMatch(/--workspace-accent:\s*var\(--drive-accent\)/);
    expect(css).toMatch(/--button-active-color:\s*var\(--drive-accent-strong\)/);
    expect(css).toMatch(
      /--button-outline-active-background:\s*color-mix\([\s\S]*var\(--drive-accent\)/,
    );
  });
});
