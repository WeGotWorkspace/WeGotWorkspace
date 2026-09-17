import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(here, "workspace-app.css"), "utf8");

describe("workspace-app detail view transitions", () => {
  it("names the mobile detail pane for View Transitions and skips CSS translate transitions", () => {
    expect(css).not.toMatch(/transition-\[translate\]/);
    expect(css).toMatch(/view-transition-name:\s*workspace-detail/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).toMatch(/html\.workspace-vt-detail::view-transition-old\(root\)/);
    expect(css).toMatch(/::view-transition-group\(workspace-detail\)/);
  });
});
