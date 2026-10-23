import { defineConfig } from "@playwright/test";
import live from "./playwright.live.config.mjs";
import { notesSyncMatrixSpecPattern } from "./e2e/live-tier.mjs";

/**
 * The Notes sync matrix on the live tier (same servers and setup as
 * `playwright.live.config.mjs`). One case drives up to two browsers and waits
 * for a reconnect, so a case gets more time than a live spec.
 */
export default defineConfig({
  ...live,
  testMatch: notesSyncMatrixSpecPattern,
  timeout: 180_000,
});
