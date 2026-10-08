import { defineConfig } from "@playwright/test";
import liveConfig from "./playwright.live.config.mjs";
import { chaosTierSpecPattern } from "./e2e/live-tier.mjs";

/**
 * Real-time chaos suite (#1091) against the same CI stack as the live config
 * (PHP on :9080 and the apps Vite server). Workers run scenarios in parallel.
 * Each scenario still uses its own rooms and files.
 *
 * Existing scenarios hide local IPs with `--disable-features=WebRtcHideLocalIpsWithMdns`.
 * Set `WGW_CHAOS_ALLOW_MDNS=1` to run the suite, including "two browsers", with
 * that flag omitted so mDNS stays on.
 */
const liveUse = liveConfig.use ?? {};
const allowMdns = process.env.WGW_CHAOS_ALLOW_MDNS === "1";

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
        ...(allowMdns ? [] : ["--disable-features=WebRtcHideLocalIpsWithMdns"]),
      ],
    },
  },
});
