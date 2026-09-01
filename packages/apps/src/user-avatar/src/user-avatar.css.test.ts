import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "user-avatar.css"), "utf8");

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
