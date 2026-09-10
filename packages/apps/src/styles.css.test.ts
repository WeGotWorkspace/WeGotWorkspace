import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "styles.css"), "utf8");

describe("shared sheet elevation token", () => {
  it("defines --sheet-shadow once for Docs and Notes paper sheets", () => {
    expect(css).toMatch(/--sheet-shadow:\s*0 1px 2px #0000000a,\s*0 10px 30px -10px #0f172a1f/);
  });
});

describe("product UI font tokens", () => {
  it("uses ui-sans-serif as the shared sans stack for all apps", () => {
    expect(css).toMatch(/--font-sans:\s*ui-sans-serif,\s*system-ui,\s*sans-serif\s*;/);
    expect(css).toMatch(/--font-display:\s*ui-sans-serif,\s*system-ui,\s*sans-serif\s*;/);
    expect(css).not.toMatch(/--font-sans:\s*"General Sans"/);
    expect(css).not.toMatch(/font-family:\s*"General Sans"/);
  });

  it("keeps serif display and app-mark stacks distinct from product sans", () => {
    expect(css).toMatch(/--font-serif:\s*"Libre Caslon Condensed",\s*serif\s*;/);
    expect(css).toMatch(
      /--font-app:\s*"Bebas Neue",\s*ui-sans-serif,\s*system-ui,\s*sans-serif\s*;/,
    );
  });

  it("applies the shared sans token on body", () => {
    expect(css).toMatch(/body \{[\s\S]*font-family:\s*var\(--font-sans\)/);
  });
});
