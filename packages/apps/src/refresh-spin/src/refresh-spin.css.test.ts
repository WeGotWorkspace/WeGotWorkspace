import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { REFRESH_SPIN_CYCLE_MS } from "@/refresh-spin/src/refresh-spin";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "refresh-spin.css"), "utf8");

describe("refresh-spin CSS", () => {
  it("defines a full 360deg cycle matching REFRESH_SPIN_CYCLE_MS", () => {
    expect(css).toMatch(/@keyframes refresh-spin \{[\s\S]*rotate\(360deg\)/);
    expect(css).toMatch(
      new RegExp(
        `\\.refresh-spin \\{[\\s\\S]*animation:\\s*refresh-spin ${REFRESH_SPIN_CYCLE_MS / 1000}s linear infinite`,
      ),
    );
  });

  it("disables the spin under prefers-reduced-motion", () => {
    expect(css).toMatch(
      /@media \(prefers-reduced-motion:\s*reduce\) \{[\s\S]*\.refresh-spin \{[\s\S]*animation:\s*none/,
    );
  });
});
