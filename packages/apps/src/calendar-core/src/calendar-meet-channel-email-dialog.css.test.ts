import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "calendar-meet-channel-email-dialog.css"), "utf8");

describe("calendar meet channel email dialog CSS", () => {
  it("lays out compact AlertDialog footer actions with BEM + @apply", () => {
    expect(css).toMatch(/\.calendar-meet-channel-email-dialog__footer \{[\s\S]*@apply gap-2/);
    expect(css).toMatch(
      /\.calendar-meet-channel-email-dialog__action \{[\s\S]*@apply w-full justify-center sm:w-auto/,
    );
    expect(css).not.toMatch(/choice-hint/);
    expect(css).not.toMatch(/display:\s*flex/);
    expect(css).not.toMatch(/h-auto/);
  });
});
