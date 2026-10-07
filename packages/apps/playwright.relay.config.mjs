import { defineConfig } from "@playwright/test";
import liveConfig from "./playwright.live.config.mjs";
import { relayTierSpecPattern } from "./e2e/live-tier.mjs";

/**
 * Relay tier against a local coturn. Same Chromium fake-media flags as the
 * chaos config. One worker, because the TURN settings are process-wide.
 */
const liveUse = liveConfig.use ?? {};
const webServer = Array.isArray(liveConfig.webServer)
  ? liveConfig.webServer.map((server) => {
      if (typeof server.command !== "string" || !server.command.includes("dev-php-server.sh")) {
        return server;
      }
      return {
        ...server,
        // A reused API process keeps the default 3600s TURN TTL, so credential
        // refresh never posts inside the spec window.
        reuseExistingServer: false,
        command: server.command.replace(
          "env WGW_DISABLE_LOGIN_THROTTLE=1 ",
          "env WGW_DISABLE_LOGIN_THROTTLE=1 WGW_RTC_TURN_TTL_SECONDS=120 WGW_RTC_RELAY_REQUESTS_PER_MINUTE=60 ",
        ),
      };
    })
  : liveConfig.webServer;

export default defineConfig({
  ...liveConfig,
  testMatch: relayTierSpecPattern,
  globalSetup: "./e2e/global-setup-relay.mjs",
  fullyParallel: false,
  workers: 1,
  timeout: 600_000,
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
  webServer,
});
