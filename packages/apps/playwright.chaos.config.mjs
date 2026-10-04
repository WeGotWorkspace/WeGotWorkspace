import { defineConfig } from "@playwright/test";
import liveConfig from "./playwright.live.config.mjs";
import { chaosTierSpecPattern } from "./e2e/live-tier.mjs";

/**
 * Real-time chaos suite (#1091) against the same CI stack as the live config
 * (PHP on :9080 and the apps Vite server). Workers run scenarios in parallel.
 * Each scenario still uses its own rooms and files.
 */
const liveUse = liveConfig.use ?? {};

export default defineConfig({
  ...liveConfig,
  testMatch: chaosTierSpecPattern,
  fullyParallel: true,
  workers: 2,
  timeout: 120_000,
  expect: { timeout: 45_000 },
  use: {
    ...liveUse,
    launchOptions: {
      ...liveUse.launchOptions,
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
});
