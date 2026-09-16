import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "share-ui.css"), "utf8");
const markTsx = readFileSync(join(here, "share-principal-mark.tsx"), "utf8");

describe("share principal marks", () => {
  it("does not override UserAvatar wash/fg with raw share-dialog accent", () => {
    // Idle/active accent fills were brighter than sidebar outline-active / soft tiles.
    expect(css).not.toMatch(/\.share-dialog__principal-mark--(?:active|idle)\s*\{/);
    expect(css).not.toMatch(
      /\.share-dialog__principal-mark--(?:active|idle)[\s\S]*--user-avatar-bg:\s*var\(--share-dialog-accent\)/,
    );
    expect(css).not.toMatch(
      /\.share-dialog__guest-mark\s*\{[\s\S]*--user-avatar-bg:\s*color-mix\([\s\S]*--share-dialog-accent/,
    );
    expect(css).not.toMatch(/--user-avatar-fg:\s*var\(--share-dialog-accent\)/);
  });

  it("keeps group/guest radius only — UserAvatar owns wash via color= or outline-active", () => {
    expect(css).toMatch(
      /\.share-dialog__principal-mark--group,\s*\n\.share-dialog__guest-mark \{[\s\S]*--user-avatar-radius:\s*0\.5rem/,
    );
    expect(markTsx).toMatch(/color=\{colorKey \? avatarColorForUserId\(colorKey\) : undefined\}/);
    expect(markTsx).not.toMatch(/\bactive\b/);
  });
});

describe("share access row remove control", () => {
  it("keeps the trailing IconButton square at --input-height so it cannot flex-shrink", () => {
    expect(css).toMatch(/--input-height:\s*var\(--control-height-sm/);
    expect(css).toMatch(
      /\.share-dialog \.card__row-action > \.icon-button,\s*\n\.share-access-card \.card__row-action > \.icon-button \{[\s\S]*min-width:\s*var\(--input-height\)[\s\S]*min-height:\s*var\(--input-height\)/,
    );
    expect(css).toMatch(/\.share-dialog \.card__row-action > \.icon-button,[\s\S]*@apply shrink-0/);
  });
});
