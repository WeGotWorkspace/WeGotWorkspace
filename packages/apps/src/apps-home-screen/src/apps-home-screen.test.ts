import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const homeTsx = readFileSync(join(here, "apps-home-screen.tsx"), "utf8");
const authTsx = readFileSync(join(here, "../../login-core/src/authentication-page.tsx"), "utf8");
const switchTsx = readFileSync(
  join(here, "../../app-switch-button/src/app-switch-button.tsx"),
  "utf8",
);

describe("AppsHomeScreen header", () => {
  it("wires the enabled Workspace app switcher on the shell header", () => {
    expect(homeTsx).toMatch(/<WorkspaceShellHeader[\s\S]*appSwitchSubtitle=["']Workspace["']/);
    expect(homeTsx).not.toMatch(/brandLockup/);
    expect(homeTsx).not.toMatch(/appSwitchDisabled/);
  });

  it("keeps static BrandLockup on unauthenticated AuthenticationPage shells", () => {
    expect(authTsx).toMatch(/<WorkspaceShellHeader brandLockup\s*\/>/);
  });
});

describe("AppSwitchButton workspace context", () => {
  it("does not treat the product fallback as selected when subtitle is Workspace", () => {
    expect(switchTsx).toMatch(/checked:\s*!isWorkspaceContext\s*&&\s*app\.id\s*===\s*current\.id/);
    expect(switchTsx).toMatch(
      /if\s*\(!isWorkspaceContext\s*&&\s*app\.id\s*===\s*current\.id\)\s*return/,
    );
  });
});
