import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const tsx = readFileSync(join(here, "workspace-app-layout.tsx"), "utf8");
const css = readFileSync(join(here, "workspace-app-layout.css"), "utf8");
const styles = readFileSync(join(here, "workspace-app-layout.styles.ts"), "utf8");

describe("WorkspaceUserFooter logout chrome", () => {
  it("uses the same sm subtle IconButton as action bars", () => {
    expect(tsx).toMatch(/import \{ IconButton \} from "@\/button\/src\/button"/);
    expect(tsx).toMatch(/label="Log out"[\s\S]*?variant="subtle"[\s\S]*?size="sm"/);
    expect(tsx).not.toMatch(/size-9/);
    expect(tsx).not.toMatch(/linkHoverClassName/);
    expect(tsx).not.toMatch(/WORKSPACE_USER_LOGOUT_STYLE/);
  });

  it("maps footer link tokens to button-subtle vars instead of inline styles", () => {
    expect(css).toMatch(
      /\.workspace-app-layout__user-footer \{[\s\S]*--button-subtle-color:\s*var\(\s*--workspace-user-footer-link-color/,
    );
    expect(css).toMatch(
      /\.workspace-app-layout__user-footer \{[\s\S]*--button-subtle-background:\s*var\(\s*--workspace-user-footer-link-bg/,
    );
    expect(css).toMatch(
      /\.workspace-app-layout__user-footer \{[\s\S]*--button-subtle-hover-background:\s*var\(\s*--workspace-user-footer-link-hover-bg/,
    );
    expect(styles).not.toMatch(/WORKSPACE_USER_LOGOUT_STYLE/);
  });
});
