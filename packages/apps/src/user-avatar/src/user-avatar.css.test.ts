import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "user-avatar.css"), "utf8");

describe("user avatar mark border", () => {
  it("consumes optional border tokens without growing the mark", () => {
    const mark = css.match(/\.user-avatar__mark \{[\s\S]*?\n\}/)?.[0];
    expect(mark).toBeDefined();
    expect(mark).toMatch(/box-sizing:\s*border-box/);
    expect(mark).toMatch(/border-width:\s*var\(--user-avatar-border-width,\s*0\)/);
    expect(mark).toMatch(/border-color:\s*var\(--user-avatar-border,\s*transparent\)/);
  });

  it("does not zero the mark border on the button reset", () => {
    const button = css.match(/button\.user-avatar__mark \{[\s\S]*?\n\}/)?.[0];
    expect(button).toBeDefined();
    expect(button).not.toMatch(/border:\s*0/);
    expect(button).not.toMatch(/border-width:\s*0/);
  });
});
