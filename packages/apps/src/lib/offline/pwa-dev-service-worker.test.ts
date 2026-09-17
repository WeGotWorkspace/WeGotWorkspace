import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const viteConfig = readFileSync(join(here, "../../../vite.config.ts"), "utf8");
const main = readFileSync(join(here, "../../main.tsx"), "utf8");
const sw = readFileSync(join(here, "../../sw.ts"), "utf8");

describe("PWA service worker in Vite dev", () => {
  it("enables the injectManifest worker as an ES module during pnpm dev", () => {
    expect(viteConfig).toMatch(/devOptions:\s*\{\s*enabled:\s*true,\s*type:\s*"module"\s*\}/);
    expect(viteConfig).not.toMatch(/devOptions:\s*\{\s*enabled:\s*false/);
  });

  it("registers the worker on local Vite hosts, not only production builds", () => {
    expect(main).toContain("shouldRegisterServiceWorker");
    expect(main).not.toMatch(/import\.meta\.env\.PROD && "serviceWorker"/);
  });

  it("does not install the SPA navigation fallback in the dev worker", () => {
    expect(sw).toMatch(/if \(import\.meta\.env\.PROD\) \{[\s\S]*registerRoute\(/);
    expect(sw).toMatch(/self\.__WB_MANIFEST/);
  });
});
