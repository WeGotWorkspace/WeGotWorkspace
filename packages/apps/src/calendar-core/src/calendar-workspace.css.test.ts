import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "calendar-workspace.css"), "utf8");

describe("calendar workspace header CSS", () => {
  it("compacts header chrome on narrow view-header containers", () => {
    expect(css).toMatch(/@container view-header-main \(max-width: 40rem\)/);
    expect(css).toMatch(
      /\.calendar-workspace \.calendar-header-nav \.button\[class\*="icon-button--size"\][\s\S]*size-8/,
    );
    expect(css).toMatch(
      /\.calendar-workspace \.calendar-header-actions \.calendar-view-select \{[\s\S]*min-w-0/,
    );
    expect(css).toMatch(/\.calendar-workspace \.workspace-app-layout__main-header \{[\s\S]*p-3/);
  });
});
