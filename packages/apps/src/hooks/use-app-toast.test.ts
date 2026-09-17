import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "use-app-toast.ts"), "utf8");
const callout = readFileSync(join(here, "../ui/app-toast-callout.tsx"), "utf8");

describe("use-app-toast", () => {
  it("resolves the active app label from the location path under the message", () => {
    expect(source).toMatch(/workspaceAppLabelFromPath/);
    expect(source).toMatch(/window\.location\.pathname/);
    expect(source).toMatch(/appName/);
    expect(callout).toMatch(/title=\{body\}/);
    expect(callout).toMatch(/message=\{appName\}/);
    expect(source).not.toMatch(/useRouterState/);
  });

  it("defaults severity to info without accent bridging", () => {
    expect(source).toMatch(/severity = "info"/);
    expect(source).not.toMatch(/bridgeToasterThemeFromWorkspace/);
  });

  it("keeps showSuccess / showError as explicit severities (icons only)", () => {
    expect(source).toMatch(/severity: "success"/);
    expect(source).toMatch(/severity: "error"/);
  });
});
