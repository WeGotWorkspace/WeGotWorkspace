import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "user-avatar.css"), "utf8");

describe("user avatar mark border", () => {
  it("outlines the mark by default and keeps box-sizing so size stays stable", () => {
    const mark = css.match(/^\.user-avatar__mark \{[\s\S]*?\n\}/m)?.[0];
    expect(mark).toBeDefined();
    expect(mark).toMatch(/box-sizing:\s*border-box/);
    expect(mark).toMatch(/border-width:\s*var\(--user-avatar-border-width,\s*2px\)/);
    expect(mark).toMatch(
      /border-color:\s*var\(\s*--user-avatar-border,\s*color-mix\(in oklab,\s*currentColor 35%,\s*transparent\)\s*\)/,
    );
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

describe("user avatar label spacing", () => {
  it("gives the mark and text column a gap-2.5 default", () => {
    expect(css).toMatch(/\.user-avatar \{[\s\S]*gap:\s*var\(--user-avatar-gap,\s*0\.625rem\)/);
  });

  it("stacks name and subtitle with gap-0", () => {
    const text = css.match(/^\.user-avatar__text \{[\s\S]*?\n\}/m)?.[0];
    expect(text).toBeDefined();
    expect(text).toMatch(/@apply[\s\S]*\bgap-0\b/);
  });

  it("tightens the display-name line-height to 1.1", () => {
    const name = css.match(/^\.user-avatar__name \{[\s\S]*?\n\}/m)?.[0];
    expect(name).toBeDefined();
    expect(name).toMatch(/@apply[\s\S]*\bleading-\[1\.1\]/);
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
