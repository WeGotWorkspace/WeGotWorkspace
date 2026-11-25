import { defineConfig } from "@playwright/test";
import liveConfig from "./playwright.live.config.mjs";

// Report the service worker's own fetches, so the meter counts what reaches the server.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

/**
 * Traffic budget measurement (shared hosting): counts every request one
 * browser sends per minute in fixed scenarios. Not part of the live tier: a
 * run takes several minutes per scenario. Same stack as the live config.
 *
 *   pnpm --filter @wgw/apps exec playwright test --config playwright.traffic.config.mjs
 *
 * `WGW_TRAFFIC_MINUTES` sets the measured window per scenario (default 3);
 * `WGW_TRAFFIC_ENFORCE=1` fails a scenario that breaks the budget. Reports land
 * in `test-results/traffic/<scenario>.json` (`WGW_TRAFFIC_OUT` moves them).
 * Run one scenario with `-g "cold start"`. How to read the numbers and cross-check
 * them with the API log: docs/realtime-capacity.md.
 */
export default defineConfig({
  ...liveConfig,
  testMatch: /traffic-budget\.spec\.ts$/,
  retries: 0,
  timeout: 30 * 60_000,
});
