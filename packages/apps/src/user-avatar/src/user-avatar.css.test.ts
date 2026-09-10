import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "user-avatar.css"), "utf8");

describe("user avatar mark border", () => {
  it("matches selected outline IconButton radius, wash, fg, and quiet stroke", () => {
    const mark = css.match(/^\.user-avatar__mark \{[\s\S]*?\n\}/m)?.[0];
    expect(mark).toBeDefined();
    expect(mark).toMatch(/box-sizing:\s*border-box/);
    expect(mark).toMatch(
      /border-radius:\s*var\(--user-avatar-radius,\s*var\(--control-radius-button-pill\)\)/,
    );
    expect(mark).toMatch(/--button-outline-active-background/);
    expect(mark).toMatch(
      /color:\s*var\(--user-avatar-fg,\s*var\(--button-active-color,\s*var\(--color-emerald\)\)\)/,
    );
    expect(mark).toMatch(/border-width:\s*var\(--user-avatar-border-width,\s*1px\)/);
    expect(mark).toMatch(/--button-outline-border-color,\s*var\(--control-border-color\)/);
    expect(mark).not.toMatch(/9999px/);
  });

  it("retints outline-active wash/fg/border from the user palette on colored marks", () => {
    const colored = css.match(/^\.user-avatar--colored \{[\s\S]*?\n\}/m)?.[0];
    expect(colored).toBeDefined();
    expect(colored).toMatch(/--user-avatar-bg:\s*var\(--user-avatar-tile-bg\)/);
    expect(colored).toMatch(/--user-avatar-fg:\s*var\(--user-avatar-tile-fg\)/);
    expect(colored).toMatch(/--user-avatar-border:\s*var\(--user-avatar-tile-border\)/);
    expect(css).not.toMatch(/\.user-avatar--colored \.user-avatar__mark \{[\s\S]*border:\s*2px/);
  });

  it("does not zero the mark border on the button reset", () => {
    const button = css.match(/button\.user-avatar__mark \{[\s\S]*?\n\}/)?.[0];
    expect(button).toBeDefined();
    expect(button).not.toMatch(/border:\s*0/);
    expect(button).not.toMatch(/border-width:\s*0/);
  });

  it("deepens clickable marks with outline-active-hover and keeps focus chrome", () => {
    const button = css.match(/button\.user-avatar__mark \{[\s\S]*?\n\}/)?.[0];
    expect(button).toBeDefined();
    expect(button).toMatch(/@apply[\s\S]*\btransition-colors\b/);
    expect(button).toMatch(/@apply[\s\S]*\bfocus-visible:ring-1\b/);
    expect(css).toMatch(
      /button\.user-avatar__mark:hover \{[\s\S]*--button-outline-active-hover-background/,
    );
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
