import { defineConfig } from "@playwright/test";
import live from "./playwright.live.config.mjs";
import { notesSyncMatrixSpecPattern } from "./e2e/live-tier.mjs";

/**
 * The Notes sync matrix on the live tier (same servers and setup as
 * `playwright.live.config.mjs`). One case drives up to two browsers and waits
 * for a reconnect, so a case gets more time than a live spec.
 *
 * `fullyParallel` lets `--shard` split the cases of the one spec file (CI runs
 * it in shards); `workers: 1` from the live config still runs them one by one.
 * `maxFailures` stops a broken environment after a few cases instead of letting
 * every case fail twice until the job timeout.
 */
export default defineConfig({
  ...live,
  testMatch: notesSyncMatrixSpecPattern,
  timeout: 180_000,
  fullyParallel: true,
  maxFailures: process.env.CI ? 3 : 0,
});
