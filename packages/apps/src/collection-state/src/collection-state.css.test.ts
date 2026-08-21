import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "collection-state.css"),
  "utf8",
);

describe("collection-state-host placement", () => {
  it("offsets the empty block above center with 2:3 flex spacers", () => {
    expect(css).toContain(".collection-state-host:has(> .collection-state)::before");
    expect(css).toContain(".collection-state-host:has(> .collection-state)::after");
    expect(css).toMatch(/::before[\s\S]*?flex:\s*2 0 0/);
    expect(css).toMatch(/::after[\s\S]*?flex:\s*3 0 0/);
    expect(css).toMatch(
      /\.collection-state-host:has\(> \.collection-state\) \{[^}]*@apply flex min-h-full flex-col items-center;/,
    );
    expect(css).not.toMatch(
      /\.collection-state-host:has\(> \.collection-state\) \{[^}]*justify-center/,
    );
  });
});
