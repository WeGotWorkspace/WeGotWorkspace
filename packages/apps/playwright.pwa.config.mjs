import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import liveConfig from "./playwright.live.config.mjs";
import { pwaTierSpecPattern } from "./e2e/live-tier.mjs";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(packageRoot, "..", "..");
const baseURL = process.env.WGW_APPS_E2E_BASE_URL ?? "http://127.0.0.1:4173";
// `global-setup-live.mjs` signs in for this origin.
process.env.WGW_APPS_E2E_BASE_URL = baseURL;

/**
 * Production-build tier (#1628): the service worker only runs its precache and
 * lazy-chunk cache in a built app, so this serves `vite build` with
 * `vite preview` against the same PHP API as the live tier.
 */
export default defineConfig({
  ...liveConfig,
  testMatch: pwaTierSpecPattern,
  use: { ...liveConfig.use, baseURL },
  webServer: process.env.WGW_APPS_E2E_NO_SERVER
    ? undefined
    : [
        liveConfig.webServer[0],
        {
          command: `bash -c "cd ${repoRoot} && php packages/api/artisan wgw:dev-install && env VITE_WGW_API_BASE_URL=/api/v1 WGW_PROXY_TARGET=http://127.0.0.1:9080 pnpm --filter @wgw/apps run build && env WGW_PROXY_TARGET=http://127.0.0.1:9080 pnpm --filter @wgw/apps run preview"`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 300_000,
          cwd: packageRoot,
        },
      ],
});
