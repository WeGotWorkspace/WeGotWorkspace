import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(packageRoot, "..", "..");
const baseURL = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:5173";
const authFile = path.join(packageRoot, "e2e", ".auth", "admin.json");

export default defineConfig({
  testDir: "./e2e",
  testMatch:
    /(?:notes-offline-sync|docs-offline-sync|docs-home-browse|calendar-offline-week-event)\.spec\.ts/,
  globalSetup: "./e2e/global-setup-live.mjs",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    storageState: authFile,
    trace: "on-first-retry",
  },
  webServer: process.env.WGW_APPS_E2E_NO_SERVER
    ? undefined
    : [
        {
          command: "env WGW_DISABLE_LOGIN_THROTTLE=1 bash scripts/dev-php-server.sh",
          url: "http://127.0.0.1:9080/api/v1/health",
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          cwd: path.join(packageRoot, "..", "api"),
        },
        {
          command: `bash -lc "cd ${repoRoot} && php packages/api/artisan wgw:dev-install && tools/with-root-env.sh -- pnpm run dev:app"`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
          cwd: packageRoot,
        },
      ],
});
