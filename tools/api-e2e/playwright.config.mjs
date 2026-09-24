import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageRoot, "../..");
const installRoot = path.join(repoRoot, "apps/wegotworkspace");
const baseURL = process.env.WGW_API_BASE_URL ?? "http://127.0.0.1:9080";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
  },
  webServer: process.env.WGW_API_E2E_NO_SERVER
    ? undefined
    : {
        command: `php -S 127.0.0.1:9080 -t ${JSON.stringify(installRoot)} ${JSON.stringify(path.join(installRoot, "index.php"))}`,
        url: `${baseURL}/api/v1/health`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        cwd: installRoot,
      },
});
