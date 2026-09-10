import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "user-avatar.css"), "utf8");

describe("user avatar mark border", () => {
  it("consumes optional border tokens without growing the mark", () => {
    const mark = css.match(/^\.user-avatar__mark \{[\s\S]*?\n\}/m)?.[0];
    expect(mark).toBeDefined();
    expect(mark).toMatch(/box-sizing:\s*border-box/);
    expect(mark).toMatch(/border-width:\s*var\(--user-avatar-border-width,\s*0\)/);
    expect(mark).toMatch(/border-color:\s*var\(--user-avatar-border,\s*transparent\)/);
    expect(mark).toMatch(/border-radius:\s*var\(--user-avatar-radius,\s*9999px\)/);
  });

  it("does not zero the mark border on the button reset", () => {
    const button = css.match(/button\.user-avatar__mark \{[\s\S]*?\n\}/)?.[0];
    expect(button).toBeDefined();
    expect(button).not.toMatch(/border:\s*0/);
    expect(button).not.toMatch(/border-width:\s*0/);
  });

  it("defines an xs mark size for collab / share chips", () => {
    expect(css).toMatch(/\.user-avatar--xs \.user-avatar__mark \{[\s\S]*width:\s*1\.75rem/);
  });
});

describe("UserAvatar presence CSS", () => {
  it("uses solid green / amber and a transparent offline ring", () => {
    expect(css).toMatch(
      /\.user-avatar__presence--online[\s\S]*--user-avatar-presence-online,\s*#22c55e/,
    );
    expect(css).toMatch(
      /\.user-avatar__presence--away[\s\S]*--user-avatar-presence-away,\s*#eab308/,
    );
    expect(css).toMatch(/\.user-avatar__presence--offline[\s\S]*background-color:\s*transparent/);
    expect(css).toMatch(
      /\.user-avatar__presence--standalone\.user-avatar__presence--offline[\s\S]*border:\s*1\.5px solid/,
    );
  });
});
