import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "workspace-shell-header.css"), "utf8");

describe("workspace-shell-header CSS", () => {
  it("matches app-sidebar header inset (py-4 md:py-6 + sidebar padding-x)", () => {
    expect(css).toMatch(/\.workspace-shell-header \{[\s\S]*?@apply[^;]*\bpy-4\b[^;]*\bmd:py-6\b/);
    expect(css).toMatch(
      /\.workspace-shell-header \{[\s\S]*?padding-inline:\s*var\(--app-sidebar-padding-x/,
    );
    expect(css).not.toMatch(/\.workspace-shell-header \{[\s\S]*?@apply[^;]*\bp-6\b/);
  });

  it("top-aligns the lockup tile with sidebar (pt-0 on trigger / brand-lockup)", () => {
    expect(css).toMatch(
      /\.workspace-shell-header \.app-switch-button__trigger[\s\S]*?@apply[^;]*\bpt-0\b/,
    );
    expect(css).toMatch(/\.workspace-shell-header \.brand-lockup[\s\S]*?@apply[^;]*\bpt-0\b/);
  });
});
