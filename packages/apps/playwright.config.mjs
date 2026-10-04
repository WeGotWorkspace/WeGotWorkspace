import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chaosTierSpecPattern, liveTierSpecPattern } from "./e2e/live-tier.mjs";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const baseURL = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:6006";

/**
 * Mock-tier specs hit Storybook (`iframe.html`). Live-app specs stay on
 * `playwright.live.config.mjs`. CI builds `storybook-static` and sets
 * `WGW_APPS_E2E_STATIC=1` so this file serves that directory instead of
 * `storybook dev`.
 */
function webServer() {
  if (process.env.WGW_APPS_E2E_NO_SERVER) {
    return undefined;
  }

  if (process.env.WGW_APPS_E2E_STATIC === "1") {
    const url = new URL(baseURL);
    const port = url.port || (url.protocol === "https:" ? "443" : "80");
    const host = url.hostname;
    if (!/^\d+$/.test(port) || (host !== "127.0.0.1" && host !== "localhost")) {
      throw new Error("WGW_APPS_E2E_STATIC serves storybook-static on 127.0.0.1 or localhost only");
    }

    return {
      command: `python3 -m http.server ${port} --bind ${host} --directory storybook-static`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      cwd: packageRoot,
    };
  }

  return {
    command: "pnpm run storybook",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    cwd: packageRoot,
  };
}

export default defineConfig({
  testDir: "./e2e",
  testIgnore: [liveTierSpecPattern, chaosTierSpecPattern],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: webServer(),
});
